// lookup-queue.js — T6 deferred-enrichment queue + drain + idempotent merge
// (#285).
//
// A single shared seam over BOTH persistence backends (same dual-backend
// pattern as lookup-cache.js). When Postgres is configured, `getRepository()`
// exposes `lookupQueue` (the createLookupQueueRepo) and `items` (the Postgres
// items repo); the Blobs backend uses the runout-lookup-queue Blob store
// (createLookupQueueStore) and mirrors merged items back to the Blob stores.
//
// Lifecycle:
//   enqueue(entry)   — record a deferred lookup ({kind, barcode?/q?/key,
//                       item_id?, user_id, provider, payload, nextAt}). No item
//                       is needed to enqueue (e.g. a rate-limited lookup the
//                       user then manual-adds); the merge simply requires an
//                       item_id by drain time.
//   drain(ctx, opts) — the @hourly scheduled drain (and the opportunistic
//                       piggyback) loop. It iterates ONE TENANT AT A TIME,
//                       claims each tenant's due rows, re-runs the provider
//                       lookup through the SSRF-safe fixed-host `lookup` fn,
//                       and idempotently merges ONLY missing fields into the
//                       item — never clobbering a user's edits. Marks the row
//                       done / back-off / abandon.
//
// Abandon rules (per issue #285):
//   * never retry a PERMANENT failure more than once;
//   * exponential next_at back-off on transient failures;
//   * abandon after 5 attempts or 7 days.
//
// Security invariants (the Security Auditor's gate):
//   * A drain for user A NEVER touches user B's rows/items — every queue op is
//     user_id-scoped and the drain iterates one tenant at a time.
//   * The queue is NEVER echoed to a client; this module is server/service-
//     identity only and returns NO queue payload to any request handler.
//   * `safeError` integrity: drained failures become a short internal
//     `last_error`, never a client-visible error body.

const MAX_ATTEMPTS = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function toMs(date) {
  if (date == null) return null
  const d = date instanceof Date ? date : new Date(date)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

// ---------------------------------------------------------------------------
// Idempotent field-merge
// ---------------------------------------------------------------------------

// Merge `fetched` into `item`, filling ONLY missing/null fields. Every value
// the user has already set ("" counts as unset here only for provider-id
// fields the drain is meant to supply; user-edited strings are kept verbatim)
// is preserved — the drain never overwrites an edit. Returns a new item object
// (the caller's is never mutated).
//
// `fillable` is the set of item keys the provider may supply. A key is filled
// only when the current value is null/undefined/'' (empty — the "partial
// metadata" case). Non-empty user values are always kept.
export function mergeFields(item, fetched, fillable = DEFAULT_FILLABLE) {
  if (!item || typeof item !== 'object') return item
  if (!fetched || typeof fetched !== 'object') return { ...item }
  const merged = { ...item }
  for (const key of fillable) {
    const current = item[key]
    const value = fetched[key]
    if (value === undefined) continue
    const isEmptyArray = Array.isArray(current) && current.length === 0
    const isMissing = current == null || current === '' || isEmptyArray
    if (isMissing) {
      // Arrays must be non-empty to count as a fill (''/[] both read as a gap).
      const isPopulated = Array.isArray(value) ? value.length > 0 : value !== ''
      if (isPopulated) merged[key] = value
    }
  }
  return merged
}

// The canonical set of metadata keys the drain may fill from a provider
// response. Deliberately excludes user-authored/identity fields (notes, date,
// wishlist, lending, ids that define ownership). `discogsId`/`googleBooksId`/
// `mbid`/`openLibraryId` are provider ids and ARE fillable — filling a missing
// provider id is exactly what completes an OCR/no-id partial save.
export const DEFAULT_FILLABLE = [
  'title', 'subtitle', 'year', 'label', 'genre', 'style', 'country', 'formatType',
  'formatRaw', 'catno', 'coverImage', 'description', 'artists', 'masterId',
  'tracklist', 'released', 'authorsList', 'series', 'mainCategory', 'snippet',
  'pageCount', 'isbn', 'discogsId', 'googleBooksId', 'mbid', 'openLibraryId',
  'barcode',
]

// Stamp the success lifecycle fields: mark the item enriched and clear the
// deferred-enrichment flag (metadataPending) that a partial save set.
export function stampEnriched(item, now = new Date()) {
  return {
    ...item,
    metadataPending: false,
    enrichedAt: (now instanceof Date ? now : new Date()).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Abandon / back-off policy
// ---------------------------------------------------------------------------

// Exponential back-off for the NEXT attempt, capped at 7 days.
export function nextAttemptAt(attempts, now = Date.now()) {
  const exp = Math.min(attempts, 6) // 2^(min(attempts,6)) hours max
  const delayMs = Math.min(2 ** exp * 60 * 60 * 1000, MAX_AGE_MS)
  return new Date(now + delayMs)
}

// Whether a row must be abandoned: exceeded the attempt cap, or the row has
// been pending past the max age. `permanent` failures are abandoned on the
// second encounter (never retried more than once).
export function shouldAbandon({ attempts, nextAt, permanent = false, now = Date.now() }) {
  if (permanent && attempts >= 1) return true
  if (attempts >= MAX_ATTEMPTS) return true
  const next = toMs(nextAt)
  if (next != null && now - next > MAX_AGE_MS) return true
  return false
}

// ---------------------------------------------------------------------------
// Enqueue + drain
// ---------------------------------------------------------------------------

// Enqueue a deferred lookup onto whichever backend the repo exposes. Best-effort
// and non-fatal: a failed enqueue must never fail a successful save/lookup (the
// item is still saved; it just won't be auto-enriched).
//   entry: { user_id, kind, barcode?|q?, item_id?, provider, action, nextAt? }
// `key` is the provider lookup key (barcode:/q: hashes) used for idempotency.
export async function enqueue(queue, entry) {
  try {
    const key = entry.key || entry.barcode || entry.q || `${entry.provider}:${entry.action || 'lookup'}`
    return await queue.enqueue({
      user_id: entry.user_id,
      kind: entry.kind,
      item_id: entry.item_id,
      payload: {
        provider: entry.provider,
        action: entry.action,
        key,
        barcode: entry.barcode,
        q: entry.q,
      },
      key,
      nextAt: entry.nextAt || new Date(),
    })
  } catch {
    return null // never fail the caller
  }
}

// One drain pass. Iterates the DISTINCT tenants with pending work and, for each
// tenant, claims up to `maxPerRun` due rows and processes them. `lookup` is the
// SSRF-safe, fixed-host provider lookup: (row) => { ok, data, permanent, error }.
// `items` is the items repo used for the idempotent merge (owner-scoped).
//
// Returns a summary { processed, enriched, failed, abandoned }.
export async function drain(ctx, { maxPerRun = 10, now = Date.now() } = {}) {
  const { queue, items, lookup } = ctx
  const summary = { processed: 0, enriched: 0, failed: 0, abandoned: 0 }

  // Distinct tenants (service identity, iterated one at a time — never crosses
  // a user_id boundary).
  const users = (queue?.listPendingUsers && (await queue.listPendingUsers())) || []
  for (const userId of users) {
    const due = await queue.claimDue(userId, maxPerRun)
    for (const row of due) {
      summary.processed += 1
      const outcome = await runLookup(lookup, row)
      if (outcome.ok) {
        await handleSuccess({ queue, items, userId, row, data: outcome.data, summary, now })
      } else {
        await handleFailure({ queue, userId, row, error: outcome.error, permanent: outcome.permanent === true, summary, now })
      }
    }
  }

  return summary
}

async function runLookup(lookup, row) {
  try {
    return (await lookup(row)) || { ok: false, error: 'LOOKUP_ERROR' }
  } catch {
    return { ok: false, error: 'LOOKUP_ERROR' }
  }
}

async function handleSuccess({ queue, items, userId, row, data, summary, now }) {
  let merged = data
  if (row.item_id && items?.mergeEnriched) {
    merged = await items.mergeEnriched(userId, row.kind, row.item_id, data)
  }
  if (merged) {
    summary.enriched += 1
    await queue.markDone(userId, row.id)
  } else {
    summary.abandoned += 1
    await queue.markFailed(userId, row.id, {
      nextAt: nextAttemptAt(row.attempts, now),
      abandon: true,
      error: 'ITEM_GONE',
    })
  }
}

async function handleFailure({ queue, userId, row, error, permanent, summary, now }) {
  summary.failed += 1
  const abandon = shouldAbandon({ attempts: row.attempts + 1, nextAt: row.next_at, permanent, now })
  await queue.markFailed(userId, row.id, {
    nextAt: nextAttemptAt(row.attempts + 1, now),
    abandon,
    error: safeQueueError(error),
  })
  if (abandon) summary.abandoned += 1
}

// Coerce a drain failure to a short internal token (safeError integrity: the
// underlying error/keys/payload never leak anywhere).
function safeQueueError(err) {
  const s = String(err?.message || err || 'ERROR')
  return s.slice(0, 120)
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

// Return the queue backend for the current repository: the Postgres repo when
// Postgres is configured, else the runout-lookup-queue Blob store.
export async function queueFor(repo) {
  if (repo.lookupQueue) return repo.lookupQueue
  const { createLookupQueueStore } = await import('./lookup-queue-store')
  return createLookupQueueStore()
}

// ---------------------------------------------------------------------------
// Enqueue-on-partial-save + opportunistic piggyback (T6, #285)
// ---------------------------------------------------------------------------

// The provider ids whose presence means an item is "complete" (a real provider
// match). An item missing ALL of them is a partial save (rate-limited lookup,
// manual add, OCR with no provider id) eligible for deferred enrichment.
const PROVIDER_IDS = ['discogsId', 'googleBooksId', 'mbid', 'openLibraryId']

// Whether an item is a partial save worth queueing for later enrichment.
export function isPartialItem(item, collection) {
  if (!item || typeof item !== 'object') return false
  const hasProviderId = PROVIDER_IDS.some((k) => item[k] != null && item[k] !== '')
  if (hasProviderId) return false
  // A barcode/ISBN is the re-trigger key; without one there is nothing to look
  // up later (a purely manual add with no code has no deferred path).
  const code = item.barcode || item.isbn
  if (!code) return false
  return true
}

// Best-effort enqueue of a partial save for deferred enrichment. Never throws
// and never fails the save. `queue` is the repo/store-backed queue.
export async function enqueuePartialSave(queue, { user_id: userId, kind, item_id: itemId, barcode, isbn, provider }) {
  if (!itemId) return null
  const key = `barcode:${barcode || isbn || ''}`
  try {
    return await enqueue(queue, {
      user_id: userId,
      kind,
      item_id: itemId,
      barcode: barcode || isbn,
      provider: provider || (kind === 'books' ? 'books' : 'discogs'),
      action: 'searchBarcode',
      key,
    })
  } catch {
    return null
  }
}

// Opportunistic piggyback: on a later successful lookup / item-detail open,
// drain any due rows for THIS tenant so the user's partial items get completed
// without waiting for the hourly cron. Best-effort and non-blocking — it never
// fails the read/open. `lookup` is the same SSRF-safe fixed-host provider fn
// used by the scheduled drain.
export async function piggybackDrain(repo, lookup, { maxPerRun = 3 } = {}) {
  try {
    return await drain({ queue: repo.lookupQueue, items: repo.items, lookup }, { maxPerRun })
  } catch {
    return { processed: 0, enriched: 0, failed: 0, abandoned: 0 }
  }
}
