// blocks-repo.js — Postgres blocks repository (FEAT-8.2, #327, ground for #330).
//
// STUB: This module provides the isBlocked check that the feed authorization
// pipeline requires. #330 will implement the full block model (user blocks
// another user → their activities are filtered out of the blocked user's feed).
//
// Until #330 lands, isBlocked always returns false — no block filtering is
// applied. When #330 is implemented, this module will be replaced with the real
// blocks table query.
//
// The feed authorization pipeline calls isBlocked(viewerId, activityUserId)
// for each activity before including it in the response. This design ensures
// that when blocks are implemented, the feed will automatically exclude blocked
// users' activities without any pipeline changes.

export function createBlocksRepo(_db) {
  // Check if `viewerId` has blocked `targetUserId` (or vice versa — blocks are
  // symmetric for feed filtering). Returns false until #330 implements the
  // blocks table.
  async function isBlocked(_viewerId, _targetUserId) {
    return false
  }

  return {
    isBlocked,
  }
}