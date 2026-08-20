// M2 Offline Mutation Outbox — read interface (#159; ADR-0019 Dec 7/8/12).
//
// #159 ships the offline UX STATES for queued/synced/error operations and a
// read interface over the M2 durable outbox (#292, merged into main as
// src/utils/outbox.js + outboxSync.js). This module is the READ adapter that
// the UI consumes: it reads the REAL #292 outbox (listPendingOps) and reduces
// it to the minimal safe shape `{ opId, status, kind }` that SyncStatus /
// useOfflineSyncStatus render.
//
// SECURITY (ADR-0019 Dec 12 — mandatory): the op records surfaced here carry
// ONLY a safe status label + a non-secret kind. A surfaced op NEVER carries a
// raw pendingItem, barcode, ocrText, lastError, token or access code — the
// #292 durable records are mapped down to `{ opId, status, kind }` before they
// leave this module, so the UI can never render a raw payload or secret.
//
// FAIL-CLOSED: any missing scope, missing/expired offline trust, or IndexedDB
// failure resolves to an empty queue (all-zero counts) rather than a throw —
// the UI never renders a fabricated or silently-untracked mutation, and never
// dark-screens.

import { getSessionToken } from './session'
import { listPendingOps } from './outbox'
import { mirrorScope } from './offlineMirror'

// Operation lifecycle statuses the UI understands. #292 writes `pending` /
// `failed` / `flushed`; this adapter maps failed -> ERROR (the "couldn't sync"
// attention state) and pending -> PENDING. CONFLICT is M3 (#160/#161) — M2
// only queues adds, so conflict counts stay 0 until a conflict matrix lands.
export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFLICT: 'conflict',
  ERROR: 'error',
  SYNCED: 'synced',
})

// The collection scope the outbox tracks (matches OFFLINE_SCOPES.COLLECTION).
export const OUTBOX_SCOPE = 'collection'

/**
 * Read the outbox operations for a user's scope, reduced to the SAFE UI shape.
 *
 * @param {string} userId  Server-resolved session user id (never client-chosen).
 * @param {object} [opts]
 * @returns {Promise<Array>} A list of `{ opId, status, kind }` records. Reads
 *   the real #292 durable outbox (listPendingOps) and strips every raw payload
 *   before returning — never a raw item/barcode/ocrText/error/token.
 */
export async function readOutboxOps(userId, { scope = OUTBOX_SCOPE } = {}) {
  void scope
  const scopeKey = mirrorScope(userId)
  if (!scopeKey) return []
  const ops = await listPendingOps(userId, { token: getSessionToken() })
  return ops.map((op) => ({
    opId: op.opId,
    status:
      op.state === 'failed' ? OUTBOX_STATUS.ERROR : OUTBOX_STATUS.PENDING,
    kind: op.kind || 'add',
  }))
}

/**
 * Summarize a list of operations into counts. Pure + fail-closed: unknown or
 * missing statuses are ignored; malformed input never throws.
 *
 * @param {Array} [ops] A list of op records `{ status, ... }`.
 * @returns {{pending:number, conflict:number, error:number, synced:number}}
 */
export function summarizeOps(ops = []) {
  const summary = { pending: 0, conflict: 0, error: 0, synced: 0 }
  for (const op of ops || []) {
    if (op && summary[op.status] !== undefined) summary[op.status] += 1
  }
  return summary
}

/**
 * Summarize the outbox into counts the UI can render. Fails closed: a missing,
 * empty or untrusted outbox yields all-zero counts (never null, never throws).
 *
 * @param {string} userId  Server-resolved session user id.
 * @returns {Promise<{pending:number, conflict:number, error:number, synced:number}>}
 */
export async function readOutboxSummary(userId, { scope = OUTBOX_SCOPE } = {}) {
  const ops = await readOutboxOps(userId, { scope })
  return summarizeOps(ops)
}
