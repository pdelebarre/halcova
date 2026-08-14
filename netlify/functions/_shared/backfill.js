// backfill.js — Blobs → Postgres backfill (ADR-0002 Phase 1, Part B).
//
// Copies the legacy Netlify Blob stores into the Phase 1 Postgres tables. It
// is a DEPLOY-TIME OWNER step (run via scripts/backfill.mjs before serving
// reads from Postgres) and is never part of the request path.
//
// The blob reader is injected (`blob.read(store, key)`, `blob.listKeys(store)`)
// so the pure logic is unit-testable with an in-memory map + pg-mem, and the
// CLI can point it at @netlify/blobs.
//
// Properties:
//   - IDEMPOTENT: every write is an upsert on a natural key — users by id,
//     requests by id, items by (owner_id, kind, id) via the uuid PK, and
//     lookup_cache by (provider, key) — so re-running is safe and refreshes.
//   - REVERSIBLE: it only ADDS to Postgres. The legacy Blob stores are NEVER
//     renamed or deleted; rollback = stop serving from Postgres (unset
//     DATABASE_URL) and Blobs is still the complete store.
//   - PER-STORE: `onlyStore` backfills a single store for a staged cutover.
//   - DRY-RUN: `dryRun: true` computes + reports counts without writing.
//   - HASHED: access codes are stored as code_hash (sha256 of the normalized
//     code) — never plaintext. A member whose plaintext code lives ONLY in
//     Blobs is hashed from that same plaintext during backfill, so nobody is
//     locked out mid-cutover (it's the same code, just hashed now).

import { OWNER_ID } from './auth'
import { hashCode } from './repositories/users-repo'
import { requestRowValues } from './repositories/users-repo'
import { itemRowValues } from './repositories/items-repo'

const IDENTITY = 'runout-identity'
const USER_PREFIX = 'user:'
const REQUEST_PREFIX = 'request:'
const USERS_INDEX = 'index:users'
const REQUESTS_INDEX = 'index:requests'
const ITEM_INDEX = 'index'
const ITEM_PREFIX = 'item:'

// The owner's legacy item stores map directly to kinds (never renamed).
const OWNER_STORES = { 'runout-collection': 'records', 'runout-library': 'books' }
// The shared provider caches map to the lookup_cache `provider` column.
const LOOKUP_STORES = { 'discogs-cache': 'discogs', 'books-cache': 'books' }

export const DAY_MS = 24 * 60 * 60 * 1000

// --- Pure helpers (unit-tested) ---

// The exact per-prefix TTLs discogs.js / books.js use (Part B preserves them):
// barcode/isbn/release/detail 30d, text q 1d. Returns null for an unknown key
// prefix — those entries are skipped (they were never served by the functions).
export function lookupTtlFor(provider, key) {
  const k = String(key || '')
  if (provider === 'discogs') {
    if (k.startsWith('barcode:')) return 30 * DAY_MS
    if (k.startsWith('release:')) return 30 * DAY_MS
    if (k.startsWith('q:')) return DAY_MS
    return null
  }
  if (provider === 'books') {
    if (k.startsWith('isbn:')) return 30 * DAY_MS
    if (k.startsWith('detail:')) return 30 * DAY_MS
    if (k.startsWith('q:')) return DAY_MS
    return null
  }
  return null
}

// Turn one legacy `{ ts, data }` cache entry into a lookup_cache row, or null
// when the key prefix is unknown or the entry is already stale (a stale entry
// would be filtered out on read anyway, so it is not worth backfilling).
export function lookupCacheRow(provider, key, entry, now = Date.now()) {
  if (!entry || entry.data === undefined || entry.ts == null) return null
  const ttl = lookupTtlFor(provider, key)
  if (!ttl) return null
  const expiresAt = new Date(entry.ts + ttl)
  if (expiresAt.getTime() <= now) return null
  return { provider, key, data: entry.data, expires_at: expiresAt }
}

// Shape a Blobs user for the users table: hash the access code (code_hash, and
// the plaintext `code` is DROPPED — Postgres never stores it) and normalize the
// defaults exactly like users-repo. Returns null for a user with no id.
export function userRowForDb(user) {
  if (!user || !user.id) return null
  const { code: _code, ...rest } = user
  return {
    id: rest.id,
    name: rest.name || '',
    email: rest.email || '',
    code_hash: hashCode(user.code),
    role: rest.role || 'member',
    status: rest.status || 'active',
    plan: rest.plan || 'free',
    features: JSON.stringify(rest.features || {}),
    collections: JSON.stringify(rest.collections || {}),
    created_at: rest.createdAt ? new Date(rest.createdAt) : new Date(),
  }
}

// Parse a member store name (`collection-<userId>-<kind>`) into its owner id +
// collection kind, or null when it isn't one. userIds are uuids and may contain
// hyphens, so the LAST `-` separates the kind.
export function parseMemberStore(storeName) {
  if (!String(storeName || '').startsWith('collection-')) return null
  const kindSep = String(storeName).lastIndexOf('-')
  if (kindSep <= 'collection-'.length) return null
  const collection = String(storeName).slice(kindSep + 1)
  const owner = String(storeName).slice('collection-'.length, kindSep)
  if (!['records', 'books'].includes(collection) || !owner) return null
  return { owner, collection }
}

// --- Upsert statements (idempotent, natural keys) ---

const USER_COLUMNS = `id, name, email, code_hash, role, status, plan, features, collections, created_at`
const INSERT_USER_SQL = `
  INSERT INTO users (${USER_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, email = EXCLUDED.email, code_hash = EXCLUDED.code_hash,
    role = EXCLUDED.role, status = EXCLUDED.status, plan = EXCLUDED.plan,
    features = EXCLUDED.features, collections = EXCLUDED.collections
`

const INSERT_REQUEST_SQL = `
  INSERT INTO requests (id, name, email, status, data, created_at, approved_at, rejected_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, email = EXCLUDED.email, status = EXCLUDED.status,
    data = EXCLUDED.data, approved_at = EXCLUDED.approved_at, rejected_at = EXCLUDED.rejected_at
`

// Mirrors items-repo.js exactly (same mirror columns, same upsert shape) — the
// PK is the item uuid, so idempotency is (id) and owner_id/kind are refreshed.
const ITEM_COLUMNS = `title, year, label, genre, style, country, format_type, barcode,
  discogs_id, google_books_id, cover_image, data, date_added, wishlist,
  lending, lending_history, page_count, notes`
const INSERT_ITEM_SQL = `
  INSERT INTO items (id, owner_id, kind, ${ITEM_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
  ON CONFLICT (id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id, kind = EXCLUDED.kind,
    title = EXCLUDED.title, year = EXCLUDED.year, label = EXCLUDED.label,
    genre = EXCLUDED.genre, style = EXCLUDED.style, country = EXCLUDED.country,
    format_type = EXCLUDED.format_type, barcode = EXCLUDED.barcode,
    discogs_id = EXCLUDED.discogs_id, google_books_id = EXCLUDED.google_books_id,
    cover_image = EXCLUDED.cover_image, data = EXCLUDED.data, date_added = EXCLUDED.date_added,
    wishlist = EXCLUDED.wishlist, lending = EXCLUDED.lending,
    lending_history = EXCLUDED.lending_history, page_count = EXCLUDED.page_count,
    notes = EXCLUDED.notes
`

const INSERT_LOOKUP_SQL = `
  INSERT INTO lookup_cache (provider, key, data, expires_at) VALUES ($1,$2,$3,$4)
  ON CONFLICT (provider, key) DO UPDATE SET
    data = EXCLUDED.data, expires_at = EXCLUDED.expires_at
`

// --- Store enumeration (which units to backfill) ---

async function readIdentityUsers(blob) {
  const ids = (await blob.read(IDENTITY, USERS_INDEX)) || []
  const users = []
  for (const id of ids) {
    const user = await blob.read(IDENTITY, `${USER_PREFIX}${id}`)
    if (user) users.push(user)
  }
  return users
}

// The full list of backfill units, optionally filtered to one store name.
// A `collection-…` unit is parsed from its name; member stores for a full run
// are derived from the identity users (the owner is never stored, and admin
// rows — none today — are skipped).
export async function enumerateUnits(blob, onlyStore = null) {
  const units = []
  const add = (u) => { if (!onlyStore || u.store === onlyStore) units.push(u) }

  add({ store: IDENTITY, kind: 'users' })
  add({ store: IDENTITY, kind: 'requests' })
  for (const [store, collection] of Object.entries(OWNER_STORES)) {
    add({ store, kind: 'items', owner: OWNER_ID, collection })
  }
  for (const [store, provider] of Object.entries(LOOKUP_STORES)) {
    add({ store, kind: 'lookup', provider })
  }

  const member = parseMemberStore(onlyStore)
  if (member) {
    add({ store: onlyStore, kind: 'items', owner: member.owner, collection: member.collection })
  } else if (!onlyStore || onlyStore === IDENTITY) {
    const users = await readIdentityUsers(blob)
    for (const user of users) {
      if (user.role === 'admin' || user.id === OWNER_ID) continue
      add({ store: `collection-${user.id}-records`, kind: 'items', owner: user.id, collection: 'records' })
      add({ store: `collection-${user.id}-books`, kind: 'items', owner: user.id, collection: 'books' })
    }
  }
  return units
}

// --- Per-kind backfill (dryRun skips the DB write but still counts) ---

async function backfillUsers({ db, blob, dryRun }) {
  const ids = (await blob.read(IDENTITY, USERS_INDEX)) || []
  let count = 0
  for (const id of ids) {
    const row = userRowForDb(await blob.read(IDENTITY, `${USER_PREFIX}${id}`))
    if (!row || row.role === 'admin' || row.id === OWNER_ID) continue
    count += 1
    if (!dryRun) {
      await db.query(INSERT_USER_SQL, [row.id, row.name, row.email, row.code_hash, row.role, row.status, row.plan, row.features, row.collections, row.created_at])
    }
  }
  return count
}

async function backfillRequests({ db, blob, dryRun }) {
  const ids = (await blob.read(IDENTITY, REQUESTS_INDEX)) || []
  let count = 0
  for (const id of ids) {
    const request = await blob.read(IDENTITY, `${REQUEST_PREFIX}${id}`)
    if (!request) continue
    const v = requestRowValues(request)
    count += 1
    if (!dryRun) {
      await db.query(INSERT_REQUEST_SQL, [v.id, v.name, v.email, v.status, v.data, v.created_at, v.approved_at, v.rejected_at])
    }
  }
  return count
}

async function backfillItems({ db, blob, unit, dryRun }) {
  const ids = (await blob.read(unit.store, ITEM_INDEX)) || []
  let count = 0
  for (const id of ids) {
    const item = await blob.read(unit.store, `${ITEM_PREFIX}${id}`)
    if (!item) continue
    const v = itemRowValues(item)
    count += 1
    if (!dryRun) {
      await db.query(INSERT_ITEM_SQL, [v.id, unit.owner, unit.collection, v.title, v.year, v.label, v.genre, v.style, v.country, v.format_type, v.barcode, v.discogs_id, v.google_books_id, v.cover_image, v.data, v.date_added, v.wishlist, v.lending, v.lending_history, v.page_count, v.notes])
    }
  }
  return count
}

async function backfillLookup({ db, blob, unit, now, dryRun }) {
  let keys = []
  try {
    keys = (await blob.listKeys(unit.store)) || []
  } catch {
    keys = []
  }
  let count = 0
  for (const key of keys) {
    const row = lookupCacheRow(unit.provider, key, await blob.read(unit.store, key), now)
    if (!row) continue
    count += 1
    if (!dryRun) {
      await db.query(INSERT_LOOKUP_SQL, [row.provider, row.key, JSON.stringify(row.data), row.expires_at])
    }
  }
  return count
}

// --- Orchestrator ---

// `db` is a node-postgres-shaped db ({ query }); `blob` is the injected reader
// ({ read(store, key), listKeys(store) }). Returns a report of per-unit counts
// and totals. Never writes when `dryRun` is true.
export async function runBackfill({ db, blob, now = Date.now(), onlyStore = null, dryRun = false }) {
  const units = await enumerateUnits(blob, onlyStore)
  const totals = { users: 0, requests: 0, items: 0, lookup: 0 }
  const reportUnits = []

  for (const unit of units) {
    let count = 0
    if (unit.kind === 'users') count = await backfillUsers({ db, blob, dryRun })
    else if (unit.kind === 'requests') count = await backfillRequests({ db, blob, dryRun })
    else if (unit.kind === 'items') count = await backfillItems({ db, blob, unit, dryRun })
    else if (unit.kind === 'lookup') count = await backfillLookup({ db, blob, unit, now, dryRun })
    totals[unit.kind] += count
    reportUnits.push({
      store: unit.store,
      kind: unit.kind,
      ...(unit.owner ? { owner: unit.owner, collection: unit.collection } : {}),
      ...(unit.provider ? { provider: unit.provider } : {}),
      count,
    })
  }

  return { dryRun, onlyStore, units: reportUnits, totals }
}
