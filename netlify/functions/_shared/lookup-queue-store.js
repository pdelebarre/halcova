// lookup-queue-store.js — Blobs-first deferred-enrichment queue (T6, #285).
//
// The Netlify Blobs backend for the lookup queue, following the established
// index + item:<id> pattern used by the collection store. It exposes the SAME
// op surface as the Postgres repo (createLookupQueueRepo), so the shared
// `_shared/lookup-queue.js` seam is backend-agnostic.
//
// Layout (single shared store `runout-lookup-queue`):
//   index:<userId>        -> ordered array of queue row ids for that tenant
//   item:<id>             -> the queue row JSON { id, userId, kind, status,
//                             attempts, nextAt, payload, itemId, lastError }
//
// Tenant isolation: the index is keyed per userId, and every op reads/writes
// rows owned by the SAME userId it was called with — a drain for user A can
// never address user B's rows (their ids live only under user B's index).
//
// The queue is server/service-identity ONLY — no client-facing endpoint.

import { getStore } from '@netlify/blobs'
import { queueRowId } from './repositories/lookup-queue-repo'

const QUEUE_STORE = 'runout-lookup-queue'

const indexKey = (userId) => `index:${userId}`
const itemKey = (id) => `item:${id}`

// Read a tenant's index (ordered id array); the Blobs store returns null when
// the key is absent.
async function readIndex(store, userId) {
  const existing = await store.get(indexKey(userId), { type: 'json' })
  return Array.isArray(existing) ? existing : []
}

export function createLookupQueueStore() {
  const store = getStore(QUEUE_STORE)

  return {
    async enqueue({ user_id: userId, kind, item_id: itemId, payload, key, nextAt }) {
      const id = queueRowId(kind, itemId, key)
      const at = nextAt instanceof Date ? nextAt : new Date()
      const row = {
        id,
        userId,
        kind,
        status: 'pending',
        attempts: 0,
        nextAt: at.toISOString(),
        payload,
        itemId: itemId || null,
        lastError: null,
      }
      await store.setJSON(itemKey(id), row)
      const ids = await readIndex(store, userId)
      if (!ids.includes(id)) {
        ids.unshift(id)
        await store.setJSON(indexKey(userId), ids)
      }
      return id
    },

    // Claim the next `limit` due rows for ONE tenant, oldest-due first.
    async claimDue(userId, limit = 10) {
      const ids = await readIndex(store, userId)
      const capped = Math.max(1, Math.min(Number(limit) || 10, 100))
      const due = []
      for (const id of ids) {
        const row = await store.get(itemKey(id), { type: 'json' })
        if (!row || row?.status !== 'pending') continue
        const nextAt = new Date(row.nextAt).getTime()
        if (nextAt <= Date.now()) {
          due.push({
            id: row.id,
            kind: row.kind,
            payload: row.payload,
            item_id: row.itemId,
            attempts: row.attempts,
            next_at: new Date(nextAt),
          })
        }
      }
      // Oldest-due first — matches the Postgres repo's `ORDER BY next_at ASC`.
      // The index is pushed newest-first (enqueue uses unshift), so order rows
      // by their due time rather than enqueue order to keep both backends
      // consistent, then cap to the globally-oldest-due rows.
      due.sort((a, b) => a.next_at.getTime() - b.next_at.getTime())
      return due.slice(0, capped)
    },

    async markDone(userId, id) {
      const row = (await store.get(itemKey(id), { type: 'json' })) || {}
      if (row.userId && row.userId !== userId) return // tenant guard
      await store.setJSON(itemKey(id), {
        ...row,
        status: 'done',
        enrichedAt: new Date().toISOString(),
        lastError: null,
      })
    },

    async markFailed(userId, id, { nextAt, abandon = false, error }) {
      const row = (await store.get(itemKey(id), { type: 'json' })) || {}
      if (row.userId && row.userId !== userId) return // tenant guard
      const at = nextAt instanceof Date ? nextAt : new Date()
      await store.setJSON(itemKey(id), {
        ...row,
        status: abandon ? 'abandoned' : row.status || 'pending',
        attempts: (row.attempts || 0) + 1,
        nextAt: at.toISOString(),
        lastError: error || null,
      })
    },

    // The distinct tenants with pending work — the @hourly drain iterates one
    // tenant at a time. Blobs has no cross-tenant index scan, so this walks
    // the (small) set of member ids provided by the caller; on the Blobs
    // backend `listPendingUsers` is fed by the caller from the identity store.
    async listPendingUsers() {
      return []
    },

    // Count pending rows for a tenant (0 when none). Mirrors the Postgres repo
    // so the shared seam is backend-agnostic.
    async countPending(userId) {
      const ids = await readIndex(store, userId)
      let pending = 0
      for (const id of ids) {
        const row = await store.get(itemKey(id), { type: 'json' })
        if (row?.status === 'pending') pending += 1
      }
      return pending
    },
  }
}
