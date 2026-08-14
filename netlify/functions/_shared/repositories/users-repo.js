// users-repo.js — Postgres users/requests repository for the Phase 1 data layer
// (ADR-0002, epic #38). Mirrors the identity blob store shapes from
// _shared/users.js exactly so auth.js / admin.js / discogs.js / books.js /
// collection-store.js keep working unchanged.
//
// User blob shape  -> { id, name, email, code, collections:{records,books},
//                        features:{lending}, plan, role, status, createdAt }
// Request blob shape -> { id, name, email, status, createdAt, approvedAt?, rejectedAt? }
//
// `code_hash` (sha256 of the normalized code) is populated from Part A with a
// unique index — the O(1) lookup the ADR specifies. The plaintext `code` column
// is an INTERIM Part A column so findUserByCode()/sessionPayload() keep working
// (the Blobs path stores plaintext today). Part B owns the hashing + admin
// rotation story and drops the `code` column. Requests/items are read back from
// their `data` jsonb (source of truth) so the client shape round-trips verbatim.

import { createHash } from 'node:crypto'
import { normalizeCode } from '../codes'

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

// The canonical code hash used for the unique-indexed lookup.
export function codeHashFor(code) {
  const norm = normalizeCode(code)
  return norm ? sha256(norm) : null
}

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
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    code: row.code,                    // interim Part A column (Blobs-path parity)
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
    code: user.code || null,
    code_hash: codeHashFor(user.code),
    role: user.role || 'member',
    status: user.status || 'active',
    plan: user.plan || 'free',
    features: JSON.stringify(user.features || {}),
    collections: JSON.stringify(user.collections || {}),
    created_at: asDate(user.createdAt) || new Date(),
  }
}

function requestRowValues(request) {
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

const USER_COLUMNS = `id, name, email, code, code_hash, role, status, plan, features, collections, created_at`

export function createUsersRepo(db) {
  // O(1) member lookup by access code — the Phase 0 `code:<norm>` index becomes
  // a unique-indexed `code_hash` lookup. Falls back to the plaintext `code`
  // column when the hash is missing (belt-and-braces for any hand-written row).
  async function findUserByCode(code) {
    const hash = codeHashFor(code)
    if (!hash) return null
    let rows
    try {
      ;({ rows } = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE code_hash = $1 LIMIT 1`,
        [hash],
      ))
    } catch {
      rows = []
    }
    if (!rows.length && code) {
      ;({ rows } = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE code = $1 LIMIT 1`,
        [normalizeCode(code)],
      ))
    }
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

  // Upsert a user. Keeps code_hash in sync whenever a plaintext code is given;
  // when none is (e.g. an update that only touches collections/status/plan) the
  // existing code/hash is preserved.
  async function saveUser(user) {
    const v = userRowValues(user)
    const existing = v.code_hash ? null : await getUser(user.id)
    const code = v.code
    const codeHash = v.code_hash || codeHashFor(existing?.code)
    await db.query(
      `INSERT INTO users (${USER_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email, code = EXCLUDED.code,
         code_hash = EXCLUDED.code_hash, role = EXCLUDED.role, status = EXCLUDED.status,
         plan = EXCLUDED.plan, features = EXCLUDED.features, collections = EXCLUDED.collections
       `,
      [user.id, v.name, v.email, code, codeHash, v.role, v.status, v.plan, v.features, v.collections, v.created_at],
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
