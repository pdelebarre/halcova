// M2 #158 — Shared IndexedDB database management using `idb` (ADR-0019 Dec 2/6).
//
// WHAT THIS IS
// ------------
// A thin, shared utility that wraps `idb` (the Jake Archibald IndexedDB wrapper)
// for the local-first persistence layer. It provides:
//   - a single versioned database (`runout.local`) with multiple object stores
//     for items, tombstones, and metadata;
//   - deterministic schema upgrades with migration evidence;
//   - fail-closed open/upgrade semantics (any IDB failure returns null);
//   - scope-based keying for tenant/user/device isolation.
//
// RELATIONSHIP TO #289/#292
// -------------------------
// #289 (offlineMirror.js) and #292 (outbox.js) already provide IndexedDB stores
// for the collection mirror and mutation outbox, each with their own database
// (`runout.offlineMirror`, `runout.outbox`). This module does NOT replace them.
// Instead, it provides a NEW database (`runout.local`) for the formal item
// repository with full sync-status columns, tombstones, and version tracking
// that the mirror/outbox stores do not have. The three databases coexist:
//
//   runout.offlineMirror  — last-known server item list (read-only cache)
//   runout.outbox         — durable mutation queue (pending/flushed/failed ops)
//   runout.local          — local-first item store with sync metadata (NEW)
//
// The mirror and outbox continue to serve their existing roles; the local
// repository adds the durable local state that M3 sync (#160/#161) will
// reconcile against.
//
// SECURITY / ISOLATION (ADR-0019 Dec 4/5/6 — mandatory)
//   - NO credentials in IDB: we never write the session token, access code, or
//     any bearer/reusable secret. Only the non-secret SHA-256 session fingerprint
//     is stored for binding (see offlineTrust.js).
//   - Every record carries a `scope` derived from the server-authenticated
//     session's resolved userId (`user:<userId>`), NEVER client-chosen.
//   - Sign-out / logout-all / account switch clears all scoped records.
//   - Migration failures FAIL CLOSED: the upgrade transaction aborts rather than
//     committing partial/incompatible data.

import { openDB, deleteDB } from 'idb'

export const LOCAL_DB_NAME = 'runout.local'
// Bump ONLY with a tested migration in `upgradeLocalDb`. v1 creates the stores
// needed for M2 local-first persistence.
export const LOCAL_DB_VERSION = 1

const STORE_ITEMS = 'items'
const STORE_TOMBSTONES = 'tombstones'
const STORE_META = 'meta'
const MIGRATION_KEY = '__migration__'
const SCOPE_INDEX = 'by_scope'
const SYNC_STATUS_INDEX = 'by_syncStatus'

// True when the platform exposes IndexedDB (browser/PWA).
export function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

// The server-authoritative ownership scope for a userId. Returns null for any
// non-string/missing id so a malformed caller can NEVER produce a scope —
// ownership must come from the resolved session user, not client input.
// ADR-0019 Dec 6: client-supplied tenant/owner identifiers are never
// authoritative.
export function localScope(userId) {
  if (!userId || typeof userId !== 'string') return null
  return `user:${userId}`
}

// ---------------------------------------------------------------------------
// Database lifecycle (using `idb`). All methods FAIL CLOSED: any missing IDB,
// open error, transaction error or versioning error returns null / [] rather
// than throwing into the UI.
// ---------------------------------------------------------------------------

/**
 * Open the local database at the current version. Returns the DB instance, or
 * null on any failure (fail closed).
 */
export async function openLocalDb() {
  if (!idbAvailable()) return null
  try {
    return await openDB(LOCAL_DB_NAME, LOCAL_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        try {
          upgradeLocalDb(db, oldVersion, transaction)
        } catch (err) {
          // Abort the upgrade so IndexedDB rolls the transaction back (native
          // rollback evidence) instead of committing partial/incompatible data.
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
 * Deterministic migration. v1 creates the items, tombstones, and meta stores
 * with scope and sync-status indexes, and records a reconciliation/rollback
 * audit record. Future versions extend this function with tested, idempotent
 * upgrades (oldVersion-branched).
 */
export function upgradeLocalDb(db, oldVersion, transaction) {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE_ITEMS)) {
      const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'uuid' })
      store.createIndex(SCOPE_INDEX, 'scope', { unique: false })
      store.createIndex(SYNC_STATUS_INDEX, 'syncStatus', { unique: false })
    }
    if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) {
      const store = db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'uuid' })
      store.createIndex(SCOPE_INDEX, 'scope', { unique: false })
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: 'key' })
    }
  }
  // Record migration evidence for reconciliation/rollback. Written inside the
  // upgrade transaction so it only persists when the migration commits.
  const metaStore = transaction.objectStore(STORE_META)
  metaStore.put({
    key: MIGRATION_KEY,
    schemaVersion: LOCAL_DB_VERSION,
    migratedFrom: oldVersion,
    migratedAt: new Date().toISOString(),
    rollback:
      'forward-only; downgrade => clearAllLocalData() + reopen at lower version',
  })
}

// ---------------------------------------------------------------------------
// Sync-status constants (ADR-0019 Dec 8 minimal conflict matrix)
// ---------------------------------------------------------------------------
export const SYNC_STATUS = Object.freeze({
  SYNCED: 'synced',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  LOCAL: 'local',
})

// ---------------------------------------------------------------------------
// Internal helpers (fail-closed)
// ---------------------------------------------------------------------------

async function readMeta(key) {
  const db = await openLocalDb()
  if (!db) return null
  try {
    return await db.get(STORE_META, key)
  } catch {
    return null
  } finally {
    db.close()
  }
}

async function writeMeta(key, value) {
  const db = await openLocalDb()
  if (!db) return false
  try {
    await db.put(STORE_META, { ...value, key })
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Public API — item repository
// ---------------------------------------------------------------------------

/**
 * Save an item to the local store. If the item already exists (by uuid), it is
 * updated. The record includes sync-status columns for M3 reconciliation.
 *
 * Record shape:
 *   {
 *     uuid,           // stable identity (server:xxx or local:xxx)
 *     scope,          // server-authoritative ownership scope
 *     data,           // the item payload
 *     updatedAt,      // ISO timestamp of last local update
 *     serverVersion,  // server-side version (for OCC, M3)
 *     localVersion,   // local version (bumped on each local edit)
 *     syncStatus,     // 'synced' | 'pending' | 'conflict' | 'local'
 *     serverId,       // server id when known
 *   }
 *
 * Returns true on success, false on any failure (fail closed).
 */
export async function saveItem(
  userId,
  item,
  { now = Date.now(), serverVersion = 0, syncStatus = SYNC_STATUS.LOCAL } = {},
) {
  const scope = localScope(userId)
  if (!scope || !item?.uuid) return false

  const db = await openLocalDb()
  if (!db) return false

  try {
    const existing = await db.get(STORE_ITEMS, item.uuid)
    const record = {
      uuid: item.uuid,
      scope,
      data: item,
      updatedAt: new Date(now).toISOString(),
      serverVersion: serverVersion ?? existing?.serverVersion ?? 0,
      localVersion: (existing?.localVersion ?? 0) + 1,
      syncStatus: syncStatus || existing?.syncStatus || SYNC_STATUS.LOCAL,
      serverId: item.serverId ?? item.id ?? existing?.serverId ?? null,
    }
    await db.put(STORE_ITEMS, record)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/**
 * Save multiple items in a single transaction. Returns true on success, false
 * on any failure (fail closed).
 */
export async function saveItems(
  userId,
  items,
  { now = Date.now(), syncStatus = SYNC_STATUS.SYNCED } = {},
) {
  const scope = localScope(userId)
  if (!scope || !Array.isArray(items)) return false

  const db = await openLocalDb()
  if (!db) return false

  try {
    const tx = db.transaction(STORE_ITEMS, 'readwrite')
    const iso = new Date(now).toISOString()
    for (const item of items) {
      const uuid =
        item.uuid ||
        (item.serverId ? `server:${item.serverId}` : null) ||
        item.id
      if (!uuid) continue
      const existing = await tx.objectStore(STORE_ITEMS).get(uuid)
      const record = {
        uuid,
        scope,
        data: item,
        updatedAt: iso,
        serverVersion: existing?.serverVersion ?? 0,
        localVersion: (existing?.localVersion ?? 0) + 1,
        syncStatus,
        serverId: item.serverId ?? item.id ?? existing?.serverId ?? null,
      }
      tx.objectStore(STORE_ITEMS).put(record)
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
 * Read a single item by uuid. Returns the record, or null when not found or
 * on any failure (fail closed). Scope-checked: only returns records matching
 * the user's scope.
 */
export async function getItem(userId, uuid) {
  const scope = localScope(userId)
  if (!scope || !uuid) return null

  const db = await openLocalDb()
  if (!db) return null

  try {
    const record = await db.get(STORE_ITEMS, uuid)
    if (!record || record.scope !== scope) return null
    return record
  } catch {
    return null
  } finally {
    db.close()
  }
}

/**
 * Read ALL items for a user's scope. Returns [] on any failure (fail closed).
 * Optionally filtered by syncStatus.
 */
export async function getItems(
  userId,
  { syncStatus } = {},
) {
  const scope = localScope(userId)
  if (!scope) return []

  const db = await openLocalDb()
  if (!db) return []

  try {
    if (syncStatus) {
      const index = db.transaction(STORE_ITEMS).store.index(SYNC_STATUS_INDEX)
      const all = await index.getAll(syncStatus)
      return all.filter((r) => r.scope === scope) || []
    }
    const index = db.transaction(STORE_ITEMS).store.index(SCOPE_INDEX)
    return (await index.getAll(scope)) || []
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Update an item's sync status (e.g. after a successful push). Returns true
 * on success, false on failure.
 */
export async function updateSyncStatus(userId, uuid, syncStatus, { now = Date.now(), serverVersion } = {}) {
  const scope = localScope(userId)
  if (!scope || !uuid) return false

  const db = await openLocalDb()
  if (!db) return false

  try {
    const existing = await db.get(STORE_ITEMS, uuid)
    if (!existing || existing.scope !== scope) return false
    existing.syncStatus = syncStatus
    existing.updatedAt = new Date(now).toISOString()
    if (serverVersion !== undefined) existing.serverVersion = serverVersion
    existing.localVersion = (existing.localVersion ?? 0) + 1
    await db.put(STORE_ITEMS, existing)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/**
 * Soft-delete an item: move it to the tombstones store and remove from items.
 * The tombstone preserves the uuid, scope, serverId, and deletion timestamp
 * so M3 sync can reconcile the deletion server-side.
 *
 * Returns true on success, false on failure (fail closed).
 */
export async function deleteItem(userId, uuid, { now = Date.now() } = {}) {
  const scope = localScope(userId)
  if (!scope || !uuid) return false

  const db = await openLocalDb()
  if (!db) return false

  try {
    const existing = await db.get(STORE_ITEMS, uuid)
    if (!existing || existing.scope !== scope) return false

    // Create tombstone
    const tombstone = {
      uuid,
      scope,
      serverId: existing.serverId,
      deletedAt: new Date(now).toISOString(),
      data: existing.data,
    }
    await db.put(STORE_TOMBSTONES, tombstone)
    await db.delete(STORE_ITEMS, uuid)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/**
 * Read tombstones for a user's scope (deleted items awaiting sync
 * reconciliation). Returns [] on any failure.
 */
export async function getTombstones(userId) {
  const scope = localScope(userId)
  if (!scope) return []

  const db = await openLocalDb()
  if (!db) return []

  try {
    const index = db.transaction(STORE_TOMBSTONES).store.index(SCOPE_INDEX)
    return (await index.getAll(scope)) || []
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Remove a tombstone (after the deletion has been reconciled server-side).
 * Returns true on success, false on failure.
 */
export async function clearTombstone(userId, uuid) {
  const scope = localScope(userId)
  if (!scope || !uuid) return false

  const db = await openLocalDb()
  if (!db) return false

  try {
    const existing = await db.get(STORE_TOMBSTONES, uuid)
    if (!existing || existing.scope !== scope) return false
    await db.delete(STORE_TOMBSTONES, uuid)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Clear / reset
// ---------------------------------------------------------------------------

/**
 * Clear ALL local data for ONE user (items + tombstones). Leaves other users'
 * data untouched. FAIL-CLOSED: returns true ONLY when all deletes commit.
 */
export async function clearLocalDataForUser(userId) {
  const scope = localScope(userId)
  if (!scope) return true

  const db = await openLocalDb()
  if (!db) return false

  try {
    const tx = db.transaction([STORE_ITEMS, STORE_TOMBSTONES], 'readwrite')
    const itemsStore = tx.objectStore(STORE_ITEMS)
    const tombstonesStore = tx.objectStore(STORE_TOMBSTONES)

    // Delete all items for this scope
    let cursor = await itemsStore.index(SCOPE_INDEX).openCursor(scope)
    while (cursor) {
      itemsStore.delete(cursor.primaryKey)
      cursor = await cursor.continue()
    }

    // Delete all tombstones for this scope
    cursor = await tombstonesStore.index(SCOPE_INDEX).openCursor(scope)
    while (cursor) {
      tombstonesStore.delete(cursor.primaryKey)
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
 * Clear ALL local data (every user's items + tombstones). Used on sign-out /
 * logout-all. Returns true when cleared (or no DB yet).
 */
export async function clearAllLocalData() {
  if (!idbAvailable()) return true
  try {
    await deleteDB(LOCAL_DB_NAME)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export all local data for a user as a JSON-serializable object. Returns
 * { items, tombstones, meta } or null on failure. The export includes sync
 * metadata so it can be re-imported for debugging or migration.
 */
export async function exportLocalData(userId) {
  const scope = localScope(userId)
  if (!scope) return null

  const db = await openLocalDb()
  if (!db) return null

  try {
    const items = await getItems(userId)
    const tombstones = await getTombstones(userId)
    const migrationMeta = await readMeta(MIGRATION_KEY)

    return {
      exportedAt: new Date().toISOString(),
      scope,
      schemaVersion: LOCAL_DB_VERSION,
      items: items.map((r) => ({
        uuid: r.uuid,
        data: r.data,
        updatedAt: r.updatedAt,
        serverVersion: r.serverVersion,
        localVersion: r.localVersion,
        syncStatus: r.syncStatus,
        serverId: r.serverId,
      })),
      tombstones: tombstones.map((r) => ({
        uuid: r.uuid,
        serverId: r.serverId,
        deletedAt: r.deletedAt,
      })),
      migration: migrationMeta || undefined,
    }
  } catch {
    return null
  } finally {
    db.close()
  }
}

/**
 * Get the migration audit record. Returns null on failure.
 */
export async function getMigrationRecord() {
  return readMeta(MIGRATION_KEY)
}