// @vitest-environment node
//
// Handler-level tests for netlify/functions/collection.js — the Phase-0
// hot-path behaviors (T2 pagination, T3 owned-count, T4 list cache, T5 rate
// limit) wired end-to-end through the real handler, with @netlify/blobs mocked
// as an in-memory map so no real store or network is touched. The pure helper
// units (pagination.js / counts.js / list-cache.js / rate-limit.js) are tested
// separately; these tests assert the HANDLER does the right thing with them.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../collection'
import { LIST_CACHE_KEY } from './list-cache'
import { RATE_LIMIT_WINDOW_MS, windowIndex } from './rate-limit'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'

// Hoisted so the @netlify/blobs mock (which must be registered before the
// module under test is imported) can share the in-memory store registry.
const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      // Records every key read so tests can assert what was / wasn't fetched.
      gets: [],
      // Key prefixes whose reads should throw (to exercise best-effort paths).
      failPrefixes: [],
      async get(key) {
        this.gets.push(String(key))
        for (const prefix of this.failPrefixes) {
          if (String(key).startsWith(prefix)) throw new Error(`store failure: ${key}`)
        }
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

const CODE = 'RU-AAAA-BBBB-CCCC'
const USER_ID = 'u1'

// Session tokens minted per-test (SEC-EPIC-1): the Bearer is now a
// server-managed session token, not the access code / admin key.
let MEMBER_TOKEN = ''
let ADMIN_TOKEN = ''
let DEMO_TOKEN = ''

function seedMember({ collections = { records: true, books: true }, plan = 'free' } = {}) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = {
    id: USER_ID,
    name: 'Ada',
    email: 'ada@example.com',
    code: CODE,
    collections,
    plan,
    role: 'member',
    status: 'active',
  }
  identity.data.set(`code:${CODE}`, USER_ID)
  identity.data.set(`user:${USER_ID}`, user)
  identity.data.set('index:users', [USER_ID])
  return user
}

function collectionStore(items = []) {
  const store = createStore()
  stores[`collection-${USER_ID}-records`] = store
  store.data.set('index', items.map((i) => i.id))
  for (const item of items) store.data.set(`item:${item.id}`, item)
  return store
}

function req(method, path = '', body, auth = `Bearer ${MEMBER_TOKEN}`) {
  return {
    method,
    url: `http://localhost/.netlify/functions/collection${path}`,
    headers: {
      get: (k) => (String(k).toLowerCase() === 'authorization' ? auth : null),
    },
    json: async () => body,
  }
}

function call(method, path = '', body, auth) {
  return handler(req(method, path, body, auth))
}

const items = (ids) => ids.map((id) => ({ id, title: `Title ${id}`, year: 2000 }))

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  // Mint fresh session tokens for the identities the tests use (SEC-EPIC-1).
  MEMBER_TOKEN = await sessionTokenFor({ userId: USER_ID, role: 'member' })
  ADMIN_TOKEN = await adminSessionToken()
  DEMO_TOKEN = await demoSessionToken()
})

describe('GET /collection pagination (T2)', () => {
  it('returns only the requested slice and fetches only those item blobs', async () => {
    seedMember()
    const store = collectionStore(items(['a', 'b', 'c', 'd', 'e', 'f']))

    const res = await call('GET', '?collection=records&limit=2&offset=1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.map((i) => i.id)).toEqual(['b', 'c'])
    // The index is read once; only the sliced item blobs are fetched.
    expect(store.gets.filter((k) => k.startsWith('item:'))).toEqual(['item:b', 'item:c'])
  })

  it('returns the whole collection by default so the current client is unchanged', async () => {
    seedMember()
    collectionStore(items(['a', 'b', 'c']))

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to the defaults on invalid limit/offset instead of erroring', async () => {
    seedMember()
    collectionStore(items(['a', 'b', 'c']))

    const res = await call('GET', '?collection=records&limit=abc&offset=-1')
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('caps an oversized limit at the max and slices from the offset', async () => {
    seedMember()
    collectionStore(items(Array.from({ length: 12 }, (_, i) => `r${i}`)))

    const res = await call('GET', '?collection=records&limit=999999&offset=10')
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i) => i.id)).toEqual(['r10', 'r11'])
  })

  it('serves an empty window when the offset is past the end', async () => {
    seedMember()
    collectionStore(items(['a', 'b']))

    const res = await call('GET', '?collection=records&limit=10&offset=20')
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })
})

describe('owned-count transitions (T3)', () => {
  it('increments the denormalized count on a non-wishlist POST', async () => {
    seedMember()
    const store = collectionStore([])
    store.data.set('count:owned', 2)

    const res = await call('POST', '?collection=records', { title: 'New - Record', year: 2020 })
    expect(res.status).toBe(201)
    expect(store.data.get('count:owned')).toBe(3)
  })

  it('does not increment the count for a wishlist add — wants never consume the cap', async () => {
    seedMember()
    const store = collectionStore([])
    store.data.set('count:owned', 2)

    const res = await call('POST', '?collection=records', { title: 'Wish - List', wishlist: true })
    expect(res.status).toBe(201)
    expect(store.data.get('count:owned')).toBe(2)
  })

  it('backfills the count from the (empty) index on a fresh store and keeps it correct', async () => {
    seedMember()
    const store = collectionStore([])
    // No count:owned key yet — the first capped POST must lazily create it.
    const res = await call('POST', '?collection=records', { title: 'First - Record' })
    expect(res.status).toBe(201)
    expect(store.data.get('count:owned')).toBe(1)
  })

  it('decrements on DELETE of an owned item but not a wishlist item', async () => {
    seedMember()
    const store = collectionStore([
      { id: 'w1', title: 'Wish', wishlist: true },
      { id: 'r1', title: 'Owned', wishlist: false },
    ])
    store.data.set('count:owned', 5)

    let res = await call('DELETE', '?collection=records&id=w1')
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(5) // wishlist delete doesn't decrement

    res = await call('DELETE', '?collection=records&id=r1')
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(4)
  })

  it('is idempotent on DELETE of a missing item and leaves the count untouched', async () => {
    seedMember()
    const store = collectionStore([])
    store.data.set('count:owned', 3)

    const res = await call('DELETE', '?collection=records&id=ghost')
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(store.data.get('count:owned')).toBe(3)
  })

  it('adjusts the count on a wishlist↔owned toggle via PUT', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'X', wishlist: false }])
    store.data.set('count:owned', 3)

    // owned -> wishlist drops the count
    let res = await call('PUT', '?collection=records&id=r1', { wishlist: true })
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(2)

    // wishlist -> owned raises it back
    res = await call('PUT', '?collection=records&id=r1', { wishlist: false })
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(3)
  })

  it('leaves the count untouched on a notes-only PUT', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'X', wishlist: false }])
    store.data.set('count:owned', 3)

    const res = await call('PUT', '?collection=records&id=r1', { notes: 'my notes' })
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(3)
  })

  it('403s with PLAN_LIMIT at the free-plan cap and leaves the count unchanged', async () => {
    seedMember()
    const store = collectionStore([])
    store.data.set('count:owned', 10) // free plan limit

    const res = await call('POST', '?collection=records', { title: 'Over - The Limit' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PLAN_LIMIT')
    expect(body.error).toContain('free plan limit of 10')
    expect(store.data.get('count:owned')).toBe(10)
  })

  it('lazily backfills the owned count from the index on the first capped POST', async () => {
    seedMember()
    // A pre-Phase-0 store: 10 owned items, NO count:owned key.
    const store = collectionStore(items(Array.from({ length: 10 }, (_, i) => `r${i}`)))
    expect(store.data.has('count:owned')).toBe(false)

    const res = await call('POST', '?collection=records', { title: 'Another - Record' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_LIMIT')
    // The backfill ran from the index and persisted the count.
    expect(store.data.get('count:owned')).toBe(10)
  })

  it('never caps the owner (admin key) and skips creating a count key that never existed', async () => {
    const store = createStore()
    stores['runout-collection'] = store // owner's legacy store
    store.data.set('index', [])

    const res = await call(
      'POST',
      '?collection=records',
      { title: 'Owner - Add', wishlist: false },
      `Bearer ${ADMIN_TOKEN}`,
    )
    expect(res.status).toBe(201)
    // Uncapped owner: the count is not denormalized on a store that never had one.
    expect(store.data.has('count:owned')).toBe(false)
  })

  it('still maintains an existing owned count for the owner store', async () => {
    const store = createStore()
    stores['runout-collection'] = store
    store.data.set('index', [])
    store.data.set('count:owned', 999)

    const res = await call('POST', '?collection=records', { title: 'Owner - Add' }, `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(201)
    expect(store.data.get('count:owned')).toBe(1000)
  })
})

describe('convert-to-owned cap (S4 / #58)', () => {
  it('blocks a free member at the cap from converting a wishlist item to owned (403 PLAN_LIMIT)', async () => {
    seedMember({ plan: 'free' })
    const store = collectionStore([{ id: 'w1', title: 'Wish - List', wishlist: true }])
    store.data.set('count:owned', 10) // free plan limit

    const res = await call('PUT', '?collection=records&id=w1', { wishlist: false })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PLAN_LIMIT')
    expect(body.error).toContain('free plan limit of 10')
    // Nothing changed: the item stays a wishlist item, the count is untouched.
    expect(store.data.get('item:w1').wishlist).toBe(true)
    expect(store.data.get('count:owned')).toBe(10)
  })

  it('allows the conversion below the cap and raises the owned count', async () => {
    seedMember({ plan: 'free' })
    const store = collectionStore([{ id: 'w1', title: 'Wish - List', wishlist: true }])
    store.data.set('count:owned', 9)

    const res = await call('PUT', '?collection=records&id=w1', { wishlist: false })
    expect(res.status).toBe(200)
    expect(store.data.get('item:w1').wishlist).toBe(false)
    expect(store.data.get('count:owned')).toBe(10)
  })

  it('lazily backfills the owned count from the index when the key is missing', async () => {
    seedMember({ plan: 'free' })
    // A pre-Phase-0 store: 10 owned items (no wishlist field = owned) + 1
    // wishlist item, and NO count:owned key yet.
    const owned = items(Array.from({ length: 10 }, (_, i) => `r${i}`))
    const store = collectionStore([...owned, { id: 'w1', title: 'Wish - List', wishlist: true }])

    const res = await call('PUT', '?collection=records&id=w1', { wishlist: false })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_LIMIT')
    // The backfill ran from the index and persisted the count.
    expect(store.data.get('count:owned')).toBe(10)
  })

  it('never blocks a paid plan (premium) from converting at/over the cap', async () => {
    seedMember({ plan: 'premium' })
    const store = collectionStore([{ id: 'w1', title: 'Wish - List', wishlist: true }])
    store.data.set('count:owned', 25)

    const res = await call('PUT', '?collection=records&id=w1', { wishlist: false })
    expect(res.status).toBe(200)
    expect(store.data.get('item:w1').wishlist).toBe(false)
  })

  it('never blocks the owner (admin key) from converting', async () => {
    const store = createStore()
    stores['runout-collection'] = store // owner's legacy store
    store.data.set('index', ['w1'])
    store.data.set('item:w1', { id: 'w1', title: 'Wish - List', wishlist: true })
    store.data.set('count:owned', 50)

    const res = await call('PUT', '?collection=records&id=w1', { wishlist: false }, `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(200)
    expect(store.data.get('item:w1').wishlist).toBe(false)
    expect(store.data.get('count:owned')).toBe(51)
  })

  it('leaves owned → wishlist and notes-only edits uncapped', async () => {
    seedMember({ plan: 'free' })
    const store = collectionStore([{ id: 'r1', title: 'Owned', wishlist: false }])
    store.data.set('count:owned', 10)

    // owned -> wishlist drops the count and is never blocked.
    let res = await call('PUT', '?collection=records&id=r1', { wishlist: true })
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(9)

    // notes-only edit at the cap is allowed.
    res = await call('PUT', '?collection=records&id=r1', { notes: 'reissue' })
    expect(res.status).toBe(200)
    expect(store.data.get('count:owned')).toBe(9)
  })
})

describe('per-user list cache (T4)', () => {
  it('serves a fresh cached list without re-reading the index or item blobs', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'On Disk' }])
    store.data.set(LIST_CACHE_KEY, { ts: Date.now(), items: [{ id: 'cached', title: 'From Cache' }] })

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([{ id: 'cached', title: 'From Cache' }])
    // Cache read happened, but no index / item blob fetch.
    expect(store.gets.some((k) => k === 'index' || k.startsWith('item:'))).toBe(false)
  })

  it('re-fetches and rewrites the cache once the entry goes stale', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'Fresh' }])
    store.data.set(LIST_CACHE_KEY, { ts: Date.now() - 30_000, items: [{ id: 'stale' }] })

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i) => i.id)).toEqual(['r1'])

    const entry = store.data.get(LIST_CACHE_KEY)
    expect(Array.isArray(entry.items)).toBe(true)
    expect(entry.items.map((i) => i.id)).toEqual(['r1'])
    expect(entry.ts).toBeGreaterThan(Date.now() - 5_000)
  })

  it('invalidates the cache on POST, PUT and DELETE', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'X', wishlist: false }])

    const seedCache = () => store.data.set(LIST_CACHE_KEY, { ts: Date.now(), items: [{ id: 'r1' }] })

    seedCache()
    await call('POST', '?collection=records', { title: 'New - One' })
    expect(store.data.has(LIST_CACHE_KEY)).toBe(false)

    seedCache()
    await call('PUT', '?collection=records&id=r1', { notes: 'n' })
    expect(store.data.has(LIST_CACHE_KEY)).toBe(false)

    seedCache()
    await call('DELETE', '?collection=records&id=r1')
    expect(store.data.has(LIST_CACHE_KEY)).toBe(false)
  })

  it('degrades gracefully when the cache read throws — never fails a GET', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'OK' }])
    store.failPrefixes = ['cache:list']

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i) => i.id)).toEqual(['r1'])
  })

  it('opts out of the cache for explicit pagination so paginated reads are always fresh', async () => {
    seedMember()
    const store = collectionStore(items(['a', 'b', 'c']))
    store.data.set(LIST_CACHE_KEY, { ts: Date.now(), items: [{ id: 'cached' }] })

    const res = await call('GET', '?collection=records&limit=2&offset=0')
    expect(res.status).toBe(200)
    // The cached entry is ignored — the real slice is served.
    expect((await res.json()).items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('collection rate limiting (T5)', () => {
  it('429s with RATE_LIMIT + Retry-After once a user exceeds the fixed window', async () => {
    seedMember()
    collectionStore([])
    const rlStore = createStore()
    stores['runout-rate-limits'] = rlStore
    // Pre-fill the counter at the limit in the CURRENT window.
    rlStore.data.set('rl:collection:records:u1', { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 60 })

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('RATE_LIMIT')
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
  })

  it('still rejects a write with 403 DEMO_READONLY before touching the store', async () => {
    // The demo identity is a CONSTANT (see _shared/auth.js) — authorize()
    // resolves it before any user-store lookup, so no identity seeding is
    // needed. The demo has no IP header, so the rate limit is skipped too.
    const res = await call(
      'POST',
      '?collection=records',
      { title: 'Demo - Add' },
      `Bearer ${DEMO_TOKEN}`,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DEMO_READONLY')
  })

  it('auto-seeds the demo store on first GET so a demo visitor never sees an empty collection', async () => {
    const demoStore = createStore()
    stores['collection-demo-records'] = demoStore // demo id => collection-demo-records

    const res = await call('GET', '?collection=records', undefined, `Bearer ${DEMO_TOKEN}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBeGreaterThan(0)
    // Phase 0 (T3/T4): the seeded store's denormalized count is kept consistent.
    expect(demoStore.data.get('count:owned')).toBe(body.items.length)
  })

  it('403s when the member plan does not include the requested collection', async () => {
    seedMember({ collections: { records: true, books: false } })

    const res = await call('GET', '?collection=books')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain("doesn't include the books collection")
  })

  it('400s on an unknown collection kind', async () => {
    seedMember()

    const res = await call('GET', '?collection=cassettes')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown collection.')
  })

  it('405s on an unsupported method', async () => {
    seedMember()
    collectionStore([])

    const res = await call('PATCH', '?collection=records', { title: 'x' })
    expect(res.status).toBe(405)
  })

  it('returns 500 when a store operation throws (no raw exception to the client)', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'X' }])
    store.failPrefixes = ['index'] // make the index read blow up inside the try

    const res = await call('GET', '?collection=records')
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeTruthy()
  })

  it('401s when no access code is sent', async () => {
    seedMember()
    const res = await call('GET', '?collection=records', undefined, '')
    expect(res.status).toBe(401)
  })
})

describe('SEC-3.1 (#194) — invalid item bodies are rejected with a clean 400, never 500', () => {
  it('POST with a type-mismatch year → 400 TYPE_ERROR', async () => {
    seedMember()
    const res = await call('POST', '?collection=records', { title: 'A', year: 'not-a-year' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
  })

  it('POST with an over-length notes field → 400 TOO_LONG', async () => {
    seedMember()
    const res = await call('POST', '?collection=records', { title: 'A', notes: 'x'.repeat(6000) })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TOO_LONG')
  })

  it('POST with a missing title → 400 REQUIRED', async () => {
    seedMember()
    const res = await call('POST', '?collection=records', { year: 2020 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('REQUIRED')
  })

  it('PUT partial patch validates the present fields (a non-boolean wishlist → 400)', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'X' }])
    const res = await call('PUT', '?collection=records&id=r1', { wishlist: 'yes' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
  })
})

describe('SEC-3.2 (#195) — oversized payloads are rejected cleanly', () => {
  it('POST with a body over the byte cap → 413 PAYLOAD_TOO_LARGE, never processed', async () => {
    seedMember()
    const bigReq = {
      ...req('POST', '?collection=records', {}),
      text: async () => JSON.stringify({ title: 'A', notes: 'x'.repeat(200 * 1024) }),
    }
    const res = await handler(bigReq)
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    // Nothing was written.
    expect(stores[`collection-${USER_ID}-records`].data.has('index')).toBe(false)
  })
})

// (FEAT-EPIC-5, #276) Phase A enrichment — endpoint-level security-gate tests
// for the BLOBS write path (POST/PUT). The pure validator is already covered in
// item-fields.test.js; these prove the HANDLER wires validateItem into the
// write path: a hostile enriched body → 400 with a code and NOTHING stored, a
// valid enriched body persists, and protected identity/privilege fields are
// still stripped alongside the new enrichment fields.
describe('Phase A enrichment — endpoint-level, Blobs write path (FEAT-EPIC-5 #276)', () => {
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

  const storedItemKeys = (store) => [...store.data.keys()].filter((k) => k.startsWith('item:'))

  it('POST persists a well-formed enriched record (artists, masterId, tracklist, released)', async () => {
    seedMember()
    const store = collectionStore([])
    const res = await call('POST', '?collection=records', enrichedRecord)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.artists).toEqual(enrichedRecord.artists)
    expect(body.masterId).toBe(999)
    expect(body.tracklist).toHaveLength(2)
    expect(body.released).toBe('1987-05-15')
    const stored = store.data.get(`item:${body.id}`)
    expect(stored.artists).toEqual(enrichedRecord.artists)
    expect(stored.tracklist[1]).toEqual({ position: 'A2', title: 'Song Two' })
    expect(stored.masterId).toBe(999)
    expect(stored.released).toBe('1987-05-15')
  })

  it('POST persists a well-formed enriched book (authorsList, subtitle, series, mainCategory, snippet)', async () => {
    seedMember()
    const store = createStore()
    stores[`collection-${USER_ID}-books`] = store
    store.data.set('index', [])
    const res = await call('POST', '?collection=books', enrichedBook)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.authorsList).toEqual(enrichedBook.authorsList)
    expect(body.subtitle).toBe('A Subtitle')
    expect(body.snippet).toBe('A short blurb about the book.')
    const stored = store.data.get(`item:${body.id}`)
    expect(stored.authorsList[0]).toEqual({ name: 'Jane Doe', id: 'book-1' })
    expect(stored.series).toBe('The Series')
    expect(stored.mainCategory).toBe('Fiction')
    expect(stored.snippet).toBe('A short blurb about the book.')
  })

  it('PUT partially patches enriched fields onto an existing item (merged, not replaced)', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'The Artist - Album', year: 2000 }])
    const res = await call('PUT', '?collection=records&id=r1', {
      artists: enrichedRecord.artists,
      masterId: 999,
      tracklist: enrichedRecord.tracklist,
      released: '1987-05-15',
    })
    expect(res.status).toBe(200)
    const stored = store.data.get('item:r1')
    expect(stored.artists).toHaveLength(2)
    expect(stored.masterId).toBe(999)
    expect(stored.released).toBe('1987-05-15')
    expect(stored.title).toBe('The Artist - Album') // merged, not replaced
  })

  it('POST rejects an oversized artists array (9) with 400 TOO_LONG and stores nothing', async () => {
    seedMember()
    const store = collectionStore([])
    const res = await call('POST', '?collection=records', {
      title: 'A',
      artists: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `A${i}` })),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TOO_LONG')
    expect(storedItemKeys(store)).toEqual([])
  })

  it('POST rejects a deep/nested hostile object inside artists[] with 400 TYPE_ERROR and stores nothing', async () => {
    seedMember()
    const store = collectionStore([])
    const res = await call('POST', '?collection=records', {
      title: 'A',
      artists: [{ id: 1, name: { nested: true } }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(storedItemKeys(store)).toEqual([])
  })

  it('POST rejects an unknown sub-key inside a tracklist entry with 400 UNKNOWN_FIELD and stores nothing', async () => {
    seedMember()
    const store = collectionStore([])
    const res = await call('POST', '?collection=records', {
      title: 'A',
      tracklist: [{ position: 'A1', title: 'T', lyrics: 'x' }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('UNKNOWN_FIELD')
    expect(storedItemKeys(store)).toEqual([])
  })

  it('POST rejects a non-string snippet with 400 TYPE_ERROR and stores nothing', async () => {
    seedMember()
    const store = createStore()
    stores[`collection-${USER_ID}-books`] = store
    store.data.set('index', [])
    const res = await call('POST', '?collection=books', { title: 'B', snippet: ['x'] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(storedItemKeys(store)).toEqual([])
  })

  it('POST rejects a type-mismatch masterId ("x") with 400 TYPE_ERROR and stores nothing', async () => {
    seedMember()
    const store = collectionStore([])
    const res = await call('POST', '?collection=records', { title: 'A', masterId: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(storedItemKeys(store)).toEqual([])
  })

  it('PUT rejects a hostile enriched patch and leaves the existing item untouched', async () => {
    seedMember()
    const store = collectionStore([{ id: 'r1', title: 'A - B', year: 2000 }])
    const res = await call('PUT', '?collection=records&id=r1', {
      artists: [{ id: 1, name: 'X', role: { deep: true } }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TYPE_ERROR')
    expect(store.data.get('item:r1').artists).toBeUndefined()
  })

  it('persists the new enrichment fields while STILL stripping protected identity/privilege fields', async () => {
    seedMember()
    const store = collectionStore([])
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
    const stored = store.data.get(`item:${body.id}`)
    expect(stored.artists).toEqual(enrichedRecord.artists)
    expect(stored.masterId).toBe(999)
    expect(stored.ownerId).toBeUndefined()
    expect(stored.role).toBeUndefined()
    expect(stored.code).toBeUndefined()
    expect(stored.email).toBeUndefined()
  })
})
