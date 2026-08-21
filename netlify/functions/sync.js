// M3 #160 — Idempotent Push/Pull Synchronization endpoint (ADR-0019 Dec 7/8).
//
// WHAT THIS IS
// ------------
// A dedicated Netlify function for bidirectional sync. It handles:
//   - POST /sync/push — Batch-push operations with stable idempotency keys.
//     Each operation is re-authorized server-side and processed idempotently.
//     Returns per-op acceptance/rejection responses.
//   - POST /sync/pull — Incremental pull with cursor. Returns items modified
//     since the last cursor, plus a new cursor for the next pull.
//
// RELATIONSHIP TO collection.js
// -----------------------------
// The existing collection.js handles individual CRUD operations with clientOpId
// deduplication. This function provides a BATCH sync interface that:
//   - Accepts multiple operations in one request (reduces round-trips).
//   - Returns per-op results so the client can mark each op flushed/failed.
//   - Supports cursor-based incremental pull (collection.js does not).
//
// SECURITY (ADR-0019 Dec 4/5/6/7/8 — mandatory)
//   - No credentials in sync payloads: only safe op IDs and item data.
//   - Server-authoritative ownership: client identifiers never authoritative.
//   - Re-authorization at sync time: every request resolves the session.
//   - Cross-tenant replay rejection: ops are scoped to the resolved user.
//   - No silent discard (ADR-0016 rule 12): rejected ops are returned with
//     a reason, never silently dropped.
//   - Fail-closed on corrupt/malformed payloads: returns 400 with error.

import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { json, readJsonBody, safeError } from './_shared/security'
import { resolveSession } from './_shared/session-auth'
import { enforce, forbidden } from './_shared/policy'
import { COLLECTIONS, readIndex, writeIndex } from './_shared/collection-store'
import { storeNameFor } from './_shared/users'
import { pickItemFields, validateItem } from './_shared/item-fields'
import { planLimitFor } from './_shared/plans'
import { ensureOwnedCount, adjustOwnedCount } from './_shared/counts'
import { invalidateListCache } from './_shared/list-cache'
import { filterFor } from './_shared/filter'
import { isPostgresConfigured } from './_shared/postgres'
import { getRepository } from './_shared/repository'

const SYNC_STORE = 'runout-sync'
const CURSOR_PREFIX = 'cursor:'
const IDEMPOTENCY_PREFIX = 'idempotency:'
const SYNC_LOG_PREFIX = 'synclog:'

// ---------------------------------------------------------------------------
// Cursor management
// ---------------------------------------------------------------------------

/**
 * Read the current pull cursor for a user+collection. Returns ISO timestamp
 * string, or null if no cursor exists yet.
 */
async function readCursor(store, userId, collection) {
  try {
    const val = await store.get(`${CURSOR_PREFIX}${userId}:${collection}`)
    return val || null
  } catch {
    return null
  }
}

/**
 * Write the pull cursor for a user+collection.
 */
async function writeCursor(store, userId, collection, cursor) {
  try {
    await store.set(`${CURSOR_PREFIX}${userId}:${collection}`, cursor)
  } catch {
    /* best-effort */
  }
}

/**
 * Record an idempotency mapping: clientOpId -> server item id.
 */
async function recordIdempotency(store, clientOpId, itemId) {
  try {
    await store.setJSON(`${IDEMPOTENCY_PREFIX}${clientOpId}`, {
      itemId,
      recordedAt: new Date().toISOString(),
    })
  } catch {
    /* best-effort */
  }
}

/**
 * Look up an idempotency mapping. Returns the item id, or null.
 */
async function lookupIdempotency(store, clientOpId) {
  try {
    const rec = await store.get(`${IDEMPOTENCY_PREFIX}${clientOpId}`, { type: 'json' })
    return rec?.itemId || null
  } catch {
    return null
  }
}

/**
 * Append an entry to the sync log for a user+collection. The sync log tracks
 * item modifications so the pull endpoint can return changes since a cursor.
 * Each entry is keyed by a timestamp for cursor-based iteration.
 */
async function appendSyncLog(store, userId, collection, entry) {
  try {
    const ts = new Date().toISOString()
    const key = `${SYNC_LOG_PREFIX}${userId}:${collection}:${ts}:${entry.itemId || randomUUID()}`
    await store.setJSON(key, { ...entry, timestamp: ts })
  } catch {
    /* best-effort */
  }
}

/**
 * Read sync log entries for a user+collection since a cursor timestamp.
 * Returns { entries, hasMore }.
 */
async function readSyncLogSince(store, userId, collection, cursor, limit = 100) {
  try {
    const prefix = `${SYNC_LOG_PREFIX}${userId}:${collection}:`
    const allKeys = []
    // List all keys with this prefix (Blobs list is prefix-based)
    const listed = store.list({ prefix })
    for await (const entry of listed) {
      allKeys.push(entry.key)
    }
    // Sort by timestamp (embedded in key after the prefix)
    allKeys.sort()
    // Filter to entries after cursor
    const after = cursor
      ? allKeys.filter((k) => {
          const tsPart = k.replace(prefix, '').split(':')[0]
          return tsPart > cursor
        })
      : allKeys
    const slice = after.slice(0, limit)
    const entries = []
    for (const key of slice) {
      try {
        const val = await store.get(key, { type: 'json' })
        if (val) entries.push(val)
      } catch {
        /* skip corrupt entries */
      }
    }
    return { entries, hasMore: after.length > limit }
  } catch {
    return { entries: [], hasMore: false }
  }
}

// ---------------------------------------------------------------------------
// Push handler
// ---------------------------------------------------------------------------

/**
 * Process a single push operation. Returns { opId, status, item?, error? }.
 */
async function processPushOp(user, collection, op, syncStore) {
  const { opId, kind, item } = op
  if (!opId) return { opId: opId || 'unknown', status: 'rejected', error: 'Missing opId' }

  try {
    if (kind === 'add') {
      // Idempotency check
      const existingId = await lookupIdempotency(syncStore, opId)
      if (existingId) {
        // Return the existing item — idempotent replay
        const userStore = getStore(storeNameFor(user.id, collection))
        const existing = await userStore.get(`item:${existingId}`, { type: 'json' })
        if (existing) {
          return { opId, status: 'accepted', item: filterFor(user, 'item', existing, { own: true }) }
        }
      }

      // Validate the item payload
      const v = validateItem(item || {})
      if (v.error) return { opId, status: 'rejected', error: v.error }

      // Plan limit check
      const limit = planLimitFor(user)
      if (limit != null) {
        const userStore = getStore(storeNameFor(user.id, collection))
        const ownedCount = await ensureOwnedCount(userStore, readIndex)
        if (ownedCount >= limit) {
          return { opId, status: 'rejected', error: `Plan limit of ${limit} items reached.`, code: 'PLAN_LIMIT' }
        }
      }

      // Create the item
      const picked = pickItemFields(item)
      const newId = randomUUID()
      const newItem = { ...picked, id: newId, dateAdded: picked.dateAdded || new Date().toISOString() }
      const userStore = getStore(storeNameFor(user.id, collection))
      await userStore.setJSON(`item:${newId}`, newItem)
      await recordIdempotency(syncStore, opId, newId)

      // Update index
      const ids = await readIndex(userStore)
      ids.unshift(newId)
      await writeIndex(userStore, ids)
      if (!newItem.wishlist) await adjustOwnedCount(userStore, +1)
      await invalidateListCache(userStore)

      // Record in sync log for pull
      await appendSyncLog(syncStore, user.id, collection, {
        itemId: newId,
        kind: 'add',
        opId,
      })

      return { opId, status: 'accepted', item: filterFor(user, 'item', newItem, { own: true }) }
    }

    if (kind === 'update') {
      const { itemId, patch } = op
      if (!itemId) return { opId, status: 'rejected', error: 'Missing itemId for update' }

      const userStore = getStore(storeNameFor(user.id, collection))
      const existing = await userStore.get(`item:${itemId}`, { type: 'json' })
      if (!existing) return { opId, status: 'rejected', error: 'Item not found', code: 'NOT_FOUND' }

      const v = validateItem(patch || {}, { partial: true })
      if (v.error) return { opId, status: 'rejected', error: v.error }

      const picked = pickItemFields(v.item)
      const updated = { ...existing, ...picked, id: itemId }
      await userStore.setJSON(`item:${itemId}`, updated)
      await invalidateListCache(userStore)

      await appendSyncLog(syncStore, user.id, collection, {
        itemId,
        kind: 'update',
        opId,
      })

      return { opId, status: 'accepted', item: filterFor(user, 'item', updated, { own: true }) }
    }

    if (kind === 'delete') {
      const { itemId } = op
      if (!itemId) return { opId, status: 'rejected', error: 'Missing itemId for delete' }

      const userStore = getStore(storeNameFor(user.id, collection))
      const existing = await userStore.get(`item:${itemId}`, { type: 'json' })
      if (!existing) {
        // Already deleted — idempotent success
        return { opId, status: 'accepted', item: null }
      }

      await userStore.delete(`item:${itemId}`)
      const ids = await readIndex(userStore)
      await writeIndex(userStore, ids.filter((id) => id !== itemId))
      if (!existing.wishlist) await adjustOwnedCount(userStore, -1)
      await invalidateListCache(userStore)

      await appendSyncLog(syncStore, user.id, collection, {
        itemId,
        kind: 'delete',
        opId,
      })

      return { opId, status: 'accepted', item: null }
    }

    return { opId, status: 'rejected', error: `Unknown operation kind: ${kind}` }
  } catch (err) {
    return { opId, status: 'rejected', error: err?.message || 'Internal error' }
  }
}

/**
 * Handle a push request: accept a batch of operations, process each
 * idempotently, return per-op results.
 */
async function handlePush(req, { user }) {
  const parsed = await readJsonBody(req)
  if (parsed.error) return parsed.error

  const { operations, collection = 'records' } = parsed.value || {}
  if (!Array.isArray(operations) || operations.length === 0) {
    return json(400, { error: 'Missing or empty operations array', code: 'BAD_REQUEST' })
  }

  if (!COLLECTIONS[collection]) {
    return json(400, { error: 'Unknown collection.', code: 'BAD_REQUEST' })
  }

  if (!user.collections?.[collection]) {
    return json(403, { error: `Your plan doesn't include the ${collection} collection.`, code: 'PLAN_LIMIT' })
  }

  const syncStore = getStore(SYNC_STORE)
  const results = []

  for (const op of operations) {
    const result = await processPushOp(user, collection, op, syncStore)
    results.push(result)
  }

  // Update the cursor to now (so the next pull sees these changes)
  const now = new Date().toISOString()
  await writeCursor(syncStore, user.id, collection, now)

  return json(200, { results, cursor: now })
}

// ---------------------------------------------------------------------------
// Pull handler
// ---------------------------------------------------------------------------

/**
 * Handle a pull request: return items modified since the cursor.
 */
async function handlePull(req, { user }) {
  const parsed = await readJsonBody(req)
  if (parsed.error) return parsed.error

  const { cursor, collection = 'records', limit = 100 } = parsed.value || {}

  if (!COLLECTIONS[collection]) {
    return json(400, { error: 'Unknown collection.', code: 'BAD_REQUEST' })
  }

  if (!user.collections?.[collection]) {
    return json(403, { error: `Your plan doesn't include the ${collection} collection.`, code: 'PLAN_LIMIT' })
  }

  const syncStore = getStore(SYNC_STORE)
  const userStore = getStore(storeNameFor(user.id, collection))

  // Read the stored cursor (or use the provided one)
  const storedCursor = await readCursor(syncStore, user.id, collection)
  const effectiveCursor = cursor || storedCursor

  // Read sync log entries since cursor
  const { entries, hasMore } = await readSyncLogSince(
    syncStore,
    user.id,
    collection,
    effectiveCursor,
    limit,
  )

  // Fetch the actual items for add/update entries
  const itemIds = new Set()
  const deletedIds = new Set()
  for (const entry of entries) {
    if (entry.kind === 'delete') {
      deletedIds.add(entry.itemId)
    } else if (entry.itemId) {
      itemIds.add(entry.itemId)
    }
  }

  const items = []
  for (const id of itemIds) {
    try {
      const item = await userStore.get(`item:${id}`, { type: 'json' })
      if (item) items.push(filterFor(user, 'item', item, { own: true }))
    } catch {
      /* skip */
    }
  }

  // Determine the new cursor (latest timestamp among entries, or now)
  const timestamps = entries.map((e) => e.timestamp).filter(Boolean).sort()
  const newCursor = timestamps.length > 0 ? timestamps[timestamps.length - 1] : new Date().toISOString()
  await writeCursor(syncStore, user.id, collection, newCursor)

  return json(200, {
    items,
    deletedIds: [...deletedIds],
    cursor: newCursor,
    hasMore,
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default async (req) => {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/\.netlify\/functions\/sync/, '')

  // Resolve the session (re-authorization at sync time)
  const { user, error } = await resolveSession(req)
  if (error) return error

  if (path === '/push' && req.method === 'POST') {
    return handlePush(req, { user })
  }

  if (path === '/pull' && req.method === 'POST') {
    return handlePull(req, { user })
  }

  return json(405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
}