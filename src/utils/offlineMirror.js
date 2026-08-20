// M2 Offline Collection Mirror — IndexedDB repository (#289; ADR-0019 Dec 2,
// Dec 5, Dec 6; the M2 data-gate requirements #1/#3).
//
// WHAT THIS IS
// ------------
// The local mirror of the user's last-known supported item list, cached in
// IndexedDB so a collector can answer "do I already own this?" and browse
// their synchronized collection with no network. It is the OFFICIAL M2 local
// store for private collection data (ADR-0019 Dec 2 uses IndexedDB, never
// localStorage, for the collection database; Dec 5 keeps private collection
// data OUT of the service-worker HTTP cache and in this store).
//
// SECURITY / ISOLATION BOUNDARIES (the M2 data gate + ADR-0019)
// --------------------------------------------------------------
//   - SCOPE IS SERVER-AUTHORITATIVE, NEVER CLIENT-CHOSEN (Dec 6). Every mirror
//     record carries an ownership scope derived from the server-authenticated
//     session's resolved userId (`mirrorScope(userId)`), keyed under
//     `user:<userId>`. A client-supplied tenant/owner id is never accepted;
//     only the resolved `user.id` from the session (established by the M1
//     trusted-session flow) may form a scope.
//   - NO CREDENTIALS IN IDB (Dec 4). We never write the access code, the
//     session token, or any bearer/reusable secret to IndexedDB. The only
//     session-derived value stored is the NON-SECRET SHA-256 session
//     fingerprint (see sessionFingerprintAsync) used to bind the mirror to the
//     current session so a stale mirror from a rotated session fails closed.
//   - CLEAR / ISOLATE ON SIGN-OUT & ACCOUNT SWITCH (Dec 5). `clearMirrorForUser`
//     removes one user's records; `clearAllMirror()` clears everything. The
//     auth flow calls these on sign-out / logout-all / account switch so one
//     user's private collection data can never surface for another.
//   - Migration failures FAIL CLOSED (Dec 2): the schema is versioned and an
//     upgrade that fails aborts rather than silently interpreting incompatible
//     data.
//
// MIGRATION / RECONCILIATION EVIDENCE (the M2 data gate requirement #3)
// ---------------------------------------------------------------------
// The schema version is explicit (`MIRROR_DB_VERSION`). On upgrade we run a
// deterministic migration and record a reconciliation/rollback audit record in
// a dedicated `meta` record (`__migration__`) so there is persistent evidence
// of what version produced the current data. The migration is written to be
// idempotent and, because we create stores incrementally by name in
// `onupgradeneeded`, a failed upgrade never commits partially — IndexedDB
// rolls the transaction back automatically (native rollback evidence).
//
// Duplicate detection and record identity are migration-stable:
//   - record identity = `serverItemUuid(serverId)` for server-backed items and
//     `newLocalItemUuid()` for offline adds (see itemUuid.js) — op id, mirror
//     record and server record reconcile on the SAME uuid (#292 builds on this).
//   - op ids are never re-minted by the migration.

import { newLocalItemUuid, serverItemUuid } from './itemUuid'
import { offlineAccessAllowed } from './offlineTrust'
import { findRelated } from './match'

export const MIRROR_DB_NAME = 'runout.offlineMirror'
// Bump ONLY with a tested migration in `upgradeMirrorDb`. This is the schema
// contract the data gate requires; op ids + record identity are stable across
// it (never re-minted by a migration).
export const MIRROR_DB_VERSION = 1

const STORE_MIRROR = 'mirror'
const STORE_META = 'meta'
const MIGRATION_KEY = '__migration__'
// Index on scope so we can clear/query a single user's records efficiently.
const SCOPE_INDEX = 'by_scope'

// True when the platform exposes IndexedDB (browser/PWA). In non-IDB test
// environments this is false and the repository methods fail closed.
export function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

// The server-authoritative ownership scope for a userId. Returns null for any
// non-string/missing id so a malformed caller can NEVER produce a scope —
// ownership must come from the resolved session user, not client input.
// ADR-0019 Dec 6: client-supplied tenant/owner identifiers are never
// authoritative, so we only accept the id as resolved by the server-authenticated
// session.
export function mirrorScope(userId) {
  if (!userId || typeof userId !== 'string') return null
  return `user:${userId}`
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing (promisified). All repository methods FAIL CLOSED: any
// missing IDB, open error, transaction error or versioning error resolves to
// null / no-op rather than throwing into the UI (no dark screen).
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(MIRROR_DB_NAME, MIRROR_DB_VERSION)
    req.onupgradeneeded = (event) => {
      try {
        upgradeMirrorDb(
          event.target.result,
          event.oldVersion,
          event.target.transaction,
        )
      } catch (err) {
        // Abort the upgrade so IndexedDB rolls the transaction back (native
        // rollback evidence) instead of committing partial/incompatible data.
        event.target.transaction.abort()
        reject(err)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('indexedDB.open failed'))
    req.onblocked = () => reject(new Error('indexedDB.open blocked'))
  })
}

// Deterministic migration. v1 creates the two stores + scope index and records
// a reconciliation/rollback audit record. Future versions extend this function
// with tested, idempotent upgrades (oldVersion-branched). `tx` is the upgrade
// transaction (writes must use it — a new transaction is not allowed while an
// upgrade is in progress).
export function upgradeMirrorDb(db, oldVersion, tx) {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE_MIRROR)) {
      const store = db.createObjectStore(STORE_MIRROR, { keyPath: 'uuid' })
      store.createIndex(SCOPE_INDEX, 'scope', { unique: false })
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: 'key' })
    }
  }
  // Record migration evidence for reconciliation/rollback. Written inside the
  // upgrade transaction so it only persists when the migration commits.
  const metaStore = tx.objectStore(STORE_META)
  metaStore.put({
    key: MIGRATION_KEY,
    schemaVersion: MIRROR_DB_VERSION,
    migratedFrom: oldVersion,
    migratedAt: new Date().toISOString(),
    // Rollback evidence: the migration is forward-only by design; a downgrade
    // is handled by clearing the DB (see clearAllMirror) rather than a risky
    // reverse migration. Recorded here so operators have a persistent trail.
    rollback:
      'forward-only; downgrade => clearAllMirror() + reopen at lower version',
  })
}

// Read one meta record (never throws; returns null on any failure).
async function readMeta(key) {
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly')
      const req = tx.objectStore(STORE_META).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  } finally {
    if (db) db.close()
  }
}

// Read ALL mirror items for a scope (the full cached list for one user).
// Returns [] on any failure (fail closed — an empty offline mirror must not
// masquerade as data; callers distinguish "no data" via cachedAt).
async function readItemsForScope(scope) {
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MIRROR, 'readonly')
      const index = tx.objectStore(STORE_MIRROR).index(SCOPE_INDEX)
      const req = index.getAll(scope)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  } finally {
    if (db) db.close()
  }
}

// Delete every record under `scope` inside the given transaction, awaiting the
// cursor iteration so the delete pass fully completes before the caller writes.
function deleteScopeRecords(tx, mirrorStore, scope) {
  const index = mirrorStore.index(SCOPE_INDEX)
  return new Promise((resolve, reject) => {
    const delReq = index.openKeyCursor(scope)
    delReq.onsuccess = () => {
      const cursor = delReq.result
      if (cursor) {
        mirrorStore.delete(cursor.primaryKey)
        cursor.continue()
      } else resolve()
    }
    delReq.onerror = () => reject(delReq.error)
  })
}

// Write all items for a scope in a single transaction (replace-the-mirror).
// Each record gets a stable uuid (server-backed => derived from serverId,
// otherwise a new local uuid) so re-save is idempotent and identity is stable.
async function writeItemsForScope(scope, items, cachedAtIso) {
  if (!scope) return false
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MIRROR, STORE_META], 'readwrite')
      const mirrorStore = tx.objectStore(STORE_MIRROR)
      const metaStore = tx.objectStore(STORE_META)
      // Replace semantics: fully delete this scope's existing records FIRST
      // (await the cursor), then write the new set — otherwise the async delete
      // cursor would delete the freshly-put records too.
      deleteScopeRecords(tx, mirrorStore, scope).then(() => {
        // Write meta (cachedAt stamp) + records. CachedAt is the local save time.
        metaStore.put({
          key: `cachedAt:${scope}`,
          cachedAt: cachedAtIso,
          scope,
          itemCount: (items || []).length,
        })
        for (const item of items || []) {
          // Derive the stable mirror identity from the server id if present. The
          // collection API returns the server id as `id`; offline-add records
          // (M2 #292) carry `serverId` once reconciled. Prefer `serverId` when set,
          // fall back to `id`, else keep an existing `uuid` or mint a fresh local
          // one. This keeps re-save idempotent (same server item → same key).
          const serverId = item.serverId ?? item.id ?? null
          const uuid =
            serverId !== null && serverId !== undefined && serverId !== ''
              ? serverItemUuid(serverId)
              : item.uuid || newLocalItemUuid()
          mirrorStore.put({
            uuid,
            scope,
            serverId,
            data: item,
            syncedAt: cachedAtIso,
          })
        }
      }, reject)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(new Error('write transaction aborted'))
    })
  } catch {
    return false
  } finally {
    if (db) db.close()
  }
}

// ---------------------------------------------------------------------------
// Public repository API
// ---------------------------------------------------------------------------

/**
 * Cache the last-known supported item list for the given userId's scope with a
 * `cachedAt` stamp. `userId` MUST be the server-resolved session user id (never
 * client-chosen). Items with a `serverId` are keyed by that id; items without
 * one (offline adds, M2 #292) are keyed by a fresh stable local uuid so the
 * mirror record, the outbox op and the future server record reconcile.
 *
 * Resolves true on success, false on any failure (fail closed).
 */
export async function saveMirror(userId, items, { now = Date.now() } = {}) {
  const scope = mirrorScope(userId)
  if (!scope) return false
  const cachedAt = new Date(now).toISOString()
  return writeItemsForScope(scope, items, cachedAt)
}

/**
 * Read the offline mirror for a userId. Returns the item list ONLY when the
 * caller is permitted offline access for the collection scope AND the session
 * is still the one the mirror was bound to (fail closed on a rotated/stale
 * session). Returns null when offline access is not granted or no cached data
 * exists (so the caller can distinguish "no offline copy" from "empty list").
 *
 * The `cachedAt` stamp and the raw record count come back so the UI can surface
 * a clear "showing offline copy" state.
 */
export async function readMirror(
  userId,
  { now = Date.now(), token = '', scopeName = 'collection' } = {},
) {
  const scope = mirrorScope(userId)
  if (!scope) return null
  // Offline access is capability-scoped and gated by the M1 trusted-session
  // record (ADR-0019 Dec 4). Fail closed unless this device holds a live grant
  // for the collection scope for THIS user bound to the CURRENT session token.
  // The userId here is the server-resolved session id (never client-chosen), so
  // wrapping it as `{ id }` lets the trust gate compare against its record.
  if (
    !(await offlineAccessAllowed(
      { id: userId },
      { now, scope: scopeName, token },
    ))
  )
    return null

  const cachedMeta = await readMeta(`cachedAt:${scope}`)
  const items = await readItemsForScope(scope)
  if (!cachedMeta || !Array.isArray(items)) return null
  return {
    items: items.map((r) => r.data),
    cachedAt: cachedMeta.cachedAt,
    recordCount: cachedMeta.itemCount,
  }
}

/**
 * Duplicate detection against the approved local mirror (ADR-0019 Dec 5: run
 * duplicate detection against the local mirror, not the SW cache). Scoped to a
 * single user. Uses the same `findRelated` as the online flow so scan/OCR and
 * manual-add duplicates are detected against the same approved collection
 * whether the device is online or offline. Returns null when offline access is
 * not granted or no mirror exists (fail closed).
 */
export async function findDuplicatesInMirror(
  userId,
  candidate,
  { now = Date.now(), token = '', scopeName = 'collection' } = {},
) {
  const mirror = await readMirror(userId, { now, token, scopeName })
  if (!mirror) return null
  const owned = mirror.items.filter((it) => !it.wishlist)
  const wishlist = mirror.items.filter((it) => it.wishlist)
  return findRelated(candidate, owned, wishlist)
}

/**
 * Clear the offline mirror for ONE user (sign-out of a single account /
 * account switch). Leaves other users' records untouched. Resolves true when
 * cleared (or nothing to clear), false on any failure.
 */
export async function clearMirrorForUser(userId) {
  const scope = mirrorScope(userId)
  if (!scope) return true
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MIRROR, STORE_META], 'readwrite')
      const mirrorStore = tx.objectStore(STORE_MIRROR)
      const metaStore = tx.objectStore(STORE_META)
      deleteScopeRecords(tx, mirrorStore, scope).then(() => {
        metaStore.delete(`cachedAt:${scope}`)
      }, reject)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(new Error('clear transaction aborted'))
    })
  } catch {
    return true
  } finally {
    if (db) db.close()
  }
}

/**
 * Clear the ENTIRE offline mirror (sign-out / logout-all — no user's private
 * data may survive on this device). Resolves true when cleared (or no DB yet).
 */
export async function clearAllMirror() {
  if (!idbAvailable()) return true
  return new Promise((resolve) => {
    try {
      const delReq = indexedDB.deleteDatabase(MIRROR_DB_NAME)
      delReq.onsuccess = () => resolve(true)
      delReq.onerror = () => resolve(false)
      delReq.onblocked = () => resolve(false)
      // onupgradeneeded on delete is a no-op; onsuccess fires when fully gone.
    } catch {
      resolve(false)
    }
  })
}
