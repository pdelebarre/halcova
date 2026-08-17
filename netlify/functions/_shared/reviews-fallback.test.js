// @vitest-environment node
//
// Default-export tests for netlify/functions/reviews.js that the Blobs-path
// (reviews.test.js) and direct-Postgres (reviews-postgres.test.js) suites do
// NOT reach: the dispatch logic in the default handler.
//
//   - Postgres → Blobs read-through FALLBACK: when DATABASE_URL is configured
//     but the Postgres path throws (an outage), the whole request degrades to
//     the shared Blobs store instead of 500ing — parity with collection.js.
//     Exercised for both a write (POST 201 through the fallback) and a read
//     (GET 200 through the fallback).
//   - A malformed JSON POST body is treated as an empty body (readBody catch)
//     and rejected with 400 INVALID_KIND rather than 500ing.
//   - When the Blobs store itself throws, the handler 500s (handleBlobs catch)
//     instead of crashing the request.
//
// `@netlify/blobs` is an in-memory map (same trick as reviews.test.js) and
// `./postgres` is a controllable switch so the SAME default handler can be run
// on the Blobs path, the Postgres path, and the Postgres→Blobs fallback.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../reviews'
import { sessionTokenFor } from './session-test-helpers'

// In-memory @netlify/blobs registry shared with the module under test.
const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, { type } = {}) {
        const value = this.data.get(String(key))
        if (value === undefined) return null
        return type === 'json' ? JSON.parse(JSON.stringify(value)) : value
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

// Controllable Postgres switch: reviews.js routes the default export on
// isPostgresConfigured()/db from ./postgres. The fallback tests set
// `configured = true` with a throwing `db` so handlePostgres rejects and the
// default export must degrade to the Blobs path.
const pgRef = vi.hoisted(() => ({ configured: false, db: null }))
vi.mock('./postgres', () => ({
  isPostgresConfigured: () => pgRef.configured,
  get db() { return pgRef.db },
}))

const CODE = 'RU-AAAA-BBBB-CCCC'
const USER_ID = 'u1'
const SOURCE_ID = '372469'

// Session token minted per-test on the Blobs backend (SEC-EPIC-1).
let MEMBER_TOKEN = ''

function seedMember() {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = {
    id: USER_ID, name: 'Ada', email: 'ada@example.com', code: CODE,
    collections: { records: true, books: true }, plan: 'free', role: 'member',
    status: 'active', features: {},
  }
  identity.data.set(`code:${CODE}`, USER_ID)
  identity.data.set(`user:${USER_ID}`, user)
  identity.data.set('index:users', [USER_ID])
  return user
}

function seedBlobReviews(reviews) {
  const store = stores['runout-reviews'] || createStore()
  stores['runout-reviews'] = store
  const byRelease = {}
  const index = []
  for (const r of reviews) {
    const key = `${r.kind}:${r.sourceId}`
    if (!byRelease[key]) { byRelease[key] = []; index.push(key) }
    byRelease[key].push(r)
    store.data.set(`id:${r.id}`, [r.kind, r.sourceId])
  }
  for (const [key, list] of Object.entries(byRelease)) {
    store.data.set(`release:${key}`, { reviews: list })
  }
  store.data.set('index:releases', index)
  return store
}

const review = (overrides = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  kind: 'records',
  sourceId: SOURCE_ID,
  authorId: 'u2',
  authorName: 'Bob',
  rating: 4,
  body: 'Solid.',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

// `jsonFn` is injectable so a malformed body (json throwing) can be simulated.
function req(method, path = '', body, auth = `Bearer ${MEMBER_TOKEN}`, jsonFn) {
  return {
    method,
    url: `http://localhost/.netlify/functions/reviews${path}`,
    headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? auth : null) },
    json: jsonFn || (async () => body),
  }
}

function call(method, path = '', body, auth, jsonFn) {
  return handler(req(method, path, body, auth, jsonFn))
}

// A pg-mem-less "Postgres is down": every query throws, exactly what the real
// driver does when the connection is gone.
const downDb = {
  query: async () => { throw new Error('connection refused') },
  connect: async () => { throw new Error('connection refused') },
}

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  pgRef.configured = false
  pgRef.db = null
  // Mint the member session on the Blobs backend (the cached repository stays
  // blobs here — reviews.js routes on isPostgresConfigured directly).
  MEMBER_TOKEN = await sessionTokenFor({ userId: USER_ID, role: 'member' })
})

describe('default export — Postgres → Blobs read-through fallback', () => {
  it('serves a POST through the Blobs fallback when the Postgres path throws (201 create)', async () => {
    seedMember()
    pgRef.configured = true
    pgRef.db = downDb

    const res = await call('POST', '', { kind: 'records', sourceId: SOURCE_ID, rating: 5, body: 'Love it.' })
    expect(res.status).toBe(201)
    const { review: created } = await res.json()
    expect(created).toMatchObject({ kind: 'records', sourceId: SOURCE_ID, authorId: USER_ID, rating: 5, status: 'published' })
    // The fallback wrote to the SHARED Blobs store, never to Postgres.
    const stored = stores['runout-reviews'].data.get(`release:records:${SOURCE_ID}`).reviews
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(created.id)
  })

  it('serves a GET through the Blobs fallback when the Postgres path throws (200 read)', async () => {
    seedMember()
    pgRef.configured = true
    pgRef.db = downDb
    seedBlobReviews([review()])

    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    // L1 — u2 is another reviewer (the caller has no review here), so the list
    // entry's authorId is stripped.
    expect(body.reviews.map((r) => r.authorId)).toEqual([undefined])
    expect(body.aggregate).toEqual({ avg: 4, count: 1 })
    expect(body.mine).toBeNull() // the caller has no review on this release
  })

  it('does not consult the Blobs fallback at all when Postgres succeeds', async () => {
    seedMember()
    // A working Postgres (records the review) + an EMPTY blob store. The write
    // must land in Postgres; the blob store must stay untouched.
    const written = []
    const workingDb = {
      query: async (sql, params) => {
        written.push([sql.slice(0, 12), params])
        // Fake a create: return one row shaped like the upsert's RETURNING.
        if (sql.startsWith('INSERT INTO reviews')) {
          return { rows: [{ id: '00000000-0000-0000-0000-0000000000aa', kind: 'records', source_id: SOURCE_ID, author_id: USER_ID, author_name: 'Ada', rating: 5, body: 'Love it.', status: 'published', created_at: '2026-08-15T00:00:00.000Z', updated_at: '2026-08-15T00:00:00.000Z' }], rowCount: 1 }
        }
        if (sql.includes('FROM reviews WHERE kind')) return { rows: [] } // getByAuthor
        return { rows: [], rowCount: 0 }
      },
    }
    pgRef.configured = true
    pgRef.db = workingDb

    const res = await call('POST', '', { kind: 'records', sourceId: SOURCE_ID, rating: 5, body: 'Love it.' })
    expect(res.status).toBe(201)
    expect(stores['runout-reviews']).toBeUndefined() // blob store never created
    expect(written.some(([head]) => head === 'INSERT INTO ')).toBe(true)
  })
})

describe('default export — malformed body and a failing Blobs store', () => {
  it('treats a malformed JSON POST body as an empty body (400 INVALID_KIND, never a 500)', async () => {
    seedMember()
    const res = await call('POST', '', undefined, `Bearer ${MEMBER_TOKEN}`, async () => { throw new SyntaxError('bad json') })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_KIND') // empty body → no kind
  })

  it('500s when the Blobs store itself throws (handleBlobs catch)', async () => {
    seedMember()
    stores['runout-reviews'] = {
      get: async () => { throw new Error('blob store unavailable') },
      setJSON: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [] }),
    }

    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('blob store unavailable')
  })
})
