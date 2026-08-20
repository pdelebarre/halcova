// collection-migration.js — FEAT-6.3 #316: the migration TOOL that backfills
// the legacy `items` table onto the generic collection model (ADR-0020 §11,
// ADR-0014) and provides the mandatory reconciliation + reverse-mapping
// rollback evidence.
//
// The legacy `items` table and its API contract remain fully supported until
// reconciliation PASS + an approved retirement ADR. This module NEVER deletes
// or rewrites `items` during backfill; it only ADDS the new-model rows
// (collections / canonical_items / collection_items). Rollback is a REVERSE
// MAPPING that regenerates the legacy envelope from the new model — never an
// irreversible delete (ADR-0020 §11).
//
// Stable mapping (ADR-0014): each legacy `items.id` is reused as the
// CollectionItem id, so the legacy→new mapping is identity-preserving and
// rollback is a deterministic function of the new model. CanonicalItem ids are
// deterministic (server-assigned, derived from the canonical identity) so the
// backfill is idempotent and re-runnable.
//
// Ownership is SERVER-AUTHORITATIVE: owner_id is read from the legacy row
// (never client-supplied) and carried onto the Collection. A client-supplied
// id is never authoritative (ADR-0020 §10, ADR-0010).
//
// `db` is any node-postgres-shaped pool ({ query }) — pg-mem in tests, real
// Postgres in production (scripts/migrate-collections.mjs).

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Deterministic, server-assigned ids (idempotency + reversibility).
// ---------------------------------------------------------------------------

// A stable uuid v5-style id from a string namespace. Server-assigned (never
// client-supplied); determinism is what makes the backfill idempotent and the
// rollback a pure function of the new model.
export function deterministicUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// ---------------------------------------------------------------------------
// Legacy item → generic model mapping (ADR-0020 §4/§5).
// ---------------------------------------------------------------------------

// The keyed provider-id map (additive, preserved; never authoritative for
// ownership — ADR-0020 §4/#317 control). Values are kept as-is (numbers like a
// Discogs release id stay numbers) so reverse-mapping restores the exact legacy
// envelope; dedup keys stringify for comparison only.
export function providerIdsFor(item, kind) {
  const ids = {}
  if (kind === 'records') {
    if (item.discogsId != null && item.discogsId !== '') ids.discogsId = item.discogsId
    if (item.mbid != null && item.mbid !== '') ids.mbid = String(item.mbid)
  } else {
    if (item.googleBooksId != null && item.googleBooksId !== '') ids.googleBooksId = String(item.googleBooksId)
    if (item.openLibraryId != null && item.openLibraryId !== '') ids.openLibraryId = String(item.openLibraryId)
    if (item.isbn != null && item.isbn !== '') ids.isbn = String(item.isbn)
  }
  return ids
}

// The canonical dedup key: the primary provider id when present, else the
// content fingerprint (ADR-0020 §4). Two legacy items that are the same work
// share one CanonicalItem; each still gets its own CollectionItem.
export function dedupKeyFor(item, kind) {
  const ids = providerIdsFor(item, kind)
  if (kind === 'records') {
    if (ids.discogsId) return { type: 'provider', key: `discogsId:${ids.discogsId}` }
    if (ids.mbid) return { type: 'provider', key: `mbid:${ids.mbid}` }
  } else {
    if (ids.googleBooksId) return { type: 'provider', key: `googleBooksId:${ids.googleBooksId}` }
    if (ids.openLibraryId) return { type: 'provider', key: `openLibraryId:${ids.openLibraryId}` }
    if (ids.isbn) return { type: 'provider', key: `isbn:${ids.isbn}` }
  }
  return { type: 'fingerprint', key: `fp:${contentFingerprint(item, kind)}` }
}

// The validated extensible PUBLIC catalogue attributes (ADR-0020 §6 canonical
// bucket). Only allowlisted, XSS-safe canonical fields are carried; everything
// else stays in the legacy envelope (never lost).
export function canonicalFromItem(item, kind) {
  const canonical = {}
  const s = (v) => (v == null ? undefined : String(v))
  const put = (k, v) => { if (v !== undefined && v !== '') canonical[k] = v }
  put('title', s(item.title))
  if (item.year != null) canonical.year = item.year
  put('label', s(item.label))
  if (Array.isArray(item.genre) && item.genre.length) canonical.genre = item.genre.map(String)
  if (Array.isArray(item.style) && item.style.length) canonical.style = item.style.map(String)
  put('country', s(item.country))
  put('formatType', s(item.formatType))
  put('formatRaw', s(item.formatRaw))
  put('catno', s(item.catno))
  put('isbn', s(item.isbn))
  if (item.pageCount != null) canonical.pageCount = item.pageCount
  put('description', s(item.description))
  put('subtitle', s(item.subtitle))
  put('series', s(item.series))
  put('mainCategory', s(item.mainCategory))
  put('released', s(item.released))
  return canonical
}

// Public media references (cover). Public + cacheable (ADR-0020 §9).
export function mediaFromItem(item) {
  const media = {}
  if (item.coverImage != null && item.coverImage !== '') media.coverImage = String(item.coverImage)
  return media
}

// A stable hash over the canonical core fields — used to dedupe locally-created
// items that have no provider id (ADR-0020 §4).
export function contentFingerprint(item, kind) {
  const canonical = canonicalFromItem(item, kind)
  const stable = JSON.stringify(canonical, Object.keys(canonical).sort())
  return createHash('sha256').update(`${kind}:${stable}`).digest('hex')
}

// The private, owned-instance state (ADR-0020 §5 owned bucket + flags). This is
// the ONLY place owned/private data lives in the new model.
export function ownedFromItem(item) {
  const owned_attributes = {}
  if (item.notes != null && item.notes !== '') owned_attributes.notes = String(item.notes)
  const flags = {}
  if (item.wishlist === true) flags.wishlist = true
  if (item.lending != null) flags.lending = item.lending
  if (item.lendingHistory != null) flags.lendingHistory = item.lendingHistory
  return { owned_attributes, flags }
}

// ---------------------------------------------------------------------------
// Backfill (idempotent, additive — never touches `items`).
// ---------------------------------------------------------------------------
export async function backfill(db) {
  const { rows: items } = await db.query('SELECT id, owner_id, kind, data FROM items')

  // 1) One Collection per distinct (owner_id, kind) — stable id, idempotent.
  const collections = new Map()
  for (const it of items) {
    const key = `${it.owner_id}:${it.kind}`
    if (!collections.has(key)) {
      collections.set(key, {
        id: deterministicUuid(`collection:${key}`),
        owner_id: it.owner_id,
        collection_type_id: it.kind,
      })
    }
  }
  for (const c of collections.values()) {
    await db.query(
      `INSERT INTO collections (id, owner_id, collection_type_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, collection_type_id) DO NOTHING`,
      [c.id, c.owner_id, c.collection_type_id],
    )
  }

  // 2) Dedupe CanonicalItem per (kind, dedup key) — shared catalogue identity.
  const canonicals = new Map()
  for (const it of items) {
    const item = it.data
    const dk = dedupKeyFor(item, it.kind)
    if (!canonicals.has(dk.key)) {
      canonicals.set(dk.key, {
        id: deterministicUuid(`canonical:${it.kind}:${dk.key}`),
        collection_type_id: it.kind,
        provider_ids: providerIdsFor(item, it.kind),
        content_fingerprint: dk.type === 'fingerprint' ? contentFingerprint(item, it.kind) : null,
        canonical_attributes: canonicalFromItem(item, it.kind),
        media: mediaFromItem(item),
        source: 'import',
      })
    }
  }
  for (const c of canonicals.values()) {
    await db.query(
      `INSERT INTO canonical_items
         (id, collection_type_id, provider_ids, content_fingerprint,
          canonical_attributes, media, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [c.id, c.collection_type_id, JSON.stringify(c.provider_ids),
        c.content_fingerprint, JSON.stringify(c.canonical_attributes),
        JSON.stringify(c.media), c.source],
    )
  }

  // 3) One CollectionItem per legacy item — id PRESERVED (stable mapping).
  for (const it of items) {
    const item = it.data
    const col = collections.get(`${it.owner_id}:${it.kind}`)
    const dk = dedupKeyFor(item, it.kind)
    const canon = canonicals.get(dk.key)
    const { owned_attributes, flags } = ownedFromItem(item)
    await db.query(
      `INSERT INTO collection_items
         (id, collection_id, canonical_item_id, status, owned_attributes, flags)
       VALUES ($1, $2, $3, 'active', $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [it.id, col.id, canon.id, JSON.stringify(owned_attributes), JSON.stringify(flags)],
    )
  }

  return {
    collections: collections.size,
    canonical: canonicals.size,
    collectionItems: items.length,
  }
}

// ---------------------------------------------------------------------------
// Reconciliation (ADR-0014): pre/post counts proving zero unexplained loss,
// duplication or ownership change.
// ---------------------------------------------------------------------------
export async function reconcile(db) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]?.c || 0

  const sourceItems = await one('SELECT count(*)::int AS c FROM items')
  const sourceOwners = await one(
    'SELECT count(*)::int AS c FROM (SELECT DISTINCT owner_id, kind FROM items) s',
  )
  const collections = await one('SELECT count(*)::int AS c FROM collections')
  const collectionOwners = await one(
    'SELECT count(*)::int AS c FROM (SELECT DISTINCT owner_id, collection_type_id FROM collections) s',
  )
  const canonicalItems = await one('SELECT count(*)::int AS c FROM canonical_items')
  const collectionItems = await one('SELECT count(*)::int AS c FROM collection_items')

  // Loss: a legacy item with no CollectionItem (by the preserved id).
  const loss = await one(
    `SELECT count(*)::int AS c FROM items i
     LEFT JOIN collection_items ci ON ci.id = i.id
     WHERE ci.id IS NULL`,
  )
  // Duplication / unexplained EXTRA target rows: a CollectionItem with no
  // backing legacy item. Because the stable mapping preserves the legacy id as
  // the CollectionItem id, a true per-item duplicate is impossible (id PK); this
  // guard catches any unrelated/extra target row a buggy backfill could create.
  const duplication = await one(
    `SELECT count(*)::int AS c
     FROM collection_items ci
     LEFT JOIN items i ON i.id = ci.id
     WHERE i.id IS NULL`,
  )
  // Ownership change: a CollectionItem whose owning Collection's owner differs
  // from the legacy item's owner.
  const ownershipChange = await one(
    `SELECT count(*)::int AS c
     FROM collection_items ci
     JOIN collections c ON c.id = ci.collection_id
     JOIN items i ON i.id = ci.id
     WHERE c.owner_id <> i.owner_id`,
  )
  // Unidentified migrated items (should be 0 — legacy items are identified).
  const unidentified = await one(
    'SELECT count(*)::int AS c FROM collection_items WHERE canonical_item_id IS NULL',
  )

  const pass =
    sourceItems === collectionItems &&
    loss === 0 &&
    duplication === 0 &&
    ownershipChange === 0 &&
    unidentified === 0

  return {
    pass,
    sourceItems,
    sourceOwners,
    collections,
    collectionOwners,
    canonicalItems,
    collectionItems,
    loss,
    duplication,
    ownershipChange,
    unidentified,
  }
}

// ---------------------------------------------------------------------------
// Rollback = REVERSE MAPPING (ADR-0020 §11): regenerate the legacy `items`
// envelope from the new model. Never an irreversible delete. Used to prove the
// legacy envelope is a complete, recoverable function of the new model.
// ---------------------------------------------------------------------------
export function reconstructItem(row) {
  const item = { id: row.id }
  const ca = row.canonical_attributes || {}
  for (const k of ['title', 'year', 'label', 'genre', 'style', 'country',
    'formatType', 'formatRaw', 'catno', 'isbn', 'pageCount', 'description',
    'subtitle', 'series', 'mainCategory', 'released']) {
    if (ca[k] != null) item[k] = ca[k]
  }
  const pi = row.provider_ids || {}
  for (const k of ['discogsId', 'mbid', 'googleBooksId', 'openLibraryId', 'isbn']) {
    if (pi[k] != null) item[k] = pi[k]
  }
  const m = row.media || {}
  if (m.coverImage) item.coverImage = m.coverImage
  const oa = row.owned_attributes || {}
  if (oa.notes) item.notes = oa.notes
  const fl = row.flags || {}
  if (fl.wishlist) item.wishlist = true
  if (fl.lending) item.lending = fl.lending
  if (fl.lendingHistory) item.lendingHistory = fl.lendingHistory
  return item
}

export async function rollback(db) {
  const { rows } = await db.query(
    `SELECT ci.id, c.owner_id, c.collection_type_id AS kind,
            ci.owned_attributes, ci.flags,
            cn.canonical_attributes, cn.media, cn.provider_ids
     FROM collection_items ci
     JOIN collections c ON c.id = ci.collection_id
     LEFT JOIN canonical_items cn ON cn.id = ci.canonical_item_id`,
  )
  let restored = 0
  for (const r of rows) {
    const item = reconstructItem(r)
    await db.query(
      `INSERT INTO items (id, owner_id, kind, data, title, wishlist)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.owner_id, r.kind, JSON.stringify(item), item.title || '', item.wishlist === true],
    )
    restored += 1
  }
  return { restored }
}