// M2 #292 — Outbox flush + reconcile (the "minimal idempotent push + reconcile"
// of the ADR-0019 Decision 7 M2/M3 sync boundary).
//
// On reconnect (online / visibility), each durable outbox op is pushed with its
// STABLE idempotency key (`opId`), the server re-authorizes it, and the accepted
// mutation is re-applied back to the local mirror. This module is the pure,
// testable orchestration; it does NOT ship full bidirectional pull, cursors,
// delta sync or OCC/version checks — those are M3 (#160/#161).
//
// FAIL-CLOSED SURFACING (ADR-0016 rule 12 + ADR-0019 Decision 8): a push that
// fails or is rejected is marked `failed` and KEPT durable + retryable; its
// error message is surfaced in the result (`failedOps`) so the UI can show the
// user that an item is still pending — never silently discarded.
//
// The push and the mirror/list reads are injected so this module is unit-testable
// without a network or a live IndexedDB; production callers pass the real api /
// repository functions (see useOutboxSync / useCollection).

import * as api from '../api/collection'
import { listPendingOps, markFailed, markFlushed } from './outbox'
import { saveMirror } from './offlineMirror'

/**
 * Push every pending/failed add for a user with its idempotency key, then
 * reconcile the local mirror from the server list so a pushed pending item is
 * re-keyed to its server id (idempotent — never a duplicate).
 *
 * @returns {{ attempted:number, pushed:number, failed:number, failedOps:Array<{opId:string,message:string}> }}
 */
export async function flushPendingOps({
  userId,
  token,
  collection = 'records',
  push = (item, coll, opts) => api.addItem(item, coll, opts),
  listAll = (coll) => api.listItems(coll),
  listPending = (uid, o) => listPendingOps(uid, o),
  markFlushedFn = (uid, opId, item, o) => markFlushed(uid, opId, item, o),
  markFailedFn = (uid, opId, message, o) => markFailed(uid, opId, message, o),
  saveMirrorFn = (uid, items, o) => saveMirror(uid, items, o),
  now = Date.now(),
} = {}) {
  const ops = await listPending(userId, { now, token })
  const result = { attempted: 0, pushed: 0, failed: 0, failedOps: [] }

  for (const op of ops) {
    result.attempted += 1
    try {
      // The staged item carries the stable local uuid; the server re-authorizes
      // the add and assigns its own server id. The idempotency key is the opId.
      const payload = op.pendingItem ? { ...op.pendingItem } : {}
      const serverItem = await push(payload, op.collection || collection, {
        clientOpId: op.opId,
      })
      await markFlushedFn(userId, op.opId, serverItem, { now, token })
      result.pushed += 1
    } catch (err) {
      const message = (err && err.message) || 'sync failed'
      await markFailedFn(userId, op.opId, message, { now, token })
      result.failed += 1
      result.failedOps.push({ opId: op.opId, message })
    }
  }

  // Reconcile: after at least one successful push, refresh the local mirror from
  // the server so the pending (local:) record is re-keyed to its server identity.
  // Best-effort — if the mirror write fails, the next online refresh() reconciles.
  if (result.pushed > 0 && userId) {
    try {
      const fresh = await listAll(collection)
      await saveMirrorFn(userId, fresh, { now })
    } catch {
      /* reconcile is best-effort; a later refresh reconciles */
    }
  }

  return result
}
