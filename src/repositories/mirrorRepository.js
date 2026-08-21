// M2 #158 — Mirror Repository (formal wrapper around offlineMirror.js).
//
// WHAT THIS IS
// ------------
// A repository abstraction over the existing #289 offlineMirror.js, providing
// a consistent interface for the local-first persistence layer. It does NOT
// duplicate the IndexedDB logic from offlineMirror.js — it delegates to it.
//
// The mirror is a READ-ONLY cache of the last-known server item list. It is
// NOT the authoritative local store for mutations (that is the item repository
// in localDatabase.js). The mirror exists so the collector can answer "do I
// already own this?" and browse their synchronized collection with no network.
//
// RELATIONSHIP TO #289/#292
// -------------------------
// This is a thin wrapper that re-exports the existing offlineMirror.js API
// through a repository interface. It does not change the mirror's schema,
// security model, or isolation boundaries.
//
// SECURITY / ISOLATION
// --------------------
// Inherited from offlineMirror.js (ADR-0019 Dec 4/5/6):
//   - scope is server-authoritative (mirrorScope(userId))
//   - no credentials in IDB
//   - reads gated by offline trust (collection scope)
//   - clear/isolate on sign-out / account switch

import {
  clearAllMirror as clearAll,
  clearMirrorForUser as clearForUser,
  findDuplicatesInMirror as findDups,
  readMirror as read,
  saveMirror as save,
} from '../utils/offlineMirror'

/**
 * Save the last-known item list to the mirror. Delegates to
 * offlineMirror.saveMirror. Returns true on success, false on failure.
 */
export async function saveMirror(userId, items, options = {}) {
  return save(userId, items, options)
}

/**
 * Read the offline mirror for a userId. Returns the item list with cachedAt
 * stamp, or null when offline access is not granted or no cached data exists.
 */
export async function readMirror(userId, options = {}) {
  return read(userId, options)
}

/**
 * Find duplicates in the local mirror. Returns null when offline access is
 * not granted or no mirror exists.
 */
export async function findDuplicatesInMirror(userId, candidate, options = {}) {
  return findDups(userId, candidate, options)
}

/**
 * Clear the mirror for ONE user. Returns true on success, false on failure.
 */
export async function clearMirrorForUser(userId) {
  return clearForUser(userId)
}

/**
 * Clear the ENTIRE mirror. Returns true on success, false on failure.
 */
export async function clearAllMirror() {
  return clearAll()
}