// M3 #161 — Conflict Store (IndexedDB persistence for conflicts).
//
// WHAT THIS IS
// ------------
// A durable IndexedDB store for conflict records detected during
// synchronization. Conflicts are persisted so they survive app restarts and
// can be surfaced to the user for resolution. The store provides:
//   - saveConflict: persist a new conflict record.
//   - getConflicts: read all unresolved conflicts for a user.
//   - getConflict: read a specific conflict by conflictId.
//   - markResolved: update a conflict's status after resolution.
//   - getConflictMetrics: aggregate statistics about conflict frequency and
//     resolution outcomes.
//   - clearConflictsForUser: remove all conflicts for a user on sign-out.
//
// SECURITY (ADR-0019 Dec 4/5/6/8 — mandatory)
//   - No credentials in conflict records: only safe item data is stored
//     (sanitized by conflictResolver.js).
//   - Server-authoritative ownership: scope is derived from the resolved
//     session user id, never client-chosen.
//   - Fail-closed: any IndexedDB failure resolves to safe defaults (null,
//     [], or false) rather than throwing into the UI.
//   - Clear on sign-out: clearConflictsForUser removes all conflicts for a
//     user so they do not surface for another account.

import { openDB, deleteDB } from 'idb'

export const CONFLICT_DB_NAME = 'runout.conflicts'
// Bump ONLY with a tested migration. v1 creates the `conflicts` store.
export const CONFLICT_DB_VERSION = 1

const STORE_CONFLICTS = 'conflicts'
const STORE_META = 'meta'
const MIGRATION_KEY = '__migration__'
const SCOPE_INDEX = 'by_scope'
const STATUS_INDEX = 'by_status'

// True when the platform exposes IndexedDB (browser/PWA).
export function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/**
 * Open the conflict database at the current version. Returns the DB instance,
 * or null on any failure (fail closed).
 */
export async function openConflictDb() {
  if (!idbAvailable()) return null
  try {
    return await openDB(CONFLICT_DB_NAME, CONFLICT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        try {
          upgradeConflictDb(db, oldVersion, transaction)
        } catch (err) {
          transaction.abort()
          throw err
        }
      },
    })
  } catch {
    return null
  }
}

/**
 * Deterministic migration. v1 creates the conflicts store with scope and
 * status indexes, and records a migration audit record.
 */
export function upgradeConflictDb(db, oldVersion, transaction) {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE_CONFLICTS)) {
      const store = db.createObjectStore(STORE_CONFLICTS, { keyPath: 'conflictId' })
      store.createIndex(SCOPE_INDEX, 'scope', { unique: false })
      store.createIndex(STATUS_INDEX, 'status', { unique: false })
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: 'key' })
    }
  }
  const metaStore = transaction.objectStore(STORE_META)
  metaStore.put({
    key: MIGRATION_KEY,
    schemaVersion: CONFLICT_DB_VERSION,
    migratedFrom: oldVersion,
    migratedAt: new Date().toISOString(),
    rollback:
      'forward-only; downgrade => clearAllConflicts() + reopen at lower version',
  })
}

// ---------------------------------------------------------------------------
// Internal helpers (fail-closed)
// ---------------------------------------------------------------------------

async function readMeta(key) {
  const db = await openConflictDb()
  if (!db) return null
  try {
    return await db.get(STORE_META, key)
  } catch {
    return null
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Public API — conflict persistence
// ---------------------------------------------------------------------------

/**
 * Save a conflict record to the persistent store.
 *
 * @param {string} userId - Server-resolved session user id.
 * @param {object} conflict - Conflict descriptor from conflictResolver.js.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function saveConflict(userId, conflict) {
  if (!userId || !conflict?.conflictId) return false

  const scope = `user:${userId}`
  const db = await openConflictDb()
  if (!db) return false

  try {
    const record = {
      ...conflict,
      scope,
    }
    await db.put(STORE_CONFLICTS, record)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/**
 * Read all conflicts for a user, optionally filtered by status.
 *
 * @param {string} userId - Server-resolved session user id.
 * @param {object} [opts]
 * @param {string} [opts.status] - Filter by status ('unresolved' etc).
 * @returns {Promise<Array>} Array of conflict records, or [] on failure.
 */
export async function getConflicts(userId, { status } = {}) {
  const scope = `user:${userId}`
  if (!userId) return []

  const db = await openConflictDb()
  if (!db) return []

  try {
    if (status) {
      const index = db.transaction(STORE_CONFLICTS).store.index(STATUS_INDEX)
      const all = await index.getAll(status)
      return all.filter((r) => r.scope === scope) || []
    }
    const index = db.transaction(STORE_CONFLICTS).store.index(SCOPE_INDEX)
    return (await index.getAll(scope)) || []
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Read a specific conflict by conflictId.
 *
 * @param {string} userId - Server-resolved session user id.
 * @param {string} conflictId - The conflict's stable id.
 * @returns {Promise<object|null>} The conflict record, or null on failure.
 */
export async function getConflict(userId, conflictId) {
  const scope = `user:${userId}`
  if (!userId || !conflictId) return null

  const db = await openConflictDb()
  if (!db) return null

  try {
    const record = await db.get(STORE_CONFLICTS, conflictId)
    if (!record || record.scope !== scope) return null
    return record
  } catch {
    return null
  } finally {
    db.close()
  }
}

/**
 * Mark a conflict as resolved (updates its status, resolution, and resolvedAt).
 *
 * @param {string} userId - Server-resolved session user id.
 * @param {string} conflictId - The conflict's stable id.
 * @param {object} resolvedConflict - The resolved conflict descriptor from
 *   conflictResolver.applyResolution.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function markResolved(userId, conflictId, resolvedConflict) {
  const scope = `user:${userId}`
  if (!userId || !conflictId || !resolvedConflict) return false

  const db = await openConflictDb()
  if (!db) return false

  try {
    const existing = await db.get(STORE_CONFLICTS, conflictId)
    if (!existing || existing.scope !== scope) return false

    const updated = {
      ...existing,
      status: resolvedConflict.status,
      resolution: resolvedConflict.resolution,
      resolvedAt: resolvedConflict.resolvedAt,
      mergedItem: resolvedConflict.mergedItem || undefined,
    }
    await db.put(STORE_CONFLICTS, updated)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/**
 * Count unresolved conflicts for a user.
 *
 * @param {string} userId - Server-resolved session user id.
 * @returns {Promise<number>} The count of unresolved conflicts, or 0 on failure.
 */
export async function countUnresolvedConflicts(userId) {
  if (!userId) return 0
  const conflicts = await getConflicts(userId, { status: 'unresolved' })
  return conflicts.length
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get conflict metrics for a user.
 *
 * @param {string} userId - Server-resolved session user id.
 * @returns {Promise<object>} Metrics object with counts per status, or
 *   defaults on failure.
 */
export async function getConflictMetrics(userId) {
  if (!userId) {
    return {
      totalConflicts: 0,
      unresolved: 0,
      resolvedServer: 0,
      resolvedLocal: 0,
      resolvedMerged: 0,
    }
  }

  const all = await getConflicts(userId)
  const metrics = {
    totalConflicts: all.length,
    unresolved: 0,
    resolvedServer: 0,
    resolvedLocal: 0,
    resolvedMerged: 0,
  }

  for (const c of all) {
    switch (c.status) {
      case 'unresolved':
        metrics.unresolved++
        break
      case 'resolved-server':
        metrics.resolvedServer++
        break
      case 'resolved-local':
        metrics.resolvedLocal++
        break
      case 'resolved-merged':
        metrics.resolvedMerged++
        break
    }
  }

  return metrics
}

// ---------------------------------------------------------------------------
// Clear / reset
// ---------------------------------------------------------------------------

/**
 * Clear all conflicts for ONE user.
 *
 * @param {string} userId - Server-resolved session user id.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function clearConflictsForUser(userId) {
  const scope = `user:${userId}`
  if (!userId) return true

  const db = await openConflictDb()
  if (!db) return false

  try {
    const tx = db.transaction(STORE_CONFLICTS, 'readwrite')
    const store = tx.objectStore(STORE_CONFLICTS)
    const index = store.index(SCOPE_INDEX)
    let cursor = await index.openCursor(scope)
    while (cursor) {
      store.delete(cursor.primaryKey)
      cursor = await cursor.continue()
    }
    await tx.done
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/**
 * Clear ALL conflicts (sign-out / logout-all).
 *
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function clearAllConflicts() {
  if (!idbAvailable()) return true
  try {
    await deleteDB(CONFLICT_DB_NAME)
    return true
  } catch {
    return false
  }
}

/**
 * Get the migration audit record.
 *
 * @returns {Promise<object|null>} The migration record, or null on failure.
 */
export async function getMigrationRecord() {
  return readMeta(MIGRATION_KEY)
}