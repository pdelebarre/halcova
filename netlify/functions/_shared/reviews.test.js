// @vitest-environment node
//
// Handler-level tests for netlify/functions/reviews.js — the community-reviews
// API (feat/reviews, Task 4) driven end-to-end through the REAL default
// handler on the Blobs backend (DATABASE_URL unset). @netlify/blobs is mocked
// as an in-memory map so `authorize` resolves members from the runout-identity
// store and reviews live in the shared runout-reviews store — no real store or
// network is touched. Covers auth (401/403), the per-kind plan gate, rate
// limiting on writes, and every route (GET list+aggregate+mine, POST upsert,
// DELETE ownership) plus the read-only demo guard. The Postgres path is
// exercised separately in reviews-postgres.test.js.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { REVIEWS_DISTINCT_LIMIT } from '../reviews'
import { windowIndex } from './rate-limit'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'

// Hoisted so the @netlify/blobs mock (registered before the module under test
// is imported) can share the in-memory store registry.
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

const CODE = 'RU-AAAA-BBBB-CCCC'
const CODE_BOB = 'RU-BBBB-CCCC-DDDD'
const USER_ID = 'u1'
const BOB_ID = 'u2'
const ADMIN_KEY = 'runout-dev-admin-key' // used ONLY for the secret-hygiene assertion below
const SOURCE_ID = '372469'

// Session tokens minted per-test (SEC-EPIC-1): the Bearer is a server-managed
// session token, not the access code / admin key / demo code.
let MEMBER_TOKEN = ''
let BOB_TOKEN = ''
let ADMIN_TOKEN = ''
let DEMO_TOKEN = ''

// Seed a member in the runout-identity store so the REAL authorize ->
// findUserByCode resolves them (the same trick collection.test.js uses).
function seedMember({
  id = USER_ID, name = 'Ada', code = CODE, email = `${id}@example.com`,
  collections = { records: true, books: true }, status = 'active',
} = {}) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = { id, name, email, code, collections, plan: 'free', role: 'member', status, features: {} }
  identity.data.set(`code:${code}`, id)
  identity.data.set(`user:${id}`, user)
  identity.data.set('index:users', [...new Set([...(identity.data.get('index:users') || []), id])])
  return user
}

// Write reviews straight into the shared runout-reviews store (the same layout
// createReviewsBlobStore uses) so GET/DELETE ordering and status filtering are
// deterministic.
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
  authorId: USER_ID,
  authorName: 'Ada',
  rating: 5,
  body: 'Essential pressing.',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function req(method, path = '', body, auth = `Bearer ${MEMBER_TOKEN}`) {
  return {
    method,
    url: `http://localhost/.netlify/functions/reviews${path}`,
    headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? auth : null) },
    json: async () => body,
  }
}

function call(method, path = '', body, auth) {
  return handler(req(method, path, body, auth))
}

const postBody = (overrides = {}) => ({ kind: 'records', sourceId: SOURCE_ID, rating: 5, body: 'Love it.', ...overrides })

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  // Force the Blobs backend: reviews.js routes on DATABASE_URL (via the real
  // isPostgresConfigured). The test env never sets it, but be hermetic anyway.
  delete process.env.DATABASE_URL
  // Mint fresh session tokens for the identities the tests use (SEC-EPIC-1).
  MEMBER_TOKEN = await sessionTokenFor({ userId: USER_ID, role: 'member' })
  BOB_TOKEN = await sessionTokenFor({ userId: BOB_ID, role: 'member' })
  ADMIN_TOKEN = await adminSessionToken()
  DEMO_TOKEN = await demoSessionToken()
})

describe('auth — every request needs a valid, active access code', () => {
  it('401s without a bearer code', async () => {
    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`, null, '')
    expect(res.status).toBe(401)
  })

  it('401s with an unknown access code', async () => {
    seedMember()
    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`, null, 'Bearer RU-ZZZZ-ZZZZ-ZZZZ')
    expect(res.status).toBe(401)
  })

  it('403s for a disabled account', async () => {
    seedMember({ status: 'disabled' })
    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(403)
  })
})

describe('plan gate — the member must hold the kind\'s plan', () => {
  it('403s with PLAN_FORBIDDEN when the plan lacks the kind', async () => {
    seedMember({ collections: { records: true } }) // books not granted
    const res = await call('GET', '?kind=books&sourceId=xyz')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PLAN_FORBIDDEN')
    expect(body.error).toContain('books')
  })

  it('403s with PLAN_FORBIDDEN on writes too', async () => {
    seedMember({ collections: { records: true } })
    const res = await call('POST', '', postBody({ kind: 'books' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_FORBIDDEN')
  })

  it('never gates the owner (admin session — every collection granted)', async () => {
    const res = await call('GET', `?kind=books&sourceId=xyz`, null, `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(200)
  })
})

describe('kind validation', () => {
  it('400s INVALID_KIND for an unknown kind', async () => {
    seedMember()
    const res = await call('GET', '?kind=games&sourceId=1')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_KIND')
  })

  it('400s INVALID_KIND when kind is missing', async () => {
    seedMember()
    const res = await call('GET', `?sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_KIND')
  })

  it('400s INVALID_KIND for a bad kind in the POST body', async () => {
    seedMember()
    const res = await call('POST', '', postBody({ kind: 'games' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_KIND')
  })
})

describe('POST — upsert the caller\'s review (one per member per release)', () => {
  it('201 creates a published review with the caller\'s display name (never the code/email)', async () => {
    seedMember()
    const res = await call('POST', '', postBody({ rating: 5, body: '   Love it.   ' }))
    expect(res.status).toBe(201)
    const { review: created } = await res.json()
    expect(created).toMatchObject({
      kind: 'records', sourceId: SOURCE_ID, authorId: USER_ID,
      authorName: 'Ada', rating: 5, body: 'Love it.', status: 'published',
    })
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    // Stored in the shared runout-reviews store, no duplicate, not per-user.
    const stored = stores['runout-reviews'].data.get(`release:records:${SOURCE_ID}`).reviews
    expect(stored).toHaveLength(1)
  })

  it('200 updates on a second POST by the same author — same id, no duplicate', async () => {
    seedMember()
    const first = await (await call('POST', '', postBody({ rating: 5, body: 'Love it.' }))).json()
    const res = await call('POST', '', postBody({ rating: 2, body: 'On second thought…' }))
    expect(res.status).toBe(200)
    const { review: edited } = await res.json()
    expect(edited.id).toBe(first.review.id)
    expect(edited.rating).toBe(2)
    expect(edited.body).toBe('On second thought…')
    const stored = stores['runout-reviews'].data.get(`release:records:${SOURCE_ID}`).reviews
    expect(stored).toHaveLength(1) // never duplicates
  })

  it('keeps two DIFFERENT authors on the same release as separate reviews', async () => {
    seedMember()
    seedMember({ id: BOB_ID, name: 'Bob', code: CODE_BOB })
    await call('POST', '', postBody({ rating: 5, body: 'Love it.' }), `Bearer ${MEMBER_TOKEN}`)
    await call('POST', '', postBody({ rating: 4, body: 'Solid.' }), `Bearer ${BOB_TOKEN}`)
    const stored = stores['runout-reviews'].data.get(`release:records:${SOURCE_ID}`).reviews
    expect(stored).toHaveLength(2)
  })

  it('400s INVALID_RATING for 0, 6, non-integers and junk', async () => {
    seedMember()
    for (const rating of [0, 6, 1.5, 'x']) {
      const res = await call('POST', '', postBody({ rating }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_RATING')
    }
  })

  it('400s BODY_TOO_LONG past 2000 characters', async () => {
    seedMember()
    const res = await call('POST', '', postBody({ body: 'x'.repeat(2001) }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('BODY_TOO_LONG')
  })

  it('accepts a 2000-character body', async () => {
    seedMember()
    const res = await call('POST', '', postBody({ body: 'x'.repeat(2000) }))
    expect(res.status).toBe(201)
  })

  it('400s MISSING_SOURCE_ID when sourceId is absent', async () => {
    seedMember()
    const res = await call('POST', '', { kind: 'records', rating: 5 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_SOURCE_ID')
  })

  it('400s INVALID_SOURCE_ID for malformed sourceIds on POST (M1)', async () => {
    seedMember()
    // `:` breaks the Blobs release-key split, control chars pollute keys, and
    // oversize ids pollute the shared store / unbounded source_id rows. 'abc'
    // fails the numeric records-id pattern. All rejected BEFORE any store write.
    for (const sourceId of ['a:b', 'a\u0000b', 'x'.repeat(65), 'abc']) {
      const res = await call('POST', '', postBody({ sourceId }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_SOURCE_ID')
    }
    // Nothing was WRITTEN to the shared reviews store — it may exist empty
    // (createReviewsBlobStore() constructs the store handle eagerly) but no key
    // was created for the rejected id.
    expect(stores['runout-reviews'].data.size).toBe(0)
  })

  it('accepts a valid books volume id and rejects whitespace on POST (M1)', async () => {
    seedMember()
    const ok = await call('POST', '', postBody({ kind: 'books', sourceId: 'zyTCAlFPjgYC' }))
    expect(ok.status).toBe(201)
    const bad = await call('POST', '', postBody({ kind: 'books', sourceId: 'has space' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe('INVALID_SOURCE_ID')
  })

  it('defaults the owner (admin session) authorName to a fixed label — never a secret', async () => {
    const res = await call('POST', '', postBody({ rating: 4 }), `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(201)
    const { review } = await res.json()
    expect(review.authorName).toBe('Admin')
    expect(review.authorName).not.toContain(ADMIN_KEY)
  })
})

describe('GET — published reviews + aggregate + the caller\'s own review', () => {
  it('returns published reviews newest-first, the aggregate, and mine', async () => {
    seedMember()
    seedBlobReviews([
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: USER_ID, authorName: 'Ada', rating: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: BOB_ID, authorName: 'Bob', rating: 4, createdAt: '2026-01-02T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000003', authorId: 'u3', authorName: 'Cleo', rating: 3, createdAt: '2026-01-03T00:00:00.000Z' }),
    ])

    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    // L1 — only the caller's own entry keeps its authorId; others' are stripped.
    expect(body.reviews.map((r) => r.authorId)).toEqual([undefined, undefined, USER_ID]) // newest first
    expect(body.reviews[0]).not.toHaveProperty('authorId') // Cleo's is stripped
    expect(body.reviews[1]).not.toHaveProperty('authorId') // Bob's is stripped
    expect(body.reviews[2].authorId).toBe(USER_ID) // caller's own is kept
    expect(body.reviews.every((r) => r.status === 'published')).toBe(true)
    expect(body.aggregate).toEqual({ avg: 4, count: 3 }) // (5 + 4 + 3) / 3
    expect(body.mine).toMatchObject({ id: '00000000-0000-0000-0000-000000000001', authorId: USER_ID, rating: 5 })
  })

  it('excludes non-published reviews from the list/aggregate but surfaces a hidden draft as mine', async () => {
    seedMember()
    seedBlobReviews([
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: USER_ID, authorName: 'Ada', rating: 5, status: 'hidden', createdAt: '2026-01-01T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: BOB_ID, authorName: 'Bob', rating: 4, status: 'published', createdAt: '2026-01-02T00:00:00.000Z' }),
    ])

    const body = await (await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)).json()
    expect(body.reviews.map((r) => r.authorId)).toEqual([undefined]) // hidden one filtered out; Bob's authorId stripped (L1)
    expect(body.aggregate).toEqual({ avg: 4, count: 1 })
    expect(body.mine).toMatchObject({ authorId: USER_ID, status: 'hidden' }) // still the prefill
  })

  it('returns an empty list/zero aggregate and a null mine for a review-less release', async () => {
    seedMember()
    const body = await (await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)).json()
    expect(body).toEqual({ reviews: [], aggregate: { avg: 0, count: 0 }, mine: null })
  })

  it('400s MISSING_SOURCE_ID without a sourceId', async () => {
    seedMember()
    const res = await call('GET', '?kind=records')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_SOURCE_ID')
  })

  it('400s INVALID_SOURCE_ID for a malformed sourceId on GET (M1)', async () => {
    seedMember()
    for (const sourceId of ['a:b', 'a\u0000b', 'x'.repeat(65), 'not-numeric']) {
      const res = await call('GET', `?kind=records&sourceId=${encodeURIComponent(sourceId)}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_SOURCE_ID')
    }
  })
})

describe('DELETE — only the author (or the owner)', () => {
  it('deletes the caller\'s own review', async () => {
    seedMember()
    const id = '00000000-0000-0000-0000-000000000001'
    seedBlobReviews([review({ id, authorId: USER_ID, rating: 5 })])

    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=${id}`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(stores['runout-reviews'].data.get(`release:records:${SOURCE_ID}`).reviews).toHaveLength(0)
    expect(stores['runout-reviews'].data.has(`id:${id}`)).toBe(false)
  })

  it('403s FORBIDDEN on someone else\'s review', async () => {
    seedMember() // u1 is the caller
    const id = '00000000-0000-0000-0000-000000000001'
    seedBlobReviews([review({ id, authorId: BOB_ID, authorName: 'Bob', rating: 4 })])

    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=${id}`)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
    // Untouched.
    expect(stores['runout-reviews'].data.get(`release:records:${SOURCE_ID}`).reviews).toHaveLength(1)
  })

  it('404s when the review does not exist', async () => {
    seedMember()
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=00000000-0000-0000-0000-00000000dead`)
    expect(res.status).toBe(404)
  })

  it('400s MISSING_ID without an id', async () => {
    seedMember()
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_ID')
  })

  it('lets the owner (admin session) delete anyone\'s review', async () => {
    const id = '00000000-0000-0000-0000-000000000001'
    seedBlobReviews([review({ id, authorId: BOB_ID, authorName: 'Bob', rating: 4 })])
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=${id}`, null, `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

describe('rate limit — writes only', () => {
  it('429s RATE_LIMITED once the per-identity write window is exhausted', async () => {
    seedMember()
    // Burn the whole write window for this identity/kind up front.
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set('rl:reviews:records:u1', { w: windowIndex(), count: 30 })

    const res = await call('POST', '', postBody({ rating: 5 }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('does not rate-limit reads (GET) even with the write window exhausted', async () => {
    seedMember()
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set('rl:reviews:records:u1', { w: windowIndex(), count: 30 })

    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(200)
  })

  it('429s RATE_LIMITED once the per-release (distinct sourceId) write cap is hit (M3)', async () => {
    seedMember()
    // The distinct-release counter for this identity+kind is already at the cap.
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set(
      'rl:reviews-distinct:records:u1',
      { w: windowIndex(), items: Array.from({ length: REVIEWS_DISTINCT_LIMIT }, (_, i) => String(i)) },
    )

    const res = await call('POST', '', postBody({ sourceId: '999' }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('does not count re-editing a release already written this window toward the distinct cap (M3)', async () => {
    seedMember()
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set('rl:reviews-distinct:records:u1', { w: windowIndex(), items: [SOURCE_ID] })
    const res = await call('POST', '', postBody({ rating: 4 }))
    expect(res.status).toBe(201) // SOURCE_ID already tracked → not a new thread
  })
})

describe('demo — read-only on the shared reviews store', () => {
  it('lets the demo read reviews', async () => {
    seedBlobReviews([review({ id: '00000000-0000-0000-0000-000000000001', authorId: BOB_ID, authorName: 'Bob', rating: 4 })])
    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`, null, `Bearer ${DEMO_TOKEN}`)
    expect(res.status).toBe(200)
    expect((await res.json()).reviews).toHaveLength(1)
  })

  it('rejects demo writes with DEMO_READONLY so the shared store is never polluted', async () => {
    const res = await call('POST', '', postBody({ rating: 5 }), `Bearer ${DEMO_TOKEN}`)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DEMO_READONLY')
  })
})

describe('unsupported methods — the route surface is GET/POST/DELETE only', () => {
  it('405s on PUT/PATCH instead of treating it as a review write', async () => {
    seedMember()
    for (const method of ['PUT', 'PATCH']) {
      const res = await call(method, `?kind=records&sourceId=${SOURCE_ID}`)
      expect(res.status).toBe(405)
      expect((await res.json()).error).toContain('Method not allowed')
    }
  })
})
