// users-repo.js — Postgres users/requests repository for the Phase 1 data layer
// (ADR-0002, epic #38). Mirrors the identity blob store shapes from
// _shared/users.js exactly so auth.js / admin.js / discogs.js / books.js /
// collection-store.js keep working unchanged.
//
// User blob shape  -> { id, name, email, collections:{records,books},
//                        features:{lending}, plan, role, status, createdAt }
// Request blob shape -> { id, name, email, status, createdAt, approvedAt?, rejectedAt? }
//
// Part B (auth hashing + admin rotation): the plaintext `code` column is DROPPED
// (migration 002_hash_codes.sql). `code_hash` = sha256(normalize(code)) is the
// sole authority — the unique-indexed O(1) lookup the ADR specifies — and a
// Postgres-backed user NEVER carries `code` (or `code_hash`) to the caller.
// The Blobs mirror keeps plaintext codes during read-through (documented in
// db/README.md) so no member is locked out mid-cutover. Requests/items are read
// back from their `data` jsonb (source of truth) so the client shape round-trips
// verbatim.

import { createHash } from 'node:crypto'
import { normalizeCode } from '../codes'

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

// The canonical code hash used for the unique-indexed lookup: sha256 of the
// SAME normalizeCode() from _shared/codes.js (trim + uppercase), so a hash is
// stable regardless of how the code was typed — including auth.js's own
// `.toUpperCase()` before findUserByCode(). Returns null for an empty code.
export function hashCode(code) {
  const norm = normalizeCode(code)
  return norm ? sha256(norm) : null
}

// Alias kept for the Part A callers/tests; hashCode is the canonical helper.
export const codeHashFor = hashCode

function asDate(value) {
  if (value == null) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function toUser(row) {
  if (!row) return null
  // No `code` / `code_hash`: a Postgres-backed user must never leak either to
  // the caller (the client only ever holds the plaintext code it was issued).
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    collections: row.collections || {},
    features: row.features || {},
    plan: row.plan || 'free',          // normalized exactly like the blob read
    role: row.role,
    status: row.status,
    createdAt: toIso(row.created_at),
  }
}

function userRowValues(user) {
  return {
    id: user.id,
    name: user.name || '',
    email: user.email || '',
    code_hash: hashCode(user.code),
    role: user.role || 'member',
    status: user.status || 'active',
    plan: user.plan || 'free',
    features: JSON.stringify(user.features || {}),
    collections: JSON.stringify(user.collections || {}),
    created_at: asDate(user.createdAt) || new Date(),
  }
}

// Exported so the backfill script (scripts/backfill.mjs) upserts requests with
// the exact same row shape (the `data` jsonb is the source of truth).
export function requestRowValues(request) {
  const r = request && typeof request === 'object' ? request : {}
  return {
    id: r.id,
    name: r.name || '',
    email: r.email || '',
    status: r.status || 'pending',
    data: JSON.stringify(r),
    created_at: asDate(r.createdAt) || new Date(),
    approved_at: asDate(r.approvedAt),
    rejected_at: asDate(r.rejectedAt),
  }
}

const USER_COLUMNS = `id, name, email, code_hash, role, status, plan, features, collections, created_at`

export function createUsersRepo(db) {
  // O(1) member lookup by access code — the unique-indexed `code_hash` lookup
  // (ADR-0002). normalizeCode() inside hashCode() handles trim + uppercase, so
  // it agrees with the Blobs path and auth.js's own `.toUpperCase()` no matter
  // how the code was typed. A DB error propagates to the repository's
  // read-through wrapper, which degrades to the Blobs lookup.
  async function findUserByCode(code) {
    const hash = hashCode(code)
    if (!hash) return null
    const { rows } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE code_hash = $1 LIMIT 1`,
      [hash],
    )
    return rows.length ? toUser(rows[0]) : null
  }

  async function getUser(id) {
    const { rows } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [id],
    )
    return rows.length ? toUser(rows[0]) : null
  }

  async function listUsers() {
    const { rows } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC, id ASC`,
    )
    return rows.map(toUser)
  }

  // Upsert a user. Stores ONLY the sha256 hash — never plaintext. Whenever a
  // plaintext code is present (approve, rotation, backfill) its hash is written;
  // when none is (an update that only touches collections/status/plan) the
  // existing hash is preserved so the member keeps signing in. The existing hash
  // is read straight from the row (toUser deliberately never surfaces it).
  async function saveUser(user) {
    const v = userRowValues(user)
    let codeHash = v.code_hash
    if (!codeHash) {
      const { rows } = await db.query('SELECT code_hash FROM users WHERE id = $1 LIMIT 1', [user.id])
      codeHash = rows.length ? rows[0].code_hash : null
    }
    await db.query(
      `INSERT INTO users (${USER_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email, code_hash = EXCLUDED.code_hash,
         role = EXCLUDED.role, status = EXCLUDED.status, plan = EXCLUDED.plan,
         features = EXCLUDED.features, collections = EXCLUDED.collections
       `,
      [user.id, v.name, v.email, codeHash, v.role, v.status, v.plan, v.features, v.collections, v.created_at],
    )
    return user
  }

  async function removeUserRecord(id) {
    const { rowCount } = await db.query(`DELETE FROM users WHERE id = $1`, [id])
    return (rowCount || 0) > 0
  }

  // --- Signup requests ---

  async function listRequests() {
    const { rows } = await db.query(
      `SELECT data FROM requests ORDER BY created_at ASC, id ASC`,
    )
    return rows.map((r) => r.data)
  }

  async function getRequest(id) {
    const { rows } = await db.query(`SELECT data FROM requests WHERE id = $1 LIMIT 1`, [id])
    return rows.length ? rows[0].data : null
  }

  async function saveRequest(request) {
    const v = requestRowValues(request)
    await db.query(
      `INSERT INTO requests (id, name, email, status, data, created_at, approved_at, rejected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email, status = EXCLUDED.status,
         data = EXCLUDED.data, approved_at = EXCLUDED.approved_at, rejected_at = EXCLUDED.rejected_at
       `,
      [v.id, v.name, v.email, v.status, v.data, v.created_at, v.approved_at, v.rejected_at],
    )
    return request
  }

  async function removeRequest(id) {
    const { rowCount } = await db.query(`DELETE FROM requests WHERE id = $1`, [id])
    return (rowCount || 0) > 0
  }

  // Deduped pending-request lookup by email (case/whitespace-insensitive,
  // matching auth.js's findPendingRequestByEmail).
  async function findPendingRequestByEmail(email) {
    const norm = String(email || '').trim().toLowerCase()
    if (!norm) return null
    const { rows } = await db.query(
      `SELECT data FROM requests
       WHERE status = 'pending' AND lower(btrim(email)) = $1
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [norm],
    )
    return rows.length ? rows[0].data : null
  }

  return {
    findUserByCode,
    getUser,
    listUsers,
    saveUser,
    removeUserRecord,
    listRequests,
    getRequest,
    saveRequest,
    removeRequest,
    findPendingRequestByEmail,
  }
}
