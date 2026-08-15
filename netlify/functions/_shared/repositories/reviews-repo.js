// reviews-repo.js — Postgres reviews repository for the reviews feature
// (feat/reviews, Task 3). Reviews are SHARED across all users: a release's
// reviews are public, so unlike items/users there is no owner_id here —
// `author_id` is the member who wrote it and every authenticated caller can
// read the list. `source_id` is the release/volume the review is about
// (discogsId | googleBooksId).
//
// The review object is FIRST-CLASS in the schema (see 005_reviews.sql): every
// field is a real column — the source of truth — with the database enforcing
// `rating BETWEEN 1 AND 5` and `UNIQUE (kind, source_id, author_id)`, the
// upsert key (one review per member per release). No `data jsonb` mirror;
// reads map rows to the camelCase review shape.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]
// The production module is _shared/postgres.js; unit tests inject pg-mem's
// node-postgres-compatible adapter.

import { randomUUID } from 'node:crypto'
import { DEFAULT_LIMIT, MAX_LIMIT } from '../pagination'

// All first-class review columns, read back verbatim (columns are the source
// of truth — no `data` jsonb).
const COLUMNS = `id, kind, source_id, author_id, author_name, rating, body, status, created_at, updated_at`

// Review ids are server-assigned UUIDs. A junk `?id=` must not 500 a request
// (a uuid column would throw on real Postgres) — guard every id-keyed lookup,
// exactly like items-repo's isUuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// The review status enum (migration 005). Junk statuses are no-ops (never a
// 500) — the status column has no CHECK, so the repo keeps junk out of the enum.
const REVIEW_STATUSES = new Set(['published', 'pending', 'hidden'])

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// Map a reviews row to the camelCase review object the future reviews.js
// function / admin endpoints will serve. `rating` is int4 (a JS number on pg
// and pg-mem); timestamps are normalized to ISO strings like the rest of the
// API.
function toReview(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    sourceId: row.source_id,
    authorId: row.author_id,
    authorName: row.author_name,
    rating: Number(row.rating),
    body: row.body,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

// Clamp a rating into the CHECK (1..5): a client bug (0, 6, -1, 'x') must not
// violate the constraint and 500 the request — clamp instead, like items-repo
// coerces non-numeric years to null rather than throwing. A non-numeric rating
// defaults to 5 (a malformed rating is better served than crashed; the
// reviews.js function validates the body before it reaches here).
function asRating(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.max(1, Math.min(5, Math.trunc(n)))
}

// A valid review status, or the default when absent/invalid.
function asStatus(value) {
  return value && REVIEW_STATUSES.has(value) ? value : 'published'
}

export function createReviewsRepo(db) {
  // "My review" prefill: the author's own review for a release, ANY status —
  // a member editing their pending/hidden review should still see it. Declared
  // before upsertReview so the preserve-on-undefined status rule can read it.
  async function getByAuthor(kind, sourceId, authorId) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM reviews
       WHERE kind = $1 AND source_id = $2 AND author_id = $3 LIMIT 1`,
      [kind, sourceId, authorId],
    )
    return rows.length ? toReview(rows[0]) : null
  }

  // Upsert a member's review for a release. The UNIQUE (kind, source_id,
  // author_id) constraint makes a second write by the same author UPDATE the
  // existing row (keeping its id and created_at) instead of inserting a
  // duplicate — "a member editing their review". A missing/junk `id` gets a
  // fresh server-assigned UUID (the blob/collection pattern); updated_at is
  // bumped on every write so "edited" is observable. Returns the row.
  //
  // Preserve-on-undefined status (like users-repo's billing fields): when the
  // caller sends NO `status`, the existing status is kept — a member editing
  // their review must not silently un-hide a review the admin set to 'hidden'
  // (or pull a 'pending' one live). Only an explicit status changes it.
  async function upsertReview(input) {
    const kind = String(input?.kind ?? '')
    const sourceId = String(input?.sourceId ?? '')
    const authorId = String(input?.authorId ?? '')
    const id = isUuid(input?.id) ? input.id : randomUUID()
    let status = asStatus(input?.status)
    if (input?.status === undefined) {
      const existing = await getByAuthor(kind, sourceId, authorId)
      if (existing) status = existing.status
    }
    const { rows } = await db.query(
      `INSERT INTO reviews (id, kind, source_id, author_id, author_name, rating, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (kind, source_id, author_id) DO UPDATE SET
         author_name = EXCLUDED.author_name,
         rating      = EXCLUDED.rating,
         body        = EXCLUDED.body,
         status      = EXCLUDED.status,
         updated_at  = now()
       RETURNING ${COLUMNS}`,
      [id, kind, sourceId, authorId, String(input?.authorName ?? ''), asRating(input?.rating),
        String(input?.body ?? ''), status],
    )
    return toReview(rows[0])
  }

  // A release's reviews (newest first) + the rating aggregate { avg, count },
  // both scoped to the SAME status filter (published by default) so the count
  // and average always describe the list being served.
  async function listReviews(kind, sourceId, { status = 'published' } = {}) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM reviews
       WHERE kind = $1 AND source_id = $2 AND status = $3
       ORDER BY created_at DESC, id DESC`,
      [kind, sourceId, status],
    )
    const { rows: aggRows } = await db.query(
      `SELECT count(*)::int AS count, COALESCE(avg(rating), 0) AS avg
       FROM reviews WHERE kind = $1 AND source_id = $2 AND status = $3`,
      [kind, sourceId, status],
    )
    return {
      reviews: rows.map(toReview),
      // avg is numeric on real pg (string) but a number on pg-mem — normalize.
      aggregate: { avg: Number(aggRows[0]?.avg ?? 0), count: aggRows[0]?.count || 0 },
    }
  }

  async function getReview(id) {
    if (!isUuid(id)) return null
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM reviews WHERE id = $1 LIMIT 1`,
      [id],
    )
    return rows.length ? toReview(rows[0]) : null
  }

  async function deleteReview(id) {
    if (!isUuid(id)) return false
    const { rowCount } = await db.query(`DELETE FROM reviews WHERE id = $1`, [id])
    return rowCount > 0
  }

  // Admin hide/show + pending: set the status on a review. A junk id or junk
  // status is a no-op (false) — never a 500.
  async function setStatus(id, status) {
    if (!isUuid(id) || !REVIEW_STATUSES.has(status)) return false
    const { rowCount } = await db.query(
      `UPDATE reviews SET status = $2, updated_at = now() WHERE id = $1`,
      [id, status],
    )
    return rowCount > 0
  }

  // Admin listing: newest-first, optionally status-filtered, SQL-paginated
  // (Phase 0 pagination.js semantics — default limit high).
  async function listAll({ status, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const capped = Math.max(0, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
    const params = []
    let where = ''
    if (status && REVIEW_STATUSES.has(status)) {
      params.push(status)
      where = 'WHERE status = $1'
    }
    params.push(capped, Math.max(0, Number(offset) || 0))
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM reviews ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return rows.map(toReview)
  }

  // Member deletion cleanup (parity with items deleteAllForOwner): remove
  // every review the member wrote so Postgres never orphans rows.
  async function deleteByAuthor(authorId) {
    const { rowCount } = await db.query(`DELETE FROM reviews WHERE author_id = $1`, [authorId])
    return (rowCount || 0) > 0
  }

  // Run `fn(repo)` inside a BEGIN/COMMIT/ROLLBACK transaction. `fn` receives a
  // repo bound to the same client so every statement in it commits atomically;
  // any throw rolls back and rethrows. Parity with items-repo's transaction.
  async function transaction(fn) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(createReviewsRepo(client))
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
    upsertReview,
    listReviews,
    getReview,
    getByAuthor,
    deleteReview,
    setStatus,
    listAll,
    deleteByAuthor,
    transaction,
  }
}
