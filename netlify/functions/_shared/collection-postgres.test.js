// @vitest-environment node
//
// Handler-level tests for the Postgres collection path
// (netlify/functions/_shared/collection-postgres.js): the same API contract as
// the Blobs handler, driven with a pg-mem-backed repository (injected via the
// repository mock) + a mocked @netlify/blobs store for the reversible mirror
// and the demo seed. Covers DB-first reads with Blobs read-through, the SQL
// plan-limit count, transactional writes, per-owner isolation, and demo reads.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePostgres } from './collection-postgres'
import { createPostgresRepository } from './repositories/postgres-repository'
import { createMemDb } from './repositories/test-helpers'

// In-memory @netlify/blobs so the reversible Blob mirrors + demo seed work.
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

// Inject a pg-mem-backed Postgres repository into the handler.
const { repoRef } = vi.hoisted(() => ({ repoRef: { current: null } }))
vi.mock('./repository', () => ({ getRepository: () => repoRef.current }))

const MEMBER = {
  id: 'u1',
  role: 'member',
  status: 'active',
  collections: { records: true, books: true },
  features: {},
  plan: 'free',
}
const OWNER = {
  id: 'owner',
  role: 'admin',
  status: 'active',
  collections: { records: true, books: true },
  features: { lending: true },
}
const DEMO = { id: 'demo', role: 'demo', status: 'active', collections: { records: true, books: true }, features: {} }

function req(method, path = '', body) {
  return {
    method,
    url: `http://localhost/.netlify/functions/collection${path}`,
    headers: { get: () => null },
    json: async () => body,
  }
}

async function call(method, path, body, user = MEMBER) {
  const r = req(method, path, body)
  const url = new URL(r.url)
  return handlePostgres(r, {
    user,
    collection: url.searchParams.get('collection') || 'records',
    id: url.searchParams.get('id'),
    url,
  })
}

const item = (n) => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  title: `Title ${n}`,
  year: 2000 + n,
  dateAdded: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
})

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createPostgresRepository({ db })
  repoRef.current = repo
  for (const key of Object.keys(stores)) delete stores[key]
})

describe('POST — create (transactional, SQL plan-limit count)', () => {
  it('creates an item and mirrors it to the Blobs store (reversible)', async () => {
    const res = await call('POST', '?collection=records', { title: 'New - Record', year: 2020 })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('New - Record')
    expect(body.id).toBeTruthy()
    expect(body.dateAdded).toBeTruthy()

    // Persisted in Postgres…
    const listed = await repo.items.listItems(MEMBER.id, 'records')
    expect(listed).toHaveLength(1)
    expect(listed[0].title).toBe('New - Record')
    // …and mirrored into the member's Blob store.
    const store = stores[`collection-${MEMBER.id}-records`]
    expect(store.data.get(`item:${body.id}`)).toMatchObject({ title: 'New - Record' })
  })

  it('403s with PLAN_LIMIT once the SQL owned count hits the free cap', async () => {
    for (let i = 1; i <= 10; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))

    const res = await call('POST', '?collection=records', { title: 'Over - The Limit' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PLAN_LIMIT')
    expect(body.error).toContain('free plan limit of 10')
    // Nothing was written (the check + insert share a transaction).
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(10)
  })

  it('never caps the owner (planLimitFor returns null)', async () => {
    const res = await call('POST', '?collection=records', { title: 'Owner - Add' }, OWNER)
    expect(res.status).toBe(201)
  })

  it('wishlist wants never increment the owned count (parity with the Blob path)', async () => {
    // 9 owned items — a wishlist add is under the cap and leaves the count at 9.
    for (let i = 1; i <= 9; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))
    const res = await call('POST', '?collection=records', { title: 'Wish - List', wishlist: true })
    expect(res.status).toBe(201)
    expect(await repo.items.countOwned(MEMBER.id, 'records')).toBe(9)

    // At the cap (10 owned) the add is blocked — the cap check matches the
    // Blob path, which 403s once owned items hit the limit regardless of the
    // incoming item's wishlist flag.
    await repo.items.insertItem(MEMBER.id, 'records', item(10))
    const blocked = await call('POST', '?collection=records', { title: 'Wish - Two', wishlist: true })
    expect(blocked.status).toBe(403)
    expect((await blocked.json()).code).toBe('PLAN_LIMIT')
  })
})

describe('M2 — backfill-aware plan limit (un-backfilled member stores)', () => {
  // Seed a member's Blobs store with `count` owned items — legacy items that
  // predate the backfill, so Postgres has NO rows for this owner+kind and the
  // SQL owned count would read 0 (the M2 gap the guard closes).
  function seedBlobsStore(count) {
    const store = createStore()
    stores[`collection-${MEMBER.id}-records`] = store
    const ids = []
    for (let i = 1; i <= count; i += 1) {
      const it = item(i)
      store.data.set(`item:${it.id}`, it)
      ids.push(it.id)
    }
    store.data.set('index', ids)
    store.data.set('count:owned', count)
    return store
  }

  it('enforces the 10-item cap for an un-backfilled store by counting owned in Blobs (403 PLAN_LIMIT at 10)', async () => {
    seedBlobsStore(10)
    const res = await call('POST', '?collection=records', { title: 'Over - The Limit' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PLAN_LIMIT')
    expect(body.error).toContain('free plan limit of 10')
    // Nothing was written to Postgres (the guard short-circuits before insert).
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })

  it('allows adds below the cap for an un-backfilled store (counted against Blobs)', async () => {
    seedBlobsStore(9)
    const res = await call('POST', '?collection=records', { title: 'Tenth - Allowed' })
    expect(res.status).toBe(201)
    const body = await res.json()
    // Persisted to Postgres (now partially backfilled) AND mirrored to Blobs.
    expect(await repo.items.countOwned(MEMBER.id, 'records')).toBe(1)
    expect(stores[`collection-${MEMBER.id}-records`].data.get(`item:${body.id}`)).toMatchObject({ title: 'Tenth - Allowed' })
  })

  it('does not cap a wishlist-only un-backfilled store (wishlist never counts toward the cap)', async () => {
    // No `count:owned` key — exercises ensureOwnedCount's lazy backfill, which
    // counts OWNED items only, so a wishlist-only store is not capped.
    const store = createStore()
    stores[`collection-${MEMBER.id}-records`] = store
    const ids = []
    for (let i = 1; i <= 10; i += 1) {
      const it = { ...item(i), wishlist: true }
      store.data.set(`item:${it.id}`, it)
      ids.push(it.id)
    }
    store.data.set('index', ids)
    const res = await call('POST', '?collection=records', { title: 'Wish - More' })
    expect(res.status).toBe(201)
  })

  it('uses the SQL owned count once the store is backfilled (SQL governs over a lower Blobs count)', async () => {
    // Backfilled store: 10 owned rows in Postgres.
    for (let i = 1; i <= 10; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))
    // The Blobs mirror is behind (only 5) — but once backfilled, SQL governs.
    seedBlobsStore(5)
    const res = await call('POST', '?collection=records', { title: 'Over - The Limit' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_LIMIT')
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(10)
  })
})

describe('GET — DB-first read-through', () => {
  it('serves Postgres items newest-first', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    await repo.items.insertItem(MEMBER.id, 'records', item(2))
    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.map((i) => i.title)).toEqual(['Title 2', 'Title 1'])
  })

  it('falls back to Blobs when Postgres has no rows (not-yet-backfilled)', async () => {
    const store = createStore()
    stores[`collection-${MEMBER.id}-records`] = store
    store.data.set('index', ['blob-item'])
    store.data.set('item:blob-item', { id: 'blob-item', title: 'From Blobs', year: 1999 })

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([{ id: 'blob-item', title: 'From Blobs', year: 1999 }])
  })

  it('paginates with limit/offset', async () => {
    for (let i = 1; i <= 5; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))
    const res = await call('GET', '?collection=records&limit=2&offset=1')
    expect((await res.json()).items.map((i) => i.title)).toEqual(['Title 4', 'Title 3'])
  })

  it('keeps per-owner isolation', async () => {
    await repo.items.insertItem('other', 'records', item(1))
    await repo.items.insertItem(MEMBER.id, 'records', item(2))
    expect((await (await call('GET', '?collection=records')).json()).items.map((i) => i.title)).toEqual(['Title 2'])
  })
})

describe('GET — lazy self-healing read-through (Blobs drift)', () => {
  // Seed the member's Blobs store with `items` — Blobs is the legacy/mirror
  // source; Postgres may hold only a subset (a backfill snapshot that missed
  // wishlist wants added before/in between backfills).
  function seedBlobsStoreWith(items) {
    const store = createStore()
    stores[`collection-${MEMBER.id}-records`] = store
    for (const it of items) store.data.set(`item:${it.id}`, it)
    store.data.set('index', items.map((it) => it.id))
    return store
  }

  it('reconciles a Blobs-only wishlist item into Postgres and returns BOTH items', async () => {
    // Postgres has one owned row; Blobs holds that same row PLUS a wishlist
    // item that only exists in Blobs (never backfilled).
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    const wish = { ...item(2), wishlist: true }
    seedBlobsStoreWith([item(1), wish])

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    const body = await res.json()
    // Both items returned, Postgres order (date_added DESC).
    expect(body.items.map((i) => i.title)).toEqual(['Title 2', 'Title 1'])
    expect(body.items.find((i) => i.title === 'Title 2').wishlist).toBe(true)

    // The missing wishlist item was upserted into Postgres (self-healed).
    const stored = await repo.items.getItem(MEMBER.id, 'records', wish.id)
    expect(stored).toMatchObject({ id: wish.id, title: 'Title 2', wishlist: true })
  })

  it('leaves the response unchanged when Postgres and Blobs agree (no drift, no upsert)', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    seedBlobsStoreWith([item(1)])
    const spy = vi.spyOn(repo.items, 'insertItem')

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i) => i.title)).toEqual(['Title 1'])
    // No drift detected — no reconcile writes.
    expect(spy).not.toHaveBeenCalled()
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(1)
  })

  it('falls back to Blobs when Postgres is empty (no reconcile into an un-backfilled store)', async () => {
    seedBlobsStoreWith([{ id: 'blob-item', title: 'From Blobs', year: 1999 }])
    const spy = vi.spyOn(repo.items, 'insertItem')

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([{ id: 'blob-item', title: 'From Blobs', year: 1999 }])
    // The Blobs fallback never writes to Postgres.
    expect(spy).not.toHaveBeenCalled()
    expect(await repo.items.listItems(MEMBER.id, 'records')).toEqual([])
  })
})

describe('PUT / DELETE', () => {
  it('updates an existing item (read-through get + transactional update)', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    const res = await call('PUT', '?collection=records&id=00000000-0000-0000-0000-000000000001', { notes: 'reissue' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notes).toBe('reissue')
    expect(body.title).toBe('Title 1') // merged, not replaced
  })

  it('403 FORBIDDEN on a missing item (non-enumerating, mirrors the blob PUT)', async () => {
    // SEC-7.1 (#338): object-by-id access on an item the caller doesn't own is
    // a uniform 403 FORBIDDEN (was 404).
    const res = await call('PUT', '?collection=records&id=00000000-0000-0000-0000-000000000099', { notes: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })

  it('deletes and removes from Postgres + Blobs mirror; a second delete is 403 FORBIDDEN (non-enumerating)', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    const store = createStore()
    stores[`collection-${MEMBER.id}-records`] = store
    store.data.set('index', [item(1).id])
    store.data.set(`item:${item(1).id}`, item(1))

    const res = await call('DELETE', '?collection=records&id=00000000-0000-0000-0000-000000000001')
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(await repo.items.listItems(MEMBER.id, 'records')).toEqual([])
    expect(store.data.has(`item:${item(1).id}`)).toBe(false)

    // SEC-7.1 (#338): deleting an already-gone item is now a uniform 403
    // FORBIDDEN (the old idempotent 200 was non-enumerating behavior).
    const res2 = await call('DELETE', '?collection=records&id=00000000-0000-0000-0000-000000000001')
    expect(res2.status).toBe(403)
  })

  it('400s on a missing id', async () => {
    expect((await call('PUT', '?collection=records')).status).toBe(400)
    expect((await call('DELETE', '?collection=records')).status).toBe(400)
  })
})

describe('S4 — convert-to-owned cap (#58)', () => {
  it('blocks a free member at the SQL cap from converting a wishlist item to owned (403 PLAN_LIMIT)', async () => {
    // 10 owned items + one wishlist item in Postgres (backfilled store).
    for (let i = 1; i <= 10; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))
    const wish = { ...item(99), wishlist: true }
    await repo.items.insertItem(MEMBER.id, 'records', wish)

    const res = await call('PUT', `?collection=records&id=${wish.id}`, { wishlist: false })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PLAN_LIMIT')
    expect(body.error).toContain('free plan limit of 10')
    // The wishlist item is untouched (the cap check + update share the transaction).
    const stored = await repo.items.getItem(MEMBER.id, 'records', wish.id)
    expect(stored.wishlist).toBe(true)
  })

  it('allows the conversion below the cap and raises the owned count', async () => {
    for (let i = 1; i <= 9; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))
    const wish = { ...item(99), wishlist: true }
    await repo.items.insertItem(MEMBER.id, 'records', wish)

    const res = await call('PUT', `?collection=records&id=${wish.id}`, { wishlist: false })
    expect(res.status).toBe(200)
    expect((await repo.items.getItem(MEMBER.id, 'records', wish.id)).wishlist).toBe(false)
    expect(await repo.items.countOwned(MEMBER.id, 'records')).toBe(10)
  })

  it('enforces the cap against the Blobs mirror for an un-backfilled store (M2)', async () => {
    // Postgres has NO rows for this member; 10 owned + 1 wishlist item live in
    // Blobs, so the SQL owned count reads 0 and the Blobs count governs.
    const store = createStore()
    stores[`collection-${MEMBER.id}-records`] = store
    const ids = []
    for (let i = 1; i <= 10; i += 1) {
      const it = item(i)
      store.data.set(`item:${it.id}`, it)
      ids.push(it.id)
    }
    const wish = { ...item(99), wishlist: true }
    store.data.set(`item:${wish.id}`, wish)
    ids.push(wish.id)
    store.data.set('index', ids)
    store.data.set('count:owned', 10)

    const res = await call('PUT', `?collection=records&id=${wish.id}`, { wishlist: false })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_LIMIT')
  })

  it('never blocks a paid plan (premium) from converting at/over the cap', async () => {
    for (let i = 1; i <= 20; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))
    const wish = { ...item(99), wishlist: true }
    await repo.items.insertItem(MEMBER.id, 'records', wish)

    const res = await call('PUT', `?collection=records&id=${wish.id}`, { wishlist: false }, { ...MEMBER, plan: 'premium' })
    expect(res.status).toBe(200)
    expect((await repo.items.getItem(MEMBER.id, 'records', wish.id)).wishlist).toBe(false)
  })

  it('never blocks the owner (admin) from converting', async () => {
    const wish = { ...item(98), wishlist: true }
    await repo.items.insertItem(OWNER.id, 'records', wish)

    const res = await call('PUT', `?collection=records&id=${wish.id}`, { wishlist: false }, OWNER)
    expect(res.status).toBe(200)
  })

  it('leaves owned → wishlist and notes-only edits uncapped', async () => {
    for (let i = 1; i <= 10; i += 1) await repo.items.insertItem(MEMBER.id, 'records', item(i))

    // notes-only edit at the cap is allowed.
    const res = await call('PUT', `?collection=records&id=${item(1).id}`, { notes: 'reissue' })
    expect(res.status).toBe(200)

    // owned -> wishlist drops the count and is never blocked.
    const res2 = await call('PUT', `?collection=records&id=${item(1).id}`, { wishlist: true })
    expect(res2.status).toBe(200)
    expect(await repo.items.countOwned(MEMBER.id, 'records')).toBe(9)
  })
})

describe('demo space stays on Blobs', () => {
  it('self-seeds and serves the curated demo items from Blobs', async () => {
    const res = await call('GET', '?collection=records', undefined, DEMO)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBeGreaterThan(0)
    // The demo store was seeded.
    expect(stores['collection-demo-records'].data.get('index')).toHaveLength(body.items.length)
  })
})

describe('method not allowed', () => {
  it('405s on an unsupported method', async () => {
    expect((await call('PATCH', '?collection=records')).status).toBe(405)
  })
})

describe('SEC-3.2 (#195) — payload-size cap + malformed JSON on the Postgres write path', () => {
  // A raw-body req (with `.text()`) so the REAL byte-cap path in readJsonBody
  // runs — the shared `req()` helper only exposes `.json()`.
  function rawReq(method, path, raw) {
    return {
      method,
      url: `http://localhost/.netlify/functions/collection${path}`,
      headers: { get: () => null },
      text: async () => raw,
      json: async () => JSON.parse(raw),
    }
  }

  it('413s PAYLOAD_TOO_LARGE on a POST body over the byte cap (nothing written)', async () => {
    const raw = JSON.stringify({ title: 'Big - Add', year: 2020, notes: 'x'.repeat(70 * 1024) })
    const r = rawReq('POST', '?collection=records', raw)
    const res = await handlePostgres(r, { user: MEMBER, collection: 'records', id: null, url: new URL(r.url) })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    // The oversized body never reached the DB.
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })

  it('413s PAYLOAD_TOO_LARGE on a PUT body over the byte cap (item untouched)', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    const raw = JSON.stringify({ notes: 'x'.repeat(70 * 1024) })
    const r = rawReq('PUT', `?collection=records&id=${item(1).id}`, raw)
    const res = await handlePostgres(r, { user: MEMBER, collection: 'records', id: item(1).id, url: new URL(r.url) })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    expect((await repo.items.getItem(MEMBER.id, 'records', item(1).id)).notes).toBeUndefined()
  })

  it('400s INVALID_JSON on a malformed POST body (never a 500)', async () => {
    const r = {
      method: 'POST',
      url: 'http://localhost/.netlify/functions/collection?collection=records',
      headers: { get: () => null },
      text: async () => '{not json',
      json: async () => { throw new SyntaxError('bad json') },
    }
    const res = await handlePostgres(r, { user: MEMBER, collection: 'records', id: null, url: new URL(r.url) })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_JSON')
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })
})

// (FEAT-EPIC-5, #276) Phase A enrichment — endpoint-level security-gate tests
// for the POSTGRES write path (handlePost/handlePut). Parity with the Blobs-path
// endpoint tests: a hostile enriched body → 400 with a code and NOTHING stored
// (SQL rows + Blobs mirror), a valid enriched body persists, and protected
// identity/privilege fields are still stripped alongside the new enrichment
// fields. The pure validator is covered in item-fields.test.js; these prove the
// Postgres HANDLER wires validateItem into its write path.
describe('Phase A enrichment — endpoint-level, Postgres write path (FEAT-EPIC-5 #276)', () => {
  const enrichedRecord = {
    title: 'The Artist - Album',
    artists: [
      { id: 123, name: 'The Artist', anv: 'T.A.', role: 'Main' },
      { id: 456, name: 'Guest' },
    ],
    masterId: 999,
    tracklist: [
      { position: 'A1', title: 'Song One', duration: '3:45' },
      { position: 'A2', title: 'Song Two' },
    ],
    released: '1987-05-15',
  }
  const enrichedBook = {
    title: 'Author - Book',
    authorsList: [{ name: 'Jane Doe', id: 'book-1' }, { name: 'John Roe' }],
    subtitle: 'A Subtitle',
    series: 'The Series',
    mainCategory: 'Fiction',
    snippet: 'A short blurb about the book.',
  }

  it('POST persists a well-formed enriched record to Postgres and the Blobs mirror', async () => {
    const res = await call('POST', '?collection=records', enrichedRecord)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.artists).toEqual(enrichedRecord.artists)
    expect(body.masterId).toBe(999)
    expect(body.released).toBe('1987-05-15')
    const stored = await repo.items.getItem(MEMBER.id, 'records', body.id)
    expect(stored.artists).toEqual(enrichedRecord.artists)
    expect(stored.tracklist).toHaveLength(2)
    expect(stored.masterId).toBe(999)
    expect(stored.released).toBe('1987-05-15')
    const mirror = stores[`collection-${MEMBER.id}-records`]
    expect(mirror.data.get(`item:${body.id}`).artists).toEqual(enrichedRecord.artists)
  })

  it('POST persists a well-formed enriched book to Postgres', async () => {
    const res = await call('POST', '?collection=books', enrichedBook)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.authorsList).toEqual(enrichedBook.authorsList)
    expect(body.subtitle).toBe('A Subtitle')
    const stored = await repo.items.getItem(MEMBER.id, 'books', body.id)
    expect(stored.authorsList[0]).toEqual({ name: 'Jane Doe', id: 'book-1' })
    expect(stored.series).toBe('The Series')
    expect(stored.mainCategory).toBe('Fiction')
    expect(stored.snippet).toBe('A short blurb about the book.')
  })

  it('PUT partially patches enriched fields onto an existing item (merged, not replaced)', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    const res = await call('PUT', `?collection=records&id=${item(1).id}`, {
      artists: enrichedRecord.artists,
      masterId: 999,
      tracklist: enrichedRecord.tracklist,
      released: '1987-05-15',
    })
    expect(res.status).toBe(200)
    const stored = await repo.items.getItem(MEMBER.id, 'records', item(1).id)
    expect(stored.artists).toHaveLength(2)
    expect(stored.masterId).toBe(999)
    expect(stored.released).toBe('1987-05-15')
    expect(stored.title).toBe(item(1).title) // merged, not replaced
  })

  it('POST rejects an oversized artists array (9) with 400 TOO_LONG and stores nothing', async () => {
    const res = await call('POST', '?collection=records', {
      title: 'A',
      artists: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `A${i}` })),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TOO_LONG')
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })

  it('POST rejects a deep/nested hostile object inside artists[] with 400 TYPE_ERROR and stores nothing', async () => {
    const res = await call('POST', '?collection=records', {
      title: 'A',
      artists: [{ id: 1, name: { nested: true } }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })

  it('POST rejects an unknown sub-key inside a tracklist entry with 400 UNKNOWN_FIELD and stores nothing', async () => {
    const res = await call('POST', '?collection=records', {
      title: 'A',
      tracklist: [{ position: 'A1', title: 'T', lyrics: 'x' }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('UNKNOWN_FIELD')
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })

  it('POST rejects a non-string snippet with 400 TYPE_ERROR and stores nothing', async () => {
    const res = await call('POST', '?collection=books', { title: 'B', snippet: ['x'] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(await repo.items.listItems(MEMBER.id, 'books')).toHaveLength(0)
  })

  it('POST rejects a type-mismatch masterId ("x") with 400 TYPE_ERROR and stores nothing', async () => {
    const res = await call('POST', '?collection=records', { title: 'A', masterId: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(await repo.items.listItems(MEMBER.id, 'records')).toHaveLength(0)
  })

  it('PUT rejects a hostile enriched patch and leaves the existing item untouched', async () => {
    await repo.items.insertItem(MEMBER.id, 'records', item(1))
    const res = await call('PUT', `?collection=records&id=${item(1).id}`, {
      artists: [{ id: 1, name: 'X', role: { deep: true } }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    const stored = await repo.items.getItem(MEMBER.id, 'records', item(1).id)
    expect(stored.artists).toBeUndefined()
  })

  it('persists the new enrichment fields while STILL stripping protected identity/privilege fields', async () => {
    const res = await call('POST', '?collection=records', {
      ...enrichedRecord,
      ownerId: 'attacker',
      role: 'admin',
      code: 'RU-SECRET',
      email: 'attacker@example.com',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.artists).toEqual(enrichedRecord.artists)
    const stored = await repo.items.getItem(MEMBER.id, 'records', body.id)
    expect(stored.artists).toEqual(enrichedRecord.artists)
    expect(stored.masterId).toBe(999)
    expect(stored.ownerId).toBeUndefined()
    expect(stored.role).toBeUndefined()
    expect(stored.code).toBeUndefined()
    expect(stored.email).toBeUndefined()
  })
})
