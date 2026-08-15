// items-repo.js — Postgres items repository for the Phase 1 data layer
// (ADR-0002, epic #38). It mirrors the current Netlify Blobs item API shape
// EXACTLY so the client (src/api/collection.js + src/hooks/useCollection.js)
// is untouched: `data jsonb` stores the very item object the client wrote, and
// reads return that object verbatim. The scalar/array columns are mirrors
// derived from `data` on every write — used for querying, `date_added` ordering
// and the SQL owned-count — so they can never drift from the JSON.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]
// The production module is _shared/postgres.js; unit tests inject pg-mem's
// node-postgres-compatible adapter.

import { DEFAULT_LIMIT, MAX_LIMIT } from '../pagination'

// All first-class columns except id/owner_id/kind (those are WHERE/INSERT keyed).
const COLUMNS = `title, year, label, genre, style, country, format_type, barcode,
  discogs_id, google_books_id, cover_image, data, date_added, wishlist,
  lending, lending_history, page_count, notes`

// A number, or null when the client value isn't numeric (e.g. '' from a lookup).
function asInt(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

// Item ids are server-assigned UUIDs. The Blob path treats a junk `?id=` as
// "not found" (store.get('item:junk') -> null); a uuid column would throw on
// real Postgres, so guard the lookups to preserve that parity (and keep junk
// ids from 500ing a request).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// A Date from an ISO string, or null when unparseable.
function asDate(value) {
  if (value == null) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Derive the mirror-column values from the exact client item object. (ownerId
// and kind are not part of the item JSON — they're separate WHERE/INSERT keys.)
// Exported so the backfill script (scripts/backfill.mjs) upserts Blobs items
// with the exact same mirror columns — no drift between the two writers.
export function itemRowValues(item) {
  const data = item && typeof item === 'object' ? item : {}
  const dateAdded = asDate(data.dateAdded) || new Date()
  return {
    id: data.id,
    title: data.title == null ? '' : String(data.title),
    year: asInt(data.year),
    label: data.label == null ? null : String(data.label),
    genre: Array.isArray(data.genre) ? data.genre.map(String) : [],
    style: Array.isArray(data.style) ? data.style.map(String) : [],
    country: data.country == null ? null : String(data.country),
    format_type: data.formatType == null ? null : String(data.formatType),
    barcode: data.barcode == null ? null : String(data.barcode),
    discogs_id: data.discogsId == null ? null : String(data.discogsId),
    google_books_id: data.googleBooksId == null ? null : String(data.googleBooksId),
    cover_image: data.coverImage == null ? null : String(data.coverImage),
    data: JSON.stringify(data),
    date_added: dateAdded,
    wishlist: data.wishlist === true,
    lending: data.lending == null ? null : JSON.stringify(data.lending),
    lending_history: data.lendingHistory == null ? null : JSON.stringify(data.lendingHistory),
    page_count: asInt(data.pageCount),
    notes: data.notes == null ? null : String(data.notes),
  }
}

const INSERT_SQL = `
  INSERT INTO items (id, owner_id, kind, ${COLUMNS})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
  ON CONFLICT (id) DO NOTHING
`

const UPDATE_SQL = `
  UPDATE items SET
    title = $1, year = $2, label = $3, genre = $4, style = $5, country = $6,
    format_type = $7, barcode = $8, discogs_id = $9, google_books_id = $10,
    cover_image = $11, data = $12, date_added = $13, wishlist = $14,
    lending = $15, lending_history = $16, page_count = $17, notes = $18
  WHERE owner_id = $19 AND kind = $20 AND id = $21
`

function insertParams(v, ownerId, kind) {
  return [v.id, ownerId, kind, v.title, v.year, v.label, v.genre, v.style, v.country,
    v.format_type, v.barcode, v.discogs_id, v.google_books_id, v.cover_image, v.data,
    v.date_added, v.wishlist, v.lending, v.lending_history, v.page_count, v.notes]
}

function updateParams(v, ownerId, kind, id) {
  return [v.title, v.year, v.label, v.genre, v.style, v.country, v.format_type,
    v.barcode, v.discogs_id, v.google_books_id, v.cover_image, v.data, v.date_added,
    v.wishlist, v.lending, v.lending_history, v.page_count, v.notes, ownerId, kind, id]
}

export function createItemsRepo(db) {
  // Ordered list read (newest first — the blob index's insertion order),
  // scoped to a single owner + kind with SQL pagination (Phase 0 pagination.js
  // semantics: default limit high so the unpaginated client is unchanged).
  async function listItems(ownerId, kind, { limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const capped = Math.max(0, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
    const { rows } = await db.query(
      `SELECT data FROM items
       WHERE owner_id = $1 AND kind = $2
       ORDER BY date_added DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [ownerId, kind, capped, Math.max(0, Number(offset) || 0)],
    )
    return rows.map((r) => r.data)
  }

  // The full set of item ids for an owner+kind (no pagination) — used by the
  // lazy read-through reconcile (collection-postgres.js) to detect which Blobs
  // items are still missing from Postgres. Ids only, so it stays cheap on the
  // hot GET path.
  async function listItemIds(ownerId, kind) {
    const { rows } = await db.query(
      `SELECT id FROM items WHERE owner_id = $1 AND kind = $2`,
      [ownerId, kind],
    )
    return rows.map((r) => r.id)
  }

  async function getItem(ownerId, kind, id) {
    if (!isUuid(id)) return null
    const { rows } = await db.query(
      `SELECT data FROM items WHERE owner_id = $1 AND kind = $2 AND id = $3`,
      [ownerId, kind, id],
    )
    return rows.length ? rows[0].data : null
  }

  // Idempotent insert: same id (e.g. a re-seed or a retried request) is a no-op.
  async function insertItem(ownerId, kind, item) {
    const v = itemRowValues(item)
    await db.query(INSERT_SQL, insertParams(v, ownerId, kind))
    return item
  }

  // Replace the full item for a single owner+kind+id. Returns null when the
  // row doesn't exist (mirrors the blob PUT's 404 path — the caller checks).
  async function updateItem(ownerId, kind, id, item) {
    if (!isUuid(id)) return null
    const v = itemRowValues(item)
    const { rowCount } = await db.query(UPDATE_SQL, updateParams(v, ownerId, kind, id))
    return rowCount > 0 ? item : null
  }

  // Idempotent delete (mirrors the blob DELETE, which 200s on a missing item).
  async function deleteItem(ownerId, kind, id) {
    if (!isUuid(id)) return false
    const { rowCount } = await db.query(
      `DELETE FROM items WHERE owner_id = $1 AND kind = $2 AND id = $3`,
      [ownerId, kind, id],
    )
    return rowCount > 0
  }

  // The free-tier plan cap: an SQL count of OWNED (non-wishlist) items — the
  // same predicate counts.js used (`!item.wishlist`), replacing the blob
  // denormalized-count read.
  async function countOwned(ownerId, kind) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS count FROM items
       WHERE owner_id = $1 AND kind = $2 AND NOT wishlist`,
      [ownerId, kind],
    )
    return rows[0]?.count || 0
  }

  // Delete every item for an owner (used when a member is deleted, so Postgres
  // never orphans rows — the blob path's deleteUserCollections covers the Blobs).
  async function deleteAllForOwner(ownerId) {
    const { rowCount } = await db.query(`DELETE FROM items WHERE owner_id = $1`, [ownerId])
    return (rowCount || 0) > 0
  }

  // Run `fn(repo)` inside a BEGIN/COMMIT/ROLLBACK transaction. `fn` receives a
  // repo bound to the same client so every statement in it commits atomically;
  // any throw rolls back and rethrows. The plan-limit check + insert live in
  // one transaction so the cap can't drift between the count and the write.
  async function transaction(fn) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(createItemsRepo(client))
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
    listItems,
    listItemIds,
    getItem,
    insertItem,
    updateItem,
    deleteItem,
    countOwned,
    deleteAllForOwner,
    transaction,
  }
}
