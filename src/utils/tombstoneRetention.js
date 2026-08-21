// M3 #161 — Tombstone Retention Policy (ADR-0019 Dec 8).
//
// WHAT THIS IS
// ------------
// Tombstones are retained until synchronization safety conditions are met.
// They cannot be deleted immediately after a delete is pushed — we must
// wait until we have confirmation that the server has processed the deletion
// and no subsequent pull would resurrect the item.
//
// Retention policy:
//   - A tombstone is safe to clear when:
//     1. The delete has been pushed and acknowledged by the server (flushed
//        outbox state), AND
//     2. A pull cycle has completed with a cursor that is AFTER the delete
//        timestamp (so the server won't re-send the deleted item).
//   - Minimum retention period: 1 hour (grace period for reconnection).
//   - Tombstones are always cleared on sign-out / account switch.
//
// SECURITY (ADR-0019 Dec 4/5/6/8)
//   - No credentials in tombstones: only uuid, scope, serverId, and timestamp.
//   - Server-authoritative ownership: scope is server-resolved.
//   - Fail-closed: any error returns false / [].

import { getTombstones, clearTombstone } from '../repositories/localDatabase'

// Minimum retention period: 1 hour (configurable for testing)
export const MIN_TOMBSTONE_RETENTION_MS = 60 * 60 * 1000

/**
 * Check if a tombstone is safe to clear.
 *
 * Safety conditions:
 *   1. The tombstone has existed for at least MIN_TOMBSTONE_RETENTION_MS.
 *   2. (Future) The server has acknowledged the deletion and the pull cursor
 *      has passed the deletion timestamp.
 *
 * @param {object} tombstone - The tombstone record from localDatabase.
 * @param {number} [now=Date.now()] - Current timestamp.
 * @returns {boolean} True if the tombstone can be safely cleared.
 */
export function isTombstoneSafeToClear(tombstone, now = Date.now()) {
  if (!tombstone) return false
  if (!tombstone.deletedAt) return false

  const deletedAt = new Date(tombstone.deletedAt).getTime()
  if (isNaN(deletedAt)) return false

  // Must have existed for at least the minimum retention period
  return (now - deletedAt) >= MIN_TOMBSTONE_RETENTION_MS
}

/**
 * Prune tombstones that are safe to clear for a user.
 * Returns the number of tombstones cleared.
 *
 * @param {string} userId - Server-resolved session user id.
 * @param {number} [now=Date.now()] - Current timestamp.
 * @returns {Promise<number>} Number of tombstones cleared, or 0 on failure.
 */
export async function pruneSafeTombstones(userId, now = Date.now()) {
  if (!userId) return 0

  const tombstones = await getTombstones(userId)
  if (!tombstones || tombstones.length === 0) return 0

  let cleared = 0
  for (const tombstone of tombstones) {
    if (isTombstoneSafeToClear(tombstone, now)) {
      const ok = await clearTombstone(userId, tombstone.uuid)
      if (ok) cleared++
    }
  }

  return cleared
}

/**
 * Get the count of retained tombstones for a user (for metrics).
 *
 * @param {string} userId - Server-resolved session user id.
 * @returns {Promise<number>} Count of tombstones, or 0 on failure.
 */
export async function countRetainedTombstones(userId) {
  if (!userId) return 0
  const tombstones = await getTombstones(userId)
  return tombstones ? tombstones.length : 0
}