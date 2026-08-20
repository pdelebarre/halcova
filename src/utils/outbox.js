// M2 Offline Capture Outbox — IndexedDB repository (#292; ADR-0019 Dec 7/8;
// the M2/M3 sync boundary). Builds on the #289 foundation (itemUuid.js,
// offlineTrust.js, offlineMirror.js) — it REUSES those contracts, never
// duplicates them.
//
// WHAT THIS IS
// ------------
// A durable, per-user IndexedDB queue of local mutations staged while offline.
// When a collector scans/OCRs and adds an item with no connectivity, the item
// is NOT dropped: it is written to this outbox (the "Add to my collection
// anyway" offline path) AND to the offline mirror (so it appears immediately
// with a pending state). On reconnect, the outbox is flushed with a STABLE
// idempotency key (the same client uuid that identifies the mirror record and
// the future server record), the server re-authorizes each operation, and the
// accepted mutation is re-applied to the local mirror.
//
// OUTBOX RECORD SHAPE (approved local schema from #292)
//   {
//     opId,         // stable idempotency key == the item's local uuid
//                   //   (newLocalItemUuid, itemUuid.js) so the op, the mirror
//                   //   record and the future server record reconcile on ONE id.
//     scope,        // server-authoritative ownership: `user:<userId>` — derived
//                   //   from the resolved session user id, NEVER client-chosen.
//     kind,         // 'add' (the only M2 mutation kind; edit/delete are M3).
//     collection,   // 'records' | 'books'
//     barcode?,     // scanned barcode string, when the capture provided one.
//     ocrText?,     // OCR result text, when the capture provided one.
//     pendingItem?, // the staged item object (marked `metadataPending: true`).
//     capturedAt,   // ISO timestamp of when the capture was staged.
//     state,        // 'pending' | 'flushed' | 'failed'
//     attempts,     // retry counter (bumped on each flush attempt).
//     lastError?,   // message of the last failed push (surfaced, never dropped).
//   }
//
// SECURITY / ISOLATION (ADR-0019 Dec 4/5/6 — mandatory)
//   - NO credentials in the outbox: we never write the session token, access
//     code, or any bearer/reusable secret. Outbox access is gated by the same
//     M1 trusted-session record (offlineTrust.js) on the 'mutation' scope, and
//     the outbox is keyed by the server-authoritative user scope
//     (`outboxScope(userId)` == mirrorScope) — never a client-chosen tenant.
//   - CLEAR / ISOLATE on sign-out, logout-all & account switch:
//     `clearOutboxForUser` clears one user's ops; `clearAllOutbox` clears
//     everything. useAuth calls these alongside the mirror clears so one user's
//     queued mutations can never surface for (or be pushed by) another account.
//   - FAIL-CLOSED trust gating (like #289): reads/writes of the outbox require
//     a live 'mutation'-scope offline-trust grant bound to the current session.
//   - Fail-closed repository: any IndexedDB failure resolves to a safe no-op /
//     [] rather than throwing into the UI (no dark screen), matching
//     offlineMirror.js.

import { newLocalItemUuid } from './itemUuid'
import { idbAvailable, mirrorScope } from './offlineMirror'
import { OFFLINE_SCOPES, offlineAccessAllowed } from './offlineTrust'

export const OUTBOX_DB_NAME = 'runout.outbox'
// Bump ONLY with a tested migration in `upgradeOutboxDb`. v1 creates the `ops`
// store (keyPath 'opId') + the scope index + a migration-audit meta record.
export const OUTBOX_DB_VERSION = 1

const STORE_OPS = 'ops'
const STORE_META = 'meta'
const MIGRATION_KEY = '__migration__'
const SCOPE_INDEX = 'by_scope'

// Outbox op states. 'flushed' is terminal (successfully pushed + reconciled);
// 'failed' stays retryable (ADR-0016 rule 12 — never silently discard).
export const OUTBOX_STATE = Object.freeze({
  PENDING: 'pending',
  FLUSHED: 'flushed',
  FAILED: 'failed',
})

// The only M2 mutation kind. edit/delete push is M3 (#160/#161) per the
// ADR-0019 Decision 8 minimal conflict matrix.
export const OUTBOX_KIND = Object.freeze({
  ADD: 'add',
})

// The server-authoritative ownership scope for an outbox. Reuses mirrorScope
// (same `user:<userId>` derivation, same server-authoritative invariant) so the
// outbox and the mirror it reconciles into share one scoping rule.
export function outboxScope(userId) {
  return mirrorScope(userId)
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing (promisified). Fail closed on any missing IDB, open error,
// transaction error or versioning error (no throw into the UI).
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION)
    req.onupgradeneeded = (event) => {
      try {
        upgradeOutboxDb(
          event.target.result,
          event.oldVersion,
          event.target.transaction,
        )
      } catch (err) {
        event.target.transaction.abort()
        reject(err)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('indexedDB.open failed'))
    req.onblocked = () => reject(new Error('indexedDB.open blocked'))
  })
}

// Deterministic migration. v1 creates the `ops` store + scope index and records
// a reconciliation/rollback audit record (parity with offlineMirror's
// `upgradeMirrorDb`). Future versions extend this with tested, idempotent
// oldVersion-branched upgrades.
export function upgradeOutboxDb(db, oldVersion, tx) {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE_OPS)) {
      const store = db.createObjectStore(STORE_OPS, { keyPath: 'opId' })
      store.createIndex(SCOPE_INDEX, 'scope', { unique: false })
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: 'key' })
    }
  }
  const metaStore = tx.objectStore(STORE_META)
  metaStore.put({
    key: MIGRATION_KEY,
    schemaVersion: OUTBOX_DB_VERSION,
    migratedFrom: oldVersion,
    migratedAt: new Date().toISOString(),
    rollback:
      'forward-only; downgrade => clearAllOutbox() + reopen at lower version',
  })
}

// Read all non-terminal (pending or failed) ops for a scope. Returns [] on any
// failure (fail closed — never throws into the UI).
async function readActiveOpsForScope(scope) {
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OPS, 'readonly')
      const index = tx.objectStore(STORE_OPS).index(SCOPE_INDEX)
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

async function writeOp(record) {
  if (!record?.scope) return false
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OPS, 'readwrite')
      tx.objectStore(STORE_OPS).put(record)
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

async function getOp(scope, opId) {
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OPS, 'readonly')
      const req = tx.objectStore(STORE_OPS).get(opId)
      req.onsuccess = () => {
        const rec = req.result
        // Never leak another user's op (scope is server-authoritative).
        resolve(rec && rec.scope === scope ? rec : null)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  } finally {
    if (db) db.close()
  }
}

function deleteScopeOps(tx, opsStore, scope) {
  const index = opsStore.index(SCOPE_INDEX)
  return new Promise((resolve, reject) => {
    const delReq = index.openKeyCursor(scope)
    delReq.onsuccess = () => {
      const cursor = delReq.result
      if (cursor) {
        opsStore.delete(cursor.primaryKey)
        cursor.continue()
      } else resolve()
    }
    delReq.onerror = () => reject(delReq.error)
  })
}

// The trust gate shared by every outbox read/write (ADR-0019 Dec 4/6): the
// caller must hold a live 'mutation'-scope offline-trust grant for the resolved
// session user bound to the CURRENT session token. Fail closed otherwise.
async function mutationAllowed(userId, { now, token } = {}) {
  return offlineAccessAllowed(
    { id: userId },
    { now, scope: OFFLINE_SCOPES.MUTATION, token },
  )
}

// ---------------------------------------------------------------------------
// Public repository API
// ---------------------------------------------------------------------------

/**
 * Stage an offline ADD. Mints the stable idempotency key (== the item's local
 * uuid) and writes the durable outbox record. Requires a live 'mutation'-scope
 * offline-trust grant bound to the current session; otherwise returns null
 * (fail closed — a device without trust cannot queue offline mutations).
 *
 * The returned op carries `opId` (= `pendingItem.uuid`) so the caller can place
 * the SAME uuid into the mirror record and reconcile op → mirror → server.
 */
export async function stageAdd(
  userId,
  {
    collection = 'records',
    item,
    barcode,
    ocrText,
    now = Date.now(),
    token = '',
  } = {},
) {
  const scope = outboxScope(userId)
  if (!scope) return null
  if (!(await mutationAllowed(userId, { now, token }))) return null

  const opId = item?.uuid || newLocalItemUuid()
  const record = {
    opId,
    scope,
    kind: OUTBOX_KIND.ADD,
    collection,
    barcode: barcode || undefined,
    ocrText: ocrText || undefined,
    pendingItem: item ? { ...item, uuid: opId } : undefined,
    capturedAt: new Date(now).toISOString(),
    state: OUTBOX_STATE.PENDING,
    attempts: 0,
  }
  const ok = await writeOp(record)
  return ok ? record : null
}

/**
 * Read the durable ops awaiting flush (state 'pending' or 'failed') for a user.
 * Gated by the 'mutation' offline-trust scope; returns [] when access is not
 * granted or no ops exist (fail closed — never a throw).
 */
export async function listPendingOps(
  userId,
  { now = Date.now(), token = '' } = {},
) {
  const scope = outboxScope(userId)
  if (!scope) return []
  if (!(await mutationAllowed(userId, { now, token }))) return []
  const ops = await readActiveOpsForScope(scope)
  return ops.filter(
    (op) =>
      op.state === OUTBOX_STATE.PENDING || op.state === OUTBOX_STATE.FAILED,
  )
}

/**
 * Count the durable ops awaiting flush for a user (the minimal pending-count
 * primitive for the UI; full UX is #159). Returns 0 when not trusted / none.
 */
export async function countPendingOps(
  userId,
  { now = Date.now(), token = '' } = {},
) {
  const ops = await listPendingOps(userId, { now, token })
  return ops.length
}

/**
 * Mark an op as successfully flushed. Preserves the opId/scope (so the op,
 * mirror and server records keep reconciling) and records the returned server
 * item so the caller can reconcile the mirror. Returns the updated record, or
 * null when the op is not found / belongs to another user / not trusted.
 */
export async function markFlushed(
  userId,
  opId,
  serverItem,
  { now = Date.now(), token = '' } = {},
) {
  const scope = outboxScope(userId)
  if (!scope || !opId) return null
  if (!(await mutationAllowed(userId, { now, token }))) return null
  const existing = await getOp(scope, opId)
  if (!existing) return null
  const updated = {
    ...existing,
    state: OUTBOX_STATE.FLUSHED,
    serverId: serverItem?.id ?? existing.serverId,
    serverItem: serverItem || existing.serverItem,
    flushedAt: new Date(now).toISOString(),
    lastError: undefined,
  }
  const ok = await writeOp(updated)
  return ok ? updated : null
}

/**
 * Mark an op as FAILED (a flaky reconnect / a server rejection). The op STAYS
 * durable and retryable — ADR-0016 rule 12: no offline mutation is silently
 * discarded. `lastError` is surfaced to the caller for the fail-closed UX.
 */
export async function markFailed(
  userId,
  opId,
  message,
  { now = Date.now(), token = '' } = {},
) {
  const scope = outboxScope(userId)
  if (!scope || !opId) return null
  if (!(await mutationAllowed(userId, { now, token }))) return null
  const existing = await getOp(scope, opId)
  if (!existing) return null
  const updated = {
    ...existing,
    state: OUTBOX_STATE.FAILED,
    attempts: (existing.attempts || 0) + 1,
    lastError: message || 'sync failed',
    lastAttemptAt: new Date(now).toISOString(),
  }
  const ok = await writeOp(updated)
  return ok ? updated : null
}

/**
 * Clear ONE user's outbox (sign-out of a single account / account switch).
 * Leaves other users' queued mutations untouched. Resolves true when cleared
 * (or nothing to clear), false on any failure.
 */
export async function clearOutboxForUser(userId) {
  const scope = outboxScope(userId)
  if (!scope) return true
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OPS, 'readwrite')
      deleteScopeOps(tx, tx.objectStore(STORE_OPS), scope).then(() => resolve(true), reject)
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
 * Clear the ENTIRE outbox (sign-out / logout-all — no user's queued mutations
 * may survive on this device). Resolves true when cleared (or no DB yet).
 */
export async function clearAllOutbox() {
  if (!idbAvailable()) return true
  return new Promise((resolve) => {
    try {
      const delReq = indexedDB.deleteDatabase(OUTBOX_DB_NAME)
      delReq.onsuccess = () => resolve(true)
      delReq.onerror = () => resolve(false)
      delReq.onblocked = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}
