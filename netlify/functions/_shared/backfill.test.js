// @vitest-environment node
//
// Backfill tests (netlify/functions/_shared/backfill.js) for Part B. Covers
// the pure helpers (TTL mapping, cache-row shaping, hashing a user, member-store
// parsing) and the orchestrator against pg-mem with an in-memory Blob reader:
//   - a full run populates users / requests / items / lookup_cache,
//   - codes are stored ONLY as code_hash (never plaintext),
//   - re-runs are idempotent (upserts, same counts),
//   - --dry-run reports the same counts WITHOUT writing,
//   - per-store backfill touches only that store,
//   - lookup TTLs are preserved and stale/unknown cache entries are skipped.
// The Blobs reading part is thin (injected `blob` reader) — the pure logic is
// what's tested here.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DAY_MS,
  enumerateUnits,
  lookupCacheRow,
  lookupTtlFor,
  parseMemberStore,
  runBackfill,
  userRowForDb,
} from './backfill'
import { createMemDb } from './repositories/test-helpers'
import { codeHashFor } from './repositories/users-repo'

// --- In-memory Blob reader (the thin, injected part) ---
function memBlob(initial = {}) {
  const data = {}
  for (const [store, entries] of Object.entries(initial)) {
    data[store] = new Map(Object.entries(entries))
  }
  return {
    data,
    async read(storeName, key) {
      const value = data[storeName]?.get(String(key))
      return value === undefined ? null : JSON.parse(JSON.stringify(value))
    },
    async listKeys(storeName) {
      return [...(data[storeName]?.keys() ?? [])].map(String)
    },
  }
}

const UUID = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  collections: { records: true, books: true },
  features: {},
  plan: 'free',
  role: 'member',
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
}

const REQUEST = {
  id: 'r1',
  name: 'Ada',
  email: 'ada@example.com',
  status: 'approved',
  createdAt: '2026-08-01T09:00:00.000Z',
  approvedAt: '2026-08-01T10:00:00.000Z',
}

const OWNER_ITEM = { id: UUID(1), title: 'Owner - Record', year: 1975, dateAdded: '2026-01-01T00:00:00.000Z' }
const MEMBER_ITEM = { id: UUID(2), title: 'Member - Book', year: 1999, dateAdded: '2026-02-02T00:00:00.000Z', wishlist: true }

function fullBlobData() {
  return {
    'runout-identity': {
      'index:users': ['u1'],
      'user:u1': MEMBER,
      'index:requests': ['r1'],
      'request:r1': REQUEST,
    },
    'runout-collection': {
      index: [OWNER_ITEM.id],
      [`item:${OWNER_ITEM.id}`]: OWNER_ITEM,
    },
    'runout-library': { index: [] },
    'collection-u1-records': { index: [] },
    'collection-u1-books': {
      index: [MEMBER_ITEM.id],
      [`item:${MEMBER_ITEM.id}`]: MEMBER_ITEM,
    },
    'discogs-cache': {
      'barcode:123': { ts: Date.now() - 1000, data: { results: [{ id: 1 }] } },
      'q:abc': { ts: Date.now() - 1000, data: { results: [] } },
      'barcode:stale': { ts: Date.now() - 40 * DAY_MS, data: { results: [] } }, // stale — skipped
      'unknown:x': { ts: Date.now() - 1000, data: {} }, // unknown prefix — skipped
    },
    'books-cache': {
      'isbn:978': { ts: Date.now() - 1000, data: { items: [] } },
    },
  }
}

let db

beforeEach(async () => {
  db = await createMemDb()
})

// --- Pure helpers ---

describe('lookupTtlFor — preserves the exact provider TTLs', () => {
  it('maps discogs/books prefixes to 30d / 1d and unknown prefixes to null', () => {
    expect(lookupTtlFor('discogs', 'barcode:123')).toBe(30 * DAY_MS)
    expect(lookupTtlFor('discogs', 'release:5')).toBe(30 * DAY_MS)
    expect(lookupTtlFor('discogs', 'q:hello')).toBe(DAY_MS)
    expect(lookupTtlFor('books', 'isbn:978')).toBe(30 * DAY_MS)
    expect(lookupTtlFor('books', 'detail:xyz')).toBe(30 * DAY_MS)
    expect(lookupTtlFor('books', 'q:hello')).toBe(DAY_MS)
    expect(lookupTtlFor('discogs', 'unknown:x')).toBeNull()
    expect(lookupTtlFor('nope', 'barcode:1')).toBeNull()
  })
})

describe('lookupCacheRow — shapes a { ts, data } entry into a row', () => {
  const now = Date.now()
  it('keeps a fresh entry with expires_at = ts + ttl', () => {
    const row = lookupCacheRow('discogs', 'barcode:1', { ts: now - 5000, data: { ok: true } }, now)
    expect(row).toMatchObject({ provider: 'discogs', key: 'barcode:1', data: { ok: true } })
    expect(row.expires_at.getTime()).toBe(now - 5000 + 30 * DAY_MS)
  })

  it('skips stale entries and unknown prefixes', () => {
    expect(lookupCacheRow('discogs', 'barcode:stale', { ts: now - 40 * DAY_MS, data: {} }, now)).toBeNull()
    expect(lookupCacheRow('discogs', 'unknown:x', { ts: now, data: {} }, now)).toBeNull()
  })

  it('returns null for malformed entries', () => {
    expect(lookupCacheRow('discogs', 'barcode:1', null, now)).toBeNull()
    expect(lookupCacheRow('discogs', 'barcode:1', {}, now)).toBeNull()
    expect(lookupCacheRow('discogs', 'barcode:1', { ts: now }, now)).toBeNull()
  })
})

describe('userRowForDb — hashes the code, never stores plaintext', () => {
  it('drops `code`, stores code_hash, and normalizes defaults', () => {
    const row = userRowForDb({ ...MEMBER, code: ' ru-aaaa-bbbb-cccc ' })
    expect(row).not.toHaveProperty('code')
    expect(row.code_hash).toBe(codeHashFor('RU-AAAA-BBBB-CCCC'))
    expect(row.role).toBe('member')
    expect(row.plan).toBe('free')
    expect(row.collections).toBe(JSON.stringify(MEMBER.collections))
  })

  it('returns null without an id', () => {
    expect(userRowForDb({ name: 'No id' })).toBeNull()
    expect(userRowForDb(null)).toBeNull()
  })
})

describe('parseMemberStore — collection-<userId>-<kind>', () => {
  it('parses member stores (uuid userIds may contain hyphens)', () => {
    expect(parseMemberStore('collection-u1-records')).toEqual({ owner: 'u1', collection: 'records' })
    expect(parseMemberStore('collection-abc-123-books')).toEqual({ owner: 'abc-123', collection: 'books' })
  })

  it('rejects non-member stores', () => {
    expect(parseMemberStore('runout-collection')).toBeNull()
    expect(parseMemberStore('collection-x-vinyl')).toBeNull() // unknown kind
    expect(parseMemberStore(null)).toBeNull()
  })
})

// --- Orchestrator (pg-mem + in-memory Blobs) ---

describe('runBackfill — full run', () => {
  it('populates users, requests, items, and lookup_cache; codes are hashed', async () => {
    const report = await runBackfill({ db, blob: memBlob(fullBlobData()) })
    expect(report.totals).toEqual({ users: 1, requests: 1, items: 2, lookup: 3 })

    // Users: 1 member, stored with code_hash and NO plaintext code.
    const users = await db.query('SELECT id, name, code_hash FROM users')
    expect(users.rows).toHaveLength(1)
    expect(users.rows[0]).toMatchObject({ id: 'u1', name: 'Ada' })
    expect(users.rows[0].code_hash).toBe(codeHashFor(MEMBER.code))

    // Requests round-trip through the data jsonb.
    const requests = await db.query('SELECT id, data FROM requests')
    expect(requests.rows).toHaveLength(1)
    expect(requests.rows[0].data).toMatchObject({ id: 'r1', status: 'approved', approvedAt: REQUEST.approvedAt })

    // Items: owner store + member store, correct owner_id/kind.
    const items = await db.query('SELECT owner_id, kind, title FROM items ORDER BY title')
    const titles = items.rows.map((r) => r.title)
    expect(titles).toContain('Owner - Record')
    expect(titles).toContain('Member - Book')
    expect(items.rows.find((r) => r.title === 'Owner - Record')).toMatchObject({ owner_id: 'owner', kind: 'records' })
    expect(items.rows.find((r) => r.title === 'Member - Book')).toMatchObject({ owner_id: 'u1', kind: 'books' })

    // lookup_cache: 2 discogs (barcode fresh + q fresh) + 1 books isbn; the
    // stale + unknown-prefix entries were skipped.
    const lookup = await db.query('SELECT provider, key FROM lookup_cache ORDER BY provider, key')
    expect(lookup.rows.map((r) => `${r.provider}:${r.key}`)).toEqual([
      'books:isbn:978',
      'discogs:barcode:123',
      'discogs:q:abc',
    ])
  })

  it('is idempotent — a second run writes the same rows (upserts)', async () => {
    const blob = memBlob(fullBlobData())
    const first = await runBackfill({ db, blob })
    const second = await runBackfill({ db, blob })
    expect(second.totals).toEqual(first.totals)

    const users = await db.query('SELECT count(*)::int AS c FROM users')
    const items = await db.query('SELECT count(*)::int AS c FROM items')
    const lookup = await db.query('SELECT count(*)::int AS c FROM lookup_cache')
    expect([users.rows[0].c, items.rows[0].c, lookup.rows[0].c]).toEqual([1, 2, 3])
  })

  it('dry-run reports the same counts but writes nothing', async () => {
    const report = await runBackfill({ db, blob: memBlob(fullBlobData()), dryRun: true })
    expect(report.dryRun).toBe(true)
    expect(report.totals).toEqual({ users: 1, requests: 1, items: 2, lookup: 3 })

    for (const table of ['users', 'requests', 'items', 'lookup_cache']) {
      const { rows } = await db.query(`SELECT count(*)::int AS c FROM ${table}`)
      expect(rows[0].c).toBe(0)
    }
  })

  it('backfills a single store when onlyStore is set (staged cutover)', async () => {
    const blob = memBlob(fullBlobData())
    const report = await runBackfill({ db, blob, onlyStore: 'runout-collection' })
    expect(report.units).toHaveLength(1)
    expect(report.units[0]).toMatchObject({ store: 'runout-collection', kind: 'items', count: 1 })
    expect(report.totals).toEqual({ users: 0, requests: 0, items: 1, lookup: 0 })

    // Only the owner/records store landed.
    const items = await db.query('SELECT owner_id, kind FROM items')
    expect(items.rows).toEqual([{ owner_id: 'owner', kind: 'records' }])
    const users = await db.query('SELECT count(*)::int AS c FROM users')
    expect(users.rows[0].c).toBe(0)
  })

  it('derives member stores from the identity users', async () => {
    const blob = memBlob(fullBlobData())
    const units = await enumerateUnits(blob)
    const stores = units.map((u) => u.store)
    expect(stores).toContain('collection-u1-records')
    expect(stores).toContain('collection-u1-books')
    expect(stores).toContain('runout-collection')
    expect(stores).toContain('runout-library')
    expect(stores).toContain('discogs-cache')
    expect(stores).toContain('books-cache')
    expect(stores).toContain('runout-identity')
  })
})
