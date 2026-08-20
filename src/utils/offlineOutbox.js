// M2 Offline Mutation Outbox — defined read interface (#159; ADR-0019 Dec 7/8).
//
// #159 ships the offline UX STATES for queued/synced/conflict operations and a
// DEFINED READ INTERFACE that the M2 outbox (#292, runs in parallel on a
// separate branch) will implement against IndexedDB. #159 does NOT depend on
// #292 being merged: before the outbox store exists, this module fails CLOSED
// by reporting an empty queue, so the UI renders "all changes synced" / "no
// pending changes" — never a fabricated or silently-untracked mutation.
//
// The interface deliberately mirrors #292's contract (operation IDs, status
// enum, idempotency) so that when #292 lands it can implement `readOutboxOps`
// against the same durable outbox without changing #159's consumers:
//
//   - Every offline mutation has a deterministic operation ID (itemUuid.js).
//   - Ops are tracked as: pending (queued, not yet pushed) / conflict / error
//     (failed) / synced (acknowledged).
//   - Reading the outbox never writes; writes go through #292's enqueue path.
//
// SECURITY (ADR-0019 Dec 12): the op records surfaced here carry only a safe,
// non-secret `kind` label for display. A returned op NEVER carries raw
// credentials, access codes, tokens, or raw private collection contents in any
// field the UI renders. Sync errors are surfaced as generic safe messages by
// the UI, not by echoing raw exception text.

import { mirrorScope } from './offlineMirror'

// Operation lifecycle statuses. #292 writes these; #159 reads them.
export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFLICT: 'conflict',
  ERROR: 'error',
  SYNCED: 'synced',
})

// The collection scope the outbox tracks (matches OFFLINE_SCOPES.COLLECTION).
export const OUTBOX_SCOPE = 'collection'

/**
 * Read the outbox operations for a user's scope.
 *
 * @param {string} userId  Server-resolved session user id (never client-chosen).
 * @param {object} [opts]
 * @returns {Promise<Array>} A list of tracked operations, each of the shape
 *   `{ opId, status, kind }`. Before #292's durable outbox store exists, this
 *   resolves to `[]` (fail closed — an empty queue, never a silent mutation).
 */
export async function readOutboxOps(userId, { scope = OUTBOX_SCOPE } = {}) {
  // `scope` is part of the defined #292 contract (the outbox is scoped per
  // user+capability). Before #292's durable store exists we read nothing, but
  // the parameter is reserved so the signature matches the upcoming contract.
  void scope
  const scopeKey = mirrorScope(userId)
  if (!scopeKey) return []
  // TODO(#292): read the durable outbox store for this scope. Until then the
  // queue is empty by design so the UI never shows a fabricated pending state.
  return []
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
 * Summarize the outbox into counts the UI can render. Fails closed: a missing
 * or empty outbox yields all-zero counts (never null, never throws).
 *
 * @param {string} userId  Server-resolved session user id.
 * @returns {Promise<{pending:number, conflict:number, error:number, synced:number}>}
 */
export async function readOutboxSummary(userId, { scope = OUTBOX_SCOPE } = {}) {
  const ops = await readOutboxOps(userId, { scope })
  return summarizeOps(ops)
}
