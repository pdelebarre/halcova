// postgres-repository.js — the Postgres-backed repository (ADR-0002 Phase 1).
//
// Read-through fallback: every READ is served DB-first and falls back to the
// Blobs implementation on a miss (null / empty list) OR on any DB error, so a
// Postgres outage or a not-yet-backfilled store never breaks a request — the
// app behaves exactly like today.
//
// Reversible writes (dual-write): every WRITE goes to Postgres (the new system
// of record) AND is mirrored to the Blobs store best-effort, so the legacy
// Blob stores stay complete and the migration can be walked back at any time
// (nothing orphans; legacy stores are never renamed/deleted). If Postgres is
// unreachable a write degrades to Blobs so it never fails.
//
// M1 security hardening (auth): AUTH-relevant user writes (rotate, disable/
// enable, delete, approve) FAIL CLOSED — the Postgres write and the Blobs
// mirror are both-or-neither (snapshot → mirror → restore on mirror failure,
// no blob-only degrade on a Postgres failure). And the AUTH READ
// (findUserByCode) treats a Postgres record-miss as authoritative, falling
// back to the Blobs mirror ONLY on a true DB unavailability, so a stale mirror
// can never re-validate a revoked/disabled/deleted code. Non-auth writes
// (requests, items) keep the reversible best-effort semantics.
//
// See the report for the backfill-timing caveat: DB-first reads assume a store
// has been backfilled (Part B) before it serves live traffic.

import { db as postgresDb } from '../postgres'
import { createUsersRepo } from './users-repo'
import { createItemsRepo } from './items-repo'
import { createLookupCacheRepo } from './lookup-cache-repo'
import { createLookupQueueRepo } from './lookup-queue-repo'
import { createFeedbackRepo } from './feedback-repo'
import { createSessionsRepo } from './sessions-repo'
import * as blobUsers from './blob-users'
import * as blobSessions from './blob-sessions'

// Wrap a read so a Postgres miss or error falls back to the Blobs impl.
function readThrough(fn, fallback) {
  return async (...args) => {
    try {
      const result = await fn(...args)
      // A null (not found) or empty list (nothing backfilled yet) is a "miss".
      if (result == null || (Array.isArray(result) && result.length === 0)) {
        return fallback(...args)
      }
      return result
    } catch {
      // DB unreachable/errored — degrade to Blobs, never fail the request.
      return fallback(...args)
    }
  }
}

// Wrap a write: Postgres first, mirrored to Blobs best-effort; on a Postgres
// failure, fall back to a Blobs-only write so the operation still succeeds.
// Used ONLY for non-auth writes (requests, items) — auth writes fail closed
// (see authWriteFailClosed below).
function writeThrough(postgresFn, blobFn) {
  return async (...args) => {
    try {
      const result = await postgresFn(...args)
      try { await blobFn(...args) } catch { /* mirror is best-effort */ }
      return result
    } catch {
      return blobFn(...args)
    }
  }
}

// AUTH read: the Postgres record is authoritative. A record-miss (null) is
// returned as-is — the code was rotated / the user disabled or deleted in the
// system of record, and the Blobs mirror may still hold a stale plaintext
// code. Falling back on a miss would re-validate a revoked code (M1), so we
// fall back to Blobs ONLY on a true DB unavailability — an outage still
// resolves members through the mirror so nobody is locked out.
function authFindUserByCode(postgresFn, blobFn) {
  return async (code) => {
    try {
      return await postgresFn(code)
    } catch {
      return blobFn(code)
    }
  }
}

// Snapshot/restore helpers for the users table, used to ROLL BACK an
// auth-relevant write if the Blobs mirror fails (both-or-neither). The raw
// row snapshot preserves the code_hash — the sole authority — which the public
// user shape (toUser) deliberately hides. We compensate with an explicit
// restore write instead of relying on a SQL transaction: it works on every
// backend (pg-mem included, whose ROLLBACK is a no-op), and it avoids holding
// a long-lived connection open during the Blobs write.
//
// S3 (migration 003_billing_fields.sql): the billing columns are part of the
// snapshot/restore too, so an auth write that rolls back can never wipe the
// payment-webhook fields a member already has (planExpiresAt, the Stripe ids).
// S8 (#54, M2): `code_delivered` (migration 004) rides along the same way, so
// a rolled-back write never re-opens the one-time code delivery.
const USER_ROW_COLUMNS = `id, name, email, code_hash, role, status, plan, features, collections, created_at, plan_expires_at, plan_changed_at, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id, code_delivered`

async function readUserRow(db, id) {
  const { rows } = await db.query(`SELECT ${USER_ROW_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [id])
  return rows[0] || null
}

async function writeUserRow(db, row) {
  const values = [row.id, row.name, row.email, row.code_hash, row.role, row.status, row.plan,
    JSON.stringify(row.features ?? {}), JSON.stringify(row.collections ?? {}), row.created_at,
    row.plan_expires_at ?? null, row.plan_changed_at ?? null,
    row.stripe_customer_id ?? null, row.stripe_subscription_id ?? null, row.stripe_checkout_session_id ?? null,
    row.code_delivered ?? null]
  await db.query(
    `INSERT INTO users (${USER_ROW_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, email = EXCLUDED.email, code_hash = EXCLUDED.code_hash,
       role = EXCLUDED.role, status = EXCLUDED.status, plan = EXCLUDED.plan,
       features = EXCLUDED.features, collections = EXCLUDED.collections,
       plan_expires_at = EXCLUDED.plan_expires_at, plan_changed_at = EXCLUDED.plan_changed_at,
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
       code_delivered = EXCLUDED.code_delivered`,
    values,
  )
}

async function deleteUserRow(db, id) {
  await db.query(`DELETE FROM users WHERE id = $1`, [id])
}

// Fail-closed write for AUTH-relevant records (rotate, disable/enable, delete,
// approve): the Postgres write and the Blobs mirror are both-or-neither. A
// mirror failure restores the pre-write Postgres row (snapshot → restore) and
// the whole operation throws (the caller surfaces a 5xx), so a revocation/
// disable is never half-applied across the two stores. A Postgres failure also
// throws: auth writes never degrade to a Blobs-only write, so a code/status
// change can't silently split while Postgres is down. `idOf` extracts the user
// id from the repo call's args (saveUser(user) vs removeUserRecord(id)).
function authWriteFailClosed(db, method, blobFn, idOf) {
  return async (...args) => {
    const id = idOf(...args)
    const before = await readUserRow(db, id)
    // The Postgres write itself: if it throws, auth writes never degrade to a
    // Blobs-only write — the error propagates (5xx) so a code/status change
    // can't silently split across the two stores while Postgres is down.
    const result = await createUsersRepo(db)[method](...args)
    try {
      await blobFn(...args)
    } catch (err) {
      // Mirror failed — restore the pre-write Postgres state so the old code /
      // status stays consistent, then fail loudly.
      try {
        if (before) await writeUserRow(db, before)
        else await deleteUserRow(db, id)
      } catch (restoreErr) {
        err.restoreError = restoreErr // best effort; keep the original failure
      }
      const wrapped = new Error(`Auth write failed (change not applied): ${err?.message || err}`)
      wrapped.cause = err
      throw wrapped
    }
    return result
  }
}

// --- Sessions (SEC-EPIC-1, #176) -------------------------------------------
//
// Same auth hardening as users: a session-token READ is Postgres-authoritative
// (a record-miss is a definitive "invalid/revoked/expired token" — never fall
// back to the Blobs mirror on a miss, only on a true DB unavailability, so a
// stale mirror can never re-validate a revoked/expired session). Session
// WRITES fail closed: the Postgres write and the Blobs mirror are
// both-or-neither (snapshot → mirror → restore on mirror failure), so a logout
// / revoke / delete is never half-applied across the two stores.

const SESSION_ROW_COLUMNS = `token_hash, user_id, role, status, created_at, expires_at, revoked_at`

async function readSessionRow(db, tokenHash) {
  const { rows } = await db.query(`SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE token_hash = $1 LIMIT 1`, [tokenHash])
  return rows[0] || null
}

async function readSessionRowsForUser(db, userId) {
  const { rows } = await db.query(`SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE user_id = $1`, [userId])
  return rows
}

async function writeSessionRow(db, row) {
  await db.query(
    `INSERT INTO sessions (${SESSION_ROW_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (token_hash) DO UPDATE SET
       user_id = EXCLUDED.user_id, role = EXCLUDED.role, status = EXCLUDED.status,
       expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at`,
    [row.token_hash, row.user_id, row.role, row.status, row.created_at, row.expires_at, row.revoked_at],
  )
}

async function deleteSessionRow(db, tokenHash) {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash])
}

// Fail-closed write for a single session op (save / revokeByTokenHash): the
// Postgres write and the Blobs mirror are both-or-neither. A mirror failure
// restores the pre-write Postgres row and the operation throws (the caller
// surfaces a 5xx) so a revocation is never half-applied. A Postgres failure
// also throws — auth writes never degrade to a Blobs-only write.
function sessionWriteFailClosed(db, method, blobFn) {
  return async (...args) => {
    // save(session) -> tokenHash = session.tokenHash; revokeByTokenHash(tokenHash)
    const tokenHash = args[0]?.tokenHash || args[0]
    const before = await readSessionRow(db, tokenHash)
    const result = await createSessionsRepo(db)[method](...args)
    try {
      await blobFn(...args)
    } catch (err) {
      try {
        if (before) await writeSessionRow(db, before)
        else await deleteSessionRow(db, tokenHash)
      } catch (restoreErr) {
        err.restoreError = restoreErr // best effort; keep the original failure
      }
      const wrapped = new Error(`Session write failed (change not applied): ${err?.message || err}`)
      wrapped.cause = err
      throw wrapped
    }
    return result
  }
}

// Fail-closed bulk write for a user's sessions (revokeAllForUser /
// deleteAllForUser): snapshot the user's rows, run the Postgres op, mirror to
// Blobs, and restore every pre-write row on a mirror failure.
function sessionBulkWriteFailClosed(db, method, blobFn) {
  return async (...args) => {
    const userId = args[0]
    const before = await readSessionRowsForUser(db, userId)
    const result = await createSessionsRepo(db)[method](...args)
    try {
      await blobFn(...args)
    } catch (err) {
      try {
        for (const row of before) await writeSessionRow(db, row)
      } catch (restoreErr) {
        err.restoreError = restoreErr
      }
      const wrapped = new Error(`Session write failed (change not applied): ${err?.message || err}`)
      wrapped.cause = err
      throw wrapped
    }
    return result
  }
}

// AUTH session-token read: Postgres-authoritative — a record-miss is returned
// as-is (the token was revoked/expired/deleted in the system of record); we
// fall back to the Blobs mirror ONLY on a true DB unavailability so an outage
// still lets a genuinely-live session through.
function authGetSessionByTokenHash(postgresFn, blobFn) {
  return async (tokenHash) => {
    try {
      return await postgresFn(tokenHash)
    } catch {
      return blobFn(tokenHash)
    }
  }
}

export function createPostgresRepository({ db = postgresDb } = {}) {
  const usersPg = createUsersRepo(db)
  const sessionsPg = createSessionsRepo(db)
  const items = createItemsRepo(db)
  const lookupCache = createLookupCacheRepo(db)
  const lookupQueue = createLookupQueueRepo(db)
  const feedback = createFeedbackRepo(db)

  const users = {
    // Reads — DB first, Blobs fallback on miss/error, EXCEPT findUserByCode:
    // auth is Postgres-authoritative (miss = revoked/unknown, fallback only on
    // a true DB unavailability) — see authFindUserByCode.
    findUserByCode: authFindUserByCode(usersPg.findUserByCode, blobUsers.findUserByCode),
    getUser: readThrough(usersPg.getUser, blobUsers.getUser),
    listUsers: readThrough(usersPg.listUsers, blobUsers.listUsers),
    listRequests: readThrough(usersPg.listRequests, blobUsers.listRequests),
    getRequest: readThrough(usersPg.getRequest, blobUsers.getRequest),
    findPendingRequestByEmail: readThrough(usersPg.findPendingRequestByEmail, blobUsers.findPendingRequestByEmail),
    findUserByEmail: readThrough(usersPg.findUserByEmail, blobUsers.findUserByEmail),
    // Auth-relevant writes — FAIL CLOSED: both-or-neither across Postgres + the
    // Blobs mirror (rotate / disable-enable / delete / approve).
    saveUser: authWriteFailClosed(db, 'saveUser', blobUsers.saveUser, (user) => user?.id),
    removeUserRecord: authWriteFailClosed(db, 'removeUserRecord', blobUsers.removeUserRecord, (id) => id),
    // Non-auth writes — Postgres primary + Blobs mirror (reversible).
    saveRequest: writeThrough(usersPg.saveRequest, blobUsers.saveRequest),
    removeRequest: writeThrough(usersPg.removeRequest, blobUsers.removeRequest),
  }

  const sessions = {
    // Auth read — Postgres-authoritative (miss = invalid session; fallback to
    // the mirror only on a true DB unavailability).
    getByTokenHash: authGetSessionByTokenHash(sessionsPg.getByTokenHash, blobSessions.getSessionByTokenHash),
    // Auth writes — FAIL CLOSED: both-or-neither across Postgres + the mirror.
    save: sessionWriteFailClosed(db, 'save', blobSessions.saveSession),
    revokeByTokenHash: sessionWriteFailClosed(db, 'revokeByTokenHash', blobSessions.revokeSessionByTokenHash),
    revokeAllForUser: sessionBulkWriteFailClosed(db, 'revokeAllForUser', blobSessions.revokeAllForUser),
    deleteAllForUser: sessionBulkWriteFailClosed(db, 'deleteAllForUser', blobSessions.deleteAllForUser),
  }

  return {
    backend: 'postgres',
    users,
    sessions,
    feedback,
    items,
    lookupCache,
    lookupQueue,
  }
}
