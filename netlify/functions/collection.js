import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { COLLECTIONS, json, readIndex, writeIndex } from './_shared/collection-store'
import { enforce, forbidden } from './_shared/policy'
import { filterFor } from './_shared/filter'
import { DEMO_SEED, seedDemoStore } from './_shared/demo-data'
import { planLimitFor } from './_shared/plans'
import { storeNameFor } from './_shared/users'
import { parsePagination, sliceIds, isDefaultPage } from './_shared/pagination'
import { ensureOwnedCount, adjustOwnedCount, wishlistToggleDelta } from './_shared/counts'
import { readListCache, writeListCache, invalidateListCache } from './_shared/list-cache'
import { pickItemFields, validateItem } from './_shared/item-fields'
import { rateLimitGuard, rateLimitIdentity } from './_shared/rate-limit'
import { anomalyScope } from './_shared/anomaly'
import { isPostgresConfigured } from './_shared/postgres'
import { handlePostgres } from './_shared/collection-postgres'
import { badRequest, readJsonBody, safeError } from './_shared/security'

const RATE_LIMITS_STORE = 'runout-rate-limits'
// Per-identity fixed-window limit for collection reads/writes (T5).
const COLLECTION_RATE_LIMIT = Number(process.env.RUNOUT_COLLECTION_RATE_LIMIT) || 60
// SEC-7.4 (#341): WRITE sub-limit (create/update/delete) BELOW the shared read
// limit. Writes mutate the per-user blob store + counts, so they're the
// sensitive/costly path; a generous read budget (60/min above) is preserved
// while writes are capped lower (30/min default).
const COLLECTION_WRITE_LIMIT = Number(process.env.RUNOUT_COLLECTION_WRITE_RATE_LIMIT) || 30

// The Blobs-backed handler — the pre-Phase-1 behavior, unchanged. Reached when
// DATABASE_URL is absent, or as the read-through fallback when Postgres errors.
async function handleBlobs(req, { user, collection, id, url }) {
  // Owner → legacy stores (existing data preserved); members → their own
  // isolated store per kind.
  const store = getStore(storeNameFor(user.id, collection))

  try {
    if (req.method === 'GET') {
      // Demo space self-seeds on first access (ADR-0001): a fresh store is
      // populated with the curated items so a demo visitor never sees an empty
      // collection — no manual admin seed step required. Idempotent — the seed
      // is skipped as soon as the index is non-empty.
      if (user.role === 'demo') {
        await seedDemoStore(store, DEMO_SEED[collection])
      }
      // The list cache (T4) serves only the default (unpaginated) page — the
      // only shape the client requests today. Explicit limit/offset opts out
      // so paginated reads always see fresh data.
      const defaultPage = isDefaultPage(url.searchParams)
      if (defaultPage) {
        const cached = await readListCache(store)
        if (cached) return json(200, { items: cached.map((i) => filterFor(user, 'item', i, { own: true })) })
      }
      // Paginated read (T2): fetch ONLY the requested slice of items, keeping
      // index order. Default limit is high (1000) so the current client is
      // unchanged.
      const ids = await readIndex(store)
      const { offset, limit } = parsePagination(url.searchParams)
      const slice = sliceIds(ids, offset, limit)
      const items = (await Promise.all(
        slice.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })),
      )).filter(Boolean)
      // SEC-7.1 (#338): route item DTOs through the shared property-filter.
      // Every item is owned by the caller (per-user store), so own:true passes
      // them through unchanged — this formalizes the filter so a future
      // non-owner item DTO can never leak private fields.
      const visible = items.map((i) => filterFor(user, 'item', i, { own: true }))
      if (defaultPage) await writeListCache(store, items)
      return json(200, { items: visible })
    }

    if (req.method === 'POST') {
      // SEC-3.2 (#195): cap the JSON body before parsing (413 over the cap).
      const parsed = await readJsonBody(req)
      if (parsed.error) return parsed.error
      // SEC-3.1 (#194): type + length validate the allowlisted fields.
      const v = validateItem(parsed.value)
      if (v.error) return badRequest(v.error)
      const body = v.item

      // M2 #292 idempotent push (ADR-0019 Dec 7): the offline outbox sends a
      // STABLE client operation id (`clientOpId`) so a retry / flaky reconnect
      // can replay the SAME add without creating a duplicate. The key is read
      // from the RAW body (it is NOT an item field — pickItemFields strips it,
      // so it never reaches the stored item). If this op was already applied,
      // return the existing item idempotently (201) — no second record, no
      // duplicate. `clientOpId` is opaque to the server; scoping/ownership is
      // still server-authoritative (the per-user store + resolved session).
      const clientOpId = parsed.value?.clientOpId
      const dedupe = (id) =>
        store.setJSON(`dedupe:${clientOpId}`, id).catch(() => { /* best-effort */ })
      if (clientOpId != null && clientOpId !== '') {
        const existingId = await store.get(`dedupe:${clientOpId}`)
        if (existingId) {
          const existing = await store.get(`item:${existingId}`, { type: 'json' })
          if (existing) {
            return json(201, filterFor(user, 'item', existing, { own: true }))
          }
        }
      }

      // Free-tier cap: enforced on ADDS only, server-side. Owner / unlimited
      // users bypass it (planLimitFor returns null). The cap now reads the
      // denormalized `count:owned` key (one blob read) instead of scanning
      // every item (T3); the key is lazily backfilled from the index the first
      // time it's needed. Wishlist "wants" never count toward the cap. The
      // read-compare-write race is narrowed the same way as the index (Netlify
      // Blobs has no transactions — see ADR-0001).
      const limit = planLimitFor(user)
      if (limit != null) {
        const ownedCount = await ensureOwnedCount(store, readIndex)
        if (ownedCount >= limit) {
          return json(403, {
            error: `You've reached the free plan limit of ${limit} items. Ask the admin to upgrade your plan.`,
            code: 'PLAN_LIMIT',
          })
        }
      }

      // SEC-EPIC-2 (#188): only allowlisted item fields are written. A crafted
      // body (ownerId/userId/role/plan/collections/id/…) is dropped here — the
      // stored object is built from the allowlist + the server-assigned id, so
      // a client can never change ownership or escalate privileges via a POST.
      const picked = pickItemFields(body)
      const newId = randomUUID()
      const item = { ...picked, id: newId, dateAdded: picked.dateAdded || new Date().toISOString() }
      await store.setJSON(`item:${newId}`, item)
      if (clientOpId != null && clientOpId !== '') await dedupe(newId)
      const ids = await readIndex(store)
      ids.unshift(newId)
      await writeIndex(store, ids)
      // Maintain the owned count (only when it already exists — a missing key
      // is lazily backfilled on the next capped POST, which reads the index
      // AFTER this write, so skipping keeps it correct). Wishlist adds never
      // consume the cap.
      if (!item.wishlist) await adjustOwnedCount(store, +1)
      await invalidateListCache(store)
      // SEC-7.1 (#338): the returned item DTO runs through the shared filter.
      return json(201, filterFor(user, 'item', item, { own: true }))
    }

    if (req.method === 'PUT') {
      if (!id) return json(400, { error: 'Missing id' })
      // SEC-7.1 (#338) non-enumeration: object-by-id access by a caller who
      // does not own the item (not found in the caller's own per-user store)
      // is a uniform 403 FORBIDDEN — never a distinguishable 404 that would
      // reveal "doesn't exist" vs "exists but isn't yours". The owner's own
      // missing id is indistinguishable from another's at the per-user store
      // layer, so it gets the same stable FORBIDDEN.
      const existing = await store.get(`item:${id}`, { type: 'json' })
      if (!existing) return forbidden()
      // SEC-EPIC-2 (#188): the PUT patch is narrowed to the item allowlist
      // before the merge, so a spoofed ownerId/userId/role/plan/id in the body
      // is dropped and can never change ownership or escalate privileges.
      // SEC-3.2 (#195): cap the body before parsing. SEC-3.1 (#194): partial
      // validation (a PUT may patch any subset of fields).
      const parsed = await readJsonBody(req)
      if (parsed.error) return parsed.error
      const v = validateItem(parsed.value, { partial: true })
      if (v.error) return badRequest(v.error)
      const patch = v.item

      // S4 (#58): converting a wishlist item to owned ({ wishlist: false } on a
      // stored wishlist item) is an ADD for cap purposes — it consumes the
      // free-tier cap exactly like a POST. Without this a free-plan member at
      // the cap could silently exceed it by converting wishlist items (only a
      // client-side atLimit guard stopped it, and that can be bypassed). Count
      // owned the same way the POST path does (ensureOwnedCount) and return
      // 403 PLAN_LIMIT at/over the cap. Only the wishlist → owned direction is
      // capped: owned → wishlist (delta -1) and all other edits/deletes stay
      // uncapped, and paid plans / admin / owner are never affected
      // (planLimitFor returns null).
      const limit = planLimitFor(user)
      if (limit != null && wishlistToggleDelta(patch, existing).delta === 1) {
        const ownedCount = await ensureOwnedCount(store, readIndex)
        if (ownedCount >= limit) {
          return json(403, {
            error: `You've reached the free plan limit of ${limit} items. Ask the admin to upgrade your plan.`,
            code: 'PLAN_LIMIT',
          })
        }
      }

      const updated = { ...existing, ...patch, id }
      await store.setJSON(`item:${id}`, updated)
      // A wishlist↔owned toggle changes the owned count; only adjust when the
      // patch actually touches `wishlist` (not on notes/rating edits — T3).
      const { delta } = wishlistToggleDelta(patch, existing)
      if (delta !== 0) await adjustOwnedCount(store, delta)
      await invalidateListCache(store)
      // SEC-7.1 (#338): the returned item DTO runs through the shared filter.
      return json(200, filterFor(user, 'item', updated, { own: true }))
    }

    if (req.method === 'DELETE') {
      if (!id) return json(400, { error: 'Missing id' })
      // SEC-7.1 (#338) non-enumeration: deleting an item the caller does not
      // own (not in their own store) is a uniform 403 FORBIDDEN. This replaces
      // the old idempotent 200/no-op for a missing id — the owner's own ghost
      // id is indistinguishable from another's at the per-user store layer, so
      // a single stable FORBIDDEN prevents an attacker from probing which
      // object ids exist. The old 200-on-missing behavior is a documented
      // SEC-7.1 contract change.
      const existing = await store.get(`item:${id}`, { type: 'json' })
      if (!existing) return forbidden()
      await store.delete(`item:${id}`)
      const ids = await readIndex(store)
      await writeIndex(store, ids.filter((existingId) => existingId !== id))
      if (!existing.wishlist) await adjustOwnedCount(store, -1)
      await invalidateListCache(store)
      return json(200, { ok: true })
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}

// Map the HTTP method to the SEC-7.1 policy action. Unknown methods fall back
// to the least-restrictive read action so auth is still gated before the 405.
function actionFor(method) {
  if (method === 'GET') return 'collection:item:read'
  if (method === 'POST') return 'collection:item:create'
  if (method === 'PUT') return 'collection:item:update'
  if (method === 'DELETE') return 'collection:item:delete'
  return 'collection:item:read'
}

export default async (req) => {
  const url = new URL(req.url)
  const collection = url.searchParams.get('collection') || 'records'
  const id = url.searchParams.get('id')

  // SEC-7.1 (#338): route authorization through the shared policy layer. The
  // action is derived from the method; writes deny the read-only demo identity
  // with the same DEMO_READONLY shape as before. The principal is always the
  // resolved session user — a browser-supplied owner/tenant/id is never
  // trusted. Unsupported methods still resolve the session first (so auth is
  // gated before the 405 below), falling back to the least-restrictive read
  // action.
  const action = actionFor(req.method)
  const { user, error } = await enforce(req, action, {
    denyCode: 'DEMO_READONLY',
    denyMessage: 'The demo collection is read-only. Sign in to add your own items.',
  })
  if (error) return error

  if (!COLLECTIONS[collection]) return json(400, { error: 'Unknown collection.' })
  if (!user.collections?.[collection]) {
    return json(403, { error: `Your plan doesn't include the ${collection} collection.` })
  }

  // Per-user rate limit (T5): a runaway client or a stuck loop can't hammer
  // the blob store. Members/owner are keyed by user id; the shared demo
  // identity is keyed by client IP so one demo visitor never throttles the
  // whole demo. Skipped when there's no identity to key on (e.g. a demo
  // visitor with no forwarded IP header). SEC-7.4.x (#383): routed through
  // rateLimitGuard so 429s emit `rate_limit.served` + the exhaust burst signal.
  // The demo identity keys on the client IP, so its burstScope is an anonymous
  // anomalyScope hash — the raw IP never becomes a burst scope.
  const identity = rateLimitIdentity(user, req)
  if (identity) {
    const burstScope = user.role === 'demo' ? anomalyScope(`rlx:collection:${collection}`, identity) : undefined
    const rl = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: `collection:${collection}`,
      limit: COLLECTION_RATE_LIMIT,
      identity,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope,
    })
    if (rl) return rl
    // SEC-7.4 (#341): write sub-limit on top of the shared read limit. Only
    // POST/PUT/DELETE (state-changing) consume this bucket; reads stay at the
    // higher COLLECTION_RATE_LIMIT.
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      const writeRl = await rateLimitGuard({
        store: getStore(RATE_LIMITS_STORE),
        scope: `collection:${collection}:write`,
        limit: COLLECTION_WRITE_LIMIT,
        identity,
        anomalyStore: getStore(RATE_LIMITS_STORE),
        burstScope,
      })
      if (writeRl) return writeRl
    }
  }

  // The demo space is read-only, enforced server-side through the shared
  // policy layer (the `deny: ['demo']` on the write actions above returns
  // DEMO_READONLY before any work runs).

  // Phase 1 (ADR-0002): when DATABASE_URL is configured, serve from Postgres.
  // SEC-4.1 (#202): Postgres is the configured data authority. A failure here
  // (an outage) returns a CONTROLLED 503 with a clear operational log line —
  // we do NOT silently switch authority to Blobs and serve possibly-different/
  // stale data that would mask the outage. The legitimate read-through
  // backfill fallbacks (0-rows pre-backfill store, not-found item) live inside
  // collection-postgres.js and the demo space never routes through the DB
  // path — both still work. Only the silent authority switch is removed.
  if (isPostgresConfigured()) {
    try {
      return await handlePostgres(req, { user, collection, id, url })
    } catch (err) {
      // Operational alert (message only — never a code/token/key/secret).
      console.error('collection: Postgres data source unavailable (503):', err?.message || err)
      return json(503, {
        error: 'The collection service is temporarily unavailable. Please try again shortly.',
        code: 'DATA_SOURCE_UNAVAILABLE',
      })
    }
  }

  return handleBlobs(req, { user, collection, id, url })
}
