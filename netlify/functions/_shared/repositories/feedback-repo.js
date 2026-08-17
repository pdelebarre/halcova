// feedback-repo.js — Postgres feedback repository (feat/feedback, T1). Feedback
// is a member's suggestion or bug report, PRIVATE to the author + the owner
// (unlike reviews there is no public list): members write, the admin reads the
// inbox, triages status and leaves an owner-only internal admin note.
//
// The feedback object is FIRST-CLASS in the schema (see 006_feedback.sql):
// every field is a real column — the source of truth — with the database
// enforcing `type IN ('suggestion','bug')` and `message` between 1 and 4000
// chars. No `data jsonb` mirror; reads map rows to the camelCase feedback shape.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]
// The production module is _shared/postgres.js; unit tests inject pg-mem's
// node-postgres-compatible adapter.

import { randomUUID } from 'node:crypto'
import { DEFAULT_LIMIT, MAX_LIMIT } from '../pagination'

// All first-class feedback columns, read back verbatim (columns are the source
// of truth — no `data` jsonb).
const COLUMNS = `id, type, category, message, author_id, author_name, url, app_version, user_agent, status, admin_note, created_at, updated_at`

// Feedback ids are server-assigned UUIDs. A junk `?id=` must not 500 a request
// (a uuid column would throw on real Postgres) — guard every id-keyed lookup,
// exactly like items-repo's isUuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// The feedback status enum (migration 006). Junk statuses are no-ops (never a
// 500) — the status column has no CHECK, so the repo keeps junk out of the enum.
const FEEDBACK_STATUSES = new Set(['open', 'in_progress', 'done', 'wontfix', 'duplicate'])

// The feedback type enum (migration 006 has a CHECK on it). Junk types are
// coerced to the 'suggestion' default on create (a submitted feedback must
// never be lost) and ignored as list filters (never a 500).
const FEEDBACK_TYPES = new Set(['suggestion', 'bug'])

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// Map a feedback row to the camelCase feedback object the future feedback.js
// function / admin inbox will serve. Timestamps are normalized to ISO strings
// like the rest of the API.
function toFeedback(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    message: row.message,
    authorId: row.author_id,
    authorName: row.author_name,
    url: row.url,
    appVersion: row.app_version,
    userAgent: row.user_agent,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

// A valid feedback status, or the default when absent/invalid.
function asStatus(value) {
  return value && FEEDBACK_STATUSES.has(value) ? value : 'open'
}

// A valid feedback type, or the 'suggestion' default when absent/invalid.
// Deliberately a coercion, not a no-op: a malformed `type` must never 500 a
// request, and a submitted feedback must never be silently dropped.
function asType(value) {
  return value && FEEDBACK_TYPES.has(value) ? value : 'suggestion'
}

export function createFeedbackRepo(db) {
  // Create a feedback row. `id` is server-assigned (a junk/missing id gets a
  // fresh UUID); `type` is allow-listed (junk → 'suggestion'); `status`
  // defaults to 'open'. The message CHECK is left to the DATABASE (1–4000
  // chars): an empty or over-long message is REJECTED, never truncated — the
  // future feedback.js function validates `message` before it reaches here, so
  // a constraint violation is a client bug we surface, not silently paper over.
  // Returns the row.
  async function createFeedback(input) {
    const id = isUuid(input?.id) ? input.id : randomUUID()
    const { rows } = await db.query(
      `INSERT INTO feedback
         (id, type, category, message, author_id, author_name, url, app_version, user_agent, status, admin_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLUMNS}`,
      [id,
        asType(input?.type),
        String(input?.category ?? 'other'),
        String(input?.message ?? ''),
        String(input?.authorId ?? ''),
        String(input?.authorName ?? ''),
        String(input?.url ?? ''),
        String(input?.appVersion ?? ''),
        String(input?.userAgent ?? ''),
        asStatus(input?.status),
        String(input?.adminNote ?? '')],
    )
    return toFeedback(rows[0])
  }

  // The admin inbox: newest-first, optionally status- AND/OR type-filtered,
  // SQL-paginated (Phase 0 pagination.js semantics — default limit high). A
  // junk status/type filter is a no-op (ignored), never a 500.
  async function listFeedback({ status, type, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const capped = Math.max(0, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
    const params = []
    const clauses = []
    if (status && FEEDBACK_STATUSES.has(status)) {
      params.push(status)
      clauses.push(`status = $${params.length}`)
    }
    if (type && FEEDBACK_TYPES.has(type)) {
      params.push(type)
      clauses.push(`type = $${params.length}`)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(capped, Math.max(0, Number(offset) || 0))
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM feedback ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return rows.map(toFeedback)
  }

  // (ADMIN-EPIC-1, #259) — dashboard aggregate: feedback volume by status as
  // `[{ status, count }]`. SQL GROUP BY — the admin counts never scan the
  // whole table. Unknown statuses (there is no CHECK on the column) are simply
  // not tallied into the known enum; the caller's `total` still accounts for
  // every row.
  async function countsByStatus() {
    const { rows } = await db.query(
      `SELECT status, count(*)::int AS count FROM feedback GROUP BY status`,
    )
    return rows
  }

  // Admin triage: update a feedback's status and/or owner-only admin note. A
  // junk id is a no-op (null) and a JUNK status makes the WHOLE update a no-op
  // (null) — never a 500. Only the fields the caller actually sends are
  // touched; updated_at is bumped on every write so "triage happened" is
  // observable. Returns the updated row, or null when nothing was updated.
  async function updateFeedback(id, { status, adminNote } = {}) {
    if (!isUuid(id)) return null
    // A provided-but-invalid status invalidates the whole update (junk → no-op).
    if (status !== undefined && !FEEDBACK_STATUSES.has(status)) return null
    // Nothing to update — no-op rather than a pointless bump.
    if (status === undefined && adminNote === undefined) return null

    const sets = ['updated_at = now()']
    const params = [id]
    if (status !== undefined) {
      params.push(status)
      sets.push(`status = $${params.length}`)
    }
    if (adminNote !== undefined) {
      params.push(String(adminNote))
      sets.push(`admin_note = $${params.length}`)
    }
    const { rows } = await db.query(
      `UPDATE feedback SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    )
    return rows.length ? toFeedback(rows[0]) : null
  }

  async function deleteFeedback(id) {
    if (!isUuid(id)) return false
    const { rowCount } = await db.query(`DELETE FROM feedback WHERE id = $1`, [id])
    return rowCount > 0
  }

  // Member deletion cleanup (parity with reviews-repo's deleteByAuthor):
  // remove every piece of feedback the member wrote so Postgres never orphans
  // rows. `author_id` is denormalized text (members can be deleted), so this
  // is a plain delete by author id — no uuid guard needed.
  async function deleteByAuthor(authorId) {
    const { rowCount } = await db.query(`DELETE FROM feedback WHERE author_id = $1`, [authorId])
    return (rowCount || 0) > 0
  }

  // Run `fn(repo)` inside a BEGIN/COMMIT/ROLLBACK transaction. `fn` receives a
  // repo bound to the same client so every statement in it commits atomically;
  // any throw rolls back and rethrows. Parity with reviews-repo's transaction.
  async function transaction(fn) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(createFeedbackRepo(client))
      await client.query('COMMIT')
      return result
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* connection may be dead */ }
      throw err
    } finally {
      client.release()
    }
  }

  return {
    createFeedback,
    listFeedback,
    countsByStatus,
    updateFeedback,
    deleteFeedback,
    deleteByAuthor,
    transaction,
  }
}
