// @vitest-environment node
//
// Tests for the shared read-through lookup cache (netlify/functions/_shared/
// lookup-cache.js) that discogs.js / books.js now use (Part B). Proves:
//   - DB-first reads from lookup_cache when Postgres is configured (provider
//     scoping + the real expires_at TTL),
//   - the legacy Blobs cache is the fallback on a miss / expired / DB-off,
//   - write-through lands in BOTH stores (best-effort),
//   - with DATABASE_URL unset it behaves exactly like the old Blobs-only path.
//
// @netlify/blobs is mocked in-memory; `./repository` is mocked to hand out a
// pg-mem-backed Postgres repository. Note: `writeCache` deliberately mirrors to
// BOTH stores, so the DB-first tests seed the DB directly with
// `repo.lookupCache.set` (no Blob mirror) to isolate DB behavior.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCache, writeCache, EMPTY_SENTINEL, emptyCacheTtlMs, writeEmptyCache, isNegativeCached } from './lookup-cache'
import { createPostgresRepository } from './repositories/postgres-repository'
import { createMemDb } from './repositories/test-helpers'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key) {
        const value = this.data.get(String(key))
        return value === undefined ? null : JSON.parse(JSON.stringify(value))
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({
  getStore: (name) => {
    if (!stores[name]) stores[name] = createStore()
    return stores[name]
  },
}))

const { repoRef } = vi.hoisted(() => ({ repoRef: { current: null } }))
vi.mock('./repository', () => ({ getRepository: () => repoRef.current }))

const DAY = 24 * 60 * 60 * 1000
const originalUrl = process.env.DATABASE_URL

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createPostgresRepository({ db })
  repoRef.current = repo
  for (const key of Object.keys(stores)) delete stores[key]
})

afterEach(() => {
  process.env.DATABASE_URL = originalUrl
})

function withPostgres() {
  process.env.DATABASE_URL = 'postgres://localhost:5432/runout'
}

// Seed the DB lookup_cache directly (no Blob mirror) to isolate DB behavior.
function seedDb(provider, key, data, ttlMs) {
  return repo.lookupCache.set(provider, key, data, new Date(Date.now() + ttlMs))
}

describe('readCache — DB first when Postgres is configured', () => {
  it('serves from lookup_cache (provider-scoped) without touching the Blob store', async () => {
    withPostgres()
    await seedDb('discogs', 'barcode:1', { ok: true }, 30 * DAY)
    await seedDb('books', 'isbn:2', { ok: 'book' }, 30 * DAY)

    // No Blob store was created — the data must come from Postgres.
    expect(stores['discogs-cache']).toBeUndefined()
    expect(await readCache('discogs', 'barcode:1', 30 * DAY)).toEqual({ ok: true })
    expect(await readCache('books', 'isbn:2', 30 * DAY)).toEqual({ ok: 'book' })
    // Providers don't leak into each other.
    expect(await readCache('books', 'barcode:1', 30 * DAY)).toBeNull()
  })

  it('enforces the real expires_at TTL — an expired DB row is a miss (no Blob fallback data)', async () => {
    withPostgres()
    await seedDb('discogs', 'release:5', { old: true }, 30 * DAY)
    // Age it past expiry directly in the DB (Date param — pg-mem safe).
    await db.query('UPDATE lookup_cache SET expires_at = $1 WHERE provider = $2 AND key = $3', [new Date(Date.now() - DAY), 'discogs', 'release:5'])
    expect(await readCache('discogs', 'release:5', 30 * DAY)).toBeNull()
  })

  it('falls back to the legacy Blobs cache on a DB miss (read-through)', async () => {
    withPostgres()
    const blobStore = createStore()
    stores['discogs-cache'] = blobStore
    // Blob entries are stored as objects; the mock's get() deep-clones them.
    blobStore.data.set('barcode:1', { ts: Date.now(), data: { from: 'blobs' } })
    // Nothing in the DB yet — the Blobs cache answers.
    expect(await readCache('discogs', 'barcode:1', 30 * DAY)).toEqual({ from: 'blobs' })
  })

  it('treats a stale Blobs entry as a miss too', async () => {
    withPostgres()
    const blobStore = createStore()
    stores['books-cache'] = blobStore
    blobStore.data.set('isbn:9', { ts: Date.now() - 40 * DAY, data: { stale: true } })
    expect(await readCache('books', 'isbn:9', 30 * DAY)).toBeNull()
  })
})

describe('writeCache — write-through to both stores', () => {
  it('lands in lookup_cache with expires_at = now + ttl AND in the Blob store', async () => {
    withPostgres()
    await writeCache('discogs', 'q:abc', { results: [] }, DAY)

    const { rows } = await db.query('SELECT data, expires_at FROM lookup_cache WHERE provider = $1 AND key = $2', ['discogs', 'q:abc'])
    expect(rows[0].data).toEqual({ results: [] })
    const remaining = new Date(rows[0].expires_at).getTime() - Date.now()
    expect(remaining).toBeGreaterThan(DAY - 60_000)
    expect(remaining).toBeLessThanOrEqual(DAY)

    // The legacy Blob mirror holds the { ts, data } shape for the fallback.
    const blob = stores['discogs-cache'].data.get('q:abc')
    expect(blob.data).toEqual({ results: [] })
    expect(blob.ts).toBeTruthy()
  })
})

describe('readCache — Blobs-only when Postgres is NOT configured', () => {
  it('behaves exactly like the pre-Phase-1 Blob cache', async () => {
    delete process.env.DATABASE_URL
    const blobStore = createStore()
    stores['discogs-cache'] = blobStore
    blobStore.data.set('release:7', { ts: Date.now(), data: { from: 'blobs' } })
    blobStore.data.set('release:8', { ts: Date.now() - 40 * DAY, data: { stale: true } })

    expect(await readCache('discogs', 'release:7', 30 * DAY)).toEqual({ from: 'blobs' })
    expect(await readCache('discogs', 'release:8', 30 * DAY)).toBeNull()
    expect(await readCache('discogs', 'missing', 30 * DAY)).toBeNull()
  })
})

// RES-1.4 T4 (#291) — negative caching: a HEALTHY-EMPTY provider result is
// cached under (provider, key) as the { empty:true } sentinel with a SHORTER
// TTL than the positive cache so a "no match today" is both re-usable (skip the
// empty provider call) and quickly re-checkable (it churns as data is added).
describe('negative caching — emptyCacheTtlMs / EMPTY_SENTINEL / writeEmptyCache / isNegativeCached', () => {
  it('EMPTY_SENTINEL is a frozen { empty:true } object that cannot collide with a results/items envelope', () => {
    expect(EMPTY_SENTINEL).toEqual({ empty: true })
    expect(Object.isFrozen(EMPTY_SENTINEL)).toBe(true)
    // A real Discogs {results} or Google {items} envelope never has empty:true.
    expect(EMPTY_SENTINEL.results).toBeUndefined()
    expect(EMPTY_SENTINEL.items).toBeUndefined()
  })

  it('emptyCacheTtlMs: barcode/ISBN 1 day, text q 6 hours', () => {
    const HOUR = 60 * 60 * 1000
    expect(emptyCacheTtlMs('searchBarcode')).toBe(24 * HOUR)
    expect(emptyCacheTtlMs('barcode')).toBe(24 * HOUR)
    expect(emptyCacheTtlMs('isbn')).toBe(24 * HOUR)
    expect(emptyCacheTtlMs('searchText')).toBe(6 * HOUR)
    expect(emptyCacheTtlMs('q')).toBe(6 * HOUR)
  })

  it('writeEmptyCache writes the sentinel to lookup_cache with the empty TTL (DB) AND the Blob mirror', async () => {
    withPostgres()
    await writeEmptyCache('discogs', 'barcode:1', 'searchBarcode')

    const { rows } = await db.query('SELECT data, expires_at FROM lookup_cache WHERE provider = $1 AND key = $2', ['discogs', 'barcode:1'])
    expect(rows[0].data).toEqual({ empty: true })
    // The empty TTL is 1 day for barcode (not the 30d positive TTL).
    const remaining = new Date(rows[0].expires_at).getTime() - Date.now()
    expect(remaining).toBeGreaterThan(emptyCacheTtlMs('searchBarcode') - 60_000)
    expect(remaining).toBeLessThanOrEqual(emptyCacheTtlMs('searchBarcode'))
    expect(remaining).toBeLessThan(30 * DAY)

    // The legacy Blob mirror holds the same { ts, data } shape for the fallback.
    const blob = stores['discogs-cache'].data.get('barcode:1')
    expect(blob.data).toEqual({ empty: true })
  })

  it('writeEmptyCache uses the 6h TTL for a text q key', async () => {
    withPostgres()
    await writeEmptyCache('books', 'q:abc', 'searchText')
    const { rows } = await db.query('SELECT expires_at FROM lookup_cache WHERE provider = $1 AND key = $2', ['books', 'q:abc'])
    const remaining = new Date(rows[0].expires_at).getTime() - Date.now()
    expect(remaining).toBeGreaterThan(emptyCacheTtlMs('searchText') - 60_000)
    expect(remaining).toBeLessThanOrEqual(emptyCacheTtlMs('searchText'))
  })

  it('isNegativeCached is true for a sentinel and false for real payloads / misses', async () => {
    withPostgres()
    await writeEmptyCache('discogs', 'barcode:1', 'searchBarcode')
    await seedDb('discogs', 'barcode:2', { results: [{ id: 1 }] }, 30 * DAY)

    expect(await isNegativeCached('discogs', 'barcode:1', 'searchBarcode')).toBe(true)
    expect(await isNegativeCached('discogs', 'barcode:2', 'searchBarcode')).toBe(false)
    expect(await isNegativeCached('discogs', 'missing', 'searchBarcode')).toBe(false)
    // Providers stay scoped — the books sentinel is not a discogs sentinel.
    expect(await isNegativeCached('books', 'barcode:1', 'searchBarcode')).toBe(false)
  })

  it('isNegativeCached reads the Blob-only path when Postgres is NOT configured', async () => {
    delete process.env.DATABASE_URL
    await writeEmptyCache('discogs', 'isbn:5', 'isbn')
    expect(await isNegativeCached('discogs', 'isbn:5', 'isbn')).toBe(true)
    expect(await isNegativeCached('discogs', 'isbn:6', 'isbn')).toBe(false)
  })

  it('readCache returns the sentinel so callers can distinguish (used by the chain skip)', async () => {
    withPostgres()
    await writeEmptyCache('discogs', 'q:foo', 'searchText')
    const data = await readCache('discogs', 'q:foo', emptyCacheTtlMs('searchText'))
    expect(data).toEqual({ empty: true })
  })
})
