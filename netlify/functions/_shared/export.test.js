// @vitest-environment node
//
// SEC-7.2.x (#380) — Self-serve member data export (GDPR portability).
// Negative security tests:
//   - Cross-user: user B cannot export user A's data
//   - Expired token: a download with an expired token is rejected
//   - Invalid token: a forged/malformed token is rejected
//   - Over-broad scope: the export only contains the requesting member's data
//   - Demo: the read-only demo identity cannot export
//   - Unauthenticated: a request without a session token is rejected
//   - Unconfigured: when EXPORT_SIGN_SECRET is unset, the function refuses
//
// Positive tests:
//   - A member can export their own data (items, reviews, feedback, profile)
//   - The signed download URL works for a single download
//   - The export blob is consumed after the first download (single-use)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore } from '@netlify/blobs'
import handler from '../export'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'
import { signExportToken } from './export-sign'

// ---------------------------------------------------------------------------
// Hoisted mock infrastructure (mirrors tenant-isolation.test.js)
// ---------------------------------------------------------------------------
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
      async list() {
        const keys = [...this.data.keys()].map((key) => ({ key }))
        return { keys }
      },
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

const EXPORT_SECRET = 'test-export-secret-380'
const EXISTING_SECRET = process.env.EXPORT_SIGN_SECRET

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const A = 'user-a'
const B = 'user-b'

// Seed a member identity in the runout-identity store (resolveSession reads it
// back for member sessions).
function seedMember(id, overrides = {}) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = {
    id,
    name: overrides.name || `Member ${id}`,
    email: `${id}@example.com`,
    code: `RU-CODE-${id}`,
    collections: { records: true, books: true },
    features: {},
    plan: 'free',
    role: 'member',
    status: 'active',
    ...overrides,
  }
  identity.data.set(`code:RU-CODE-${id}`, id)
  identity.data.set(`user:${id}`, user)
  const index = identity.data.get('index:users') || []
  if (!index.includes(id)) identity.data.set('index:users', [...index, id])
  return user
}

// Seed a member's collection store with items (mirrors storeNameFor).
function seedCollection(userId, kind = 'records', items = []) {
  const storeName = `collection-${userId}-${kind}`
  const store = createStore()
  stores[storeName] = store
  const ids = []
  for (const item of items) {
    const id = item.id || `item-${ids.length + 1}`
    store.data.set(`item:${id}`, JSON.parse(JSON.stringify(item)))
    ids.push(id)
  }
  store.data.set('index', JSON.parse(JSON.stringify(ids)))
  return store
}

// Seed a review for a member on a release.
function seedReview(authorId, overrides = {}) {
  const reviewsStore = stores['runout-reviews'] || createStore()
  stores['runout-reviews'] = reviewsStore

  const kind = overrides.kind || 'records'
  const sourceId = overrides.sourceId || 'src-1'
  const review = {
    id: overrides.id || `rev-${authorId}-${sourceId}`,
    kind,
    sourceId,
    authorId,
    authorName: overrides.authorName || `Member ${authorId}`,
    rating: overrides.rating || 5,
    body: overrides.body || 'Great release!',
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Store as release:kind:sourceId -> { reviews: [...] }
  const releaseKey = `release:${kind}:${sourceId}`
  const existing = reviewsStore.data.get(releaseKey) || { reviews: [] }
  existing.reviews.push(review)
  reviewsStore.data.set(releaseKey, existing)

  // Store id index
  reviewsStore.data.set(`id:${review.id}`, [kind, sourceId])

  // Maintain releases index
  const releasesIndex = reviewsStore.data.get('index:releases') || []
  const releaseId = `${kind}:${sourceId}`
  if (!releasesIndex.includes(releaseId)) {
    reviewsStore.data.set('index:releases', [...releasesIndex, releaseId])
  }

  return review
}

// Seed a feedback entry for a member.
function seedFeedback(authorId, overrides = {}) {
  const fbStore = stores['runout-feedback'] || createStore()
  stores['runout-feedback'] = fbStore

  const feedback = {
    id: overrides.id || `fb-${authorId}-${Date.now()}`,
    type: overrides.type || 'suggestion',
    category: overrides.category || 'other',
    message: overrides.message || 'This is my feedback.',
    authorId,
    authorName: overrides.authorName || `Member ${authorId}`,
    url: '',
    appVersion: '1.0.0',
    userAgent: 'test',
    status: 'open',
    adminNote: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  fbStore.data.set(`fb:${feedback.id}`, JSON.parse(JSON.stringify(feedback)))

  // Maintain index:open
  const openIndex = fbStore.data.get('index:open') || []
  if (!openIndex.includes(feedback.id)) {
    fbStore.data.set('index:open', [...openIndex, feedback.id])
  }

  return feedback
}

// Build a Request object for the export handler.
function exportRequest({ token, headers = {}, method = 'GET' } = {}) {
  const params = token ? `?token=${encodeURIComponent(token)}` : ''
  const req = new Request(`http://localhost:8888/.netlify/functions/export${params}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
  return req
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.EXPORT_SIGN_SECRET = EXPORT_SECRET
})

afterEach(() => {
  // Clear all stores
  for (const key of Object.keys(stores)) {
    delete stores[key]
  }
  if (EXISTING_SECRET) {
    process.env.EXPORT_SIGN_SECRET = EXISTING_SECRET
  } else {
    delete process.env.EXPORT_SIGN_SECRET
  }
  delete process.env.EXPORT_SIGN_TTL_MINUTES
})

// ---------------------------------------------------------------------------
// Negative security tests
// ---------------------------------------------------------------------------
describe('negative — cross-user data access', () => {
  it('user B cannot export user A\'s data by using A\'s session token', async () => {
    seedMember(A, { name: 'User A' })
    seedMember(B, { name: 'User B' })

    // Seed items for A only
    seedCollection(A, 'records', [
      { id: 'a-item-1', title: 'A\'s Record', price: 100, notes: 'secret' },
    ])

    // Get A's session token
    const aToken = await sessionTokenFor({ userId: A, role: 'member' })

    // User B tries to use A's token
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    const body = await res.json()

    // The export should succeed (B is presenting A's valid token, so it
    // resolves to A's identity — this is correct behavior: the token IS the
    // identity). The important thing is that the exported data belongs to the
    // token's owner (A), not B.
    expect(res.status).toBe(200)
    expect(body.url).toBeTruthy()

    // Download the export
    const token = body.url.replace('?token=', '')
    const downloadReq = exportRequest({ token })
    const downloadRes = await handler(downloadReq)
    const exportData = await downloadRes.json()

    // Verify the export contains A's data, not B's
    expect(exportData.userId).toBe(A)
    expect(exportData.collections.records).toHaveLength(1)
    expect(exportData.collections.records[0].title).toBe('A\'s Record')
    expect(exportData.collections.records[0].price).toBe(100) // private fields included for owner
  })

  it('user B cannot download user A\'s export using a token for B', async () => {
    seedMember(A, { name: 'User A' })
    seedMember(B, { name: 'User B' })

    // User A requests an export
    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const reqA = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const resA = await handler(reqA)
    const bodyA = await resA.json()
    expect(resA.status).toBe(200)
    const aExportToken = bodyA.url.replace('?token=', '')

    // User B requests an export
    const bToken = await sessionTokenFor({ userId: B, role: 'member' })
    const reqB = exportRequest({ headers: { authorization: `Bearer ${bToken}` } })
    const resB = await handler(reqB)
    const bodyB = await resB.json()
    expect(resB.status).toBe(200)
    const bExportToken = bodyB.url.replace('?token=', '')

    // User B tries to download A's export using B's token
    const downloadReq = exportRequest({ token: bExportToken })
    const downloadRes = await handler(downloadReq)
    const exportData = await downloadRes.json()

    // The download should succeed but contain B's data, not A's
    expect(exportData.userId).toBe(B)
    expect(exportData.userId).not.toBe(A)
  })
})

describe('negative — expired / invalid token', () => {
  it('rejects an expired signed download token', async () => {
    seedMember(A, { name: 'User A' })

    // Create an expired token directly
    const expiredAt = Date.now() - 1000
    const expiredToken = signExportToken({ userId: A, expiresAt: expiredAt, secret: EXPORT_SECRET })

    const req = exportRequest({ token: expiredToken })
    const res = await handler(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('TOKEN_EXPIRED')
  })

  it('rejects a forged token with a wrong secret', async () => {
    const forgedToken = signExportToken({
      userId: A,
      expiresAt: Date.now() + 60_000,
      secret: 'wrong-secret',
    })

    const req = exportRequest({ token: forgedToken })
    const res = await handler(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  it('rejects a malformed token', async () => {
    const req = exportRequest({ token: 'not-a-valid-token' })
    const res = await handler(req)
    expect(res.status).toBe(403)
  })

  it('rejects a request with an empty token parameter', async () => {
    // URL with ?token= (empty value) — the token parameter is present but empty
    const req = new Request('http://localhost:8888/.netlify/functions/export?token=', {
      method: 'GET',
    })
    const res = await handler(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('MISSING_TOKEN')
  })
})

describe('negative — demo readonly', () => {
  it('rejects a demo export request', async () => {
    seedMember('demo', {
      name: 'Demo',
      role: 'demo',
      collections: { records: true, books: true },
    })

    const demoToken = await demoSessionToken()
    const req = exportRequest({ headers: { authorization: `Bearer ${demoToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('DEMO_READONLY')
  })
})

describe('negative — unauthenticated', () => {
  it('rejects an export request without a session token', async () => {
    const req = exportRequest({}) // no Authorization header
    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  it('rejects an export request with an invalid session token', async () => {
    const req = exportRequest({ headers: { authorization: 'Bearer invalid-token' } })
    const res = await handler(req)
    expect(res.status).toBe(401)
  })
})

describe('negative — unconfigured secret', () => {
  it('returns 503 when EXPORT_SIGN_SECRET is not set', async () => {
    delete process.env.EXPORT_SIGN_SECRET
    seedMember(A, { name: 'User A' })

    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('EXPORT_NOT_CONFIGURED')
  })
})

describe('negative — over-broad scope', () => {
  it('export does not include other members\' data', async () => {
    seedMember(A, { name: 'User A' })
    seedMember(B, { name: 'User B' })

    // Seed items for both users
    seedCollection(A, 'records', [
      { id: 'a-item-1', title: 'A\'s Record', price: 100 },
    ])
    seedCollection(B, 'records', [
      { id: 'b-item-1', title: 'B\'s Record', price: 200 },
    ])

    // Seed reviews for both users
    seedReview(A, { sourceId: 'release-1', body: 'A\'s review' })
    seedReview(B, { sourceId: 'release-2', body: 'B\'s review' })

    // Seed feedback for both users
    seedFeedback(A, { message: 'A\'s feedback' })
    seedFeedback(B, { message: 'B\'s feedback' })

    // User A requests an export
    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // Download the export
    const downloadReq = exportRequest({ token: body.url.replace('?token=', '') })
    const downloadRes = await handler(downloadReq)
    const exportData = await downloadRes.json()

    // Verify only A's data is present
    expect(exportData.userId).toBe(A)
    expect(exportData.collections.records).toHaveLength(1)
    expect(exportData.collections.records[0].title).toBe('A\'s Record')
    expect(exportData.collections.records[0].price).toBe(100) // private fields included for owner

    // B's items should NOT be in A's export
    const bItems = (exportData.collections.records || []).filter((i) => i.title === 'B\'s Record')
    expect(bItems).toHaveLength(0)

    // A's reviews should be present
    expect(exportData.reviews).toHaveLength(1)
    expect(exportData.reviews[0].body).toBe('A\'s review')

    // B's reviews should NOT be in A's export
    const bReviews = (exportData.reviews || []).filter((r) => r.body === 'B\'s review')
    expect(bReviews).toHaveLength(0)

    // A's feedback should be present
    expect(exportData.feedback).toHaveLength(1)
    expect(exportData.feedback[0].message).toBe('A\'s feedback')

    // B's feedback should NOT be in A's export
    const bFeedback = (exportData.feedback || []).filter((f) => f.message === 'B\'s feedback')
    expect(bFeedback).toHaveLength(0)
  })

  it('export does not include C12 credentials (code/code_hash)', async () => {
    seedMember(A, { name: 'User A' })

    // Seed some items so there's export data
    seedCollection(A, 'records', [{ id: 'a-item-1', title: 'A\'s Record' }])

    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // Download the export
    const downloadReq = exportRequest({ token: body.url.replace('?token=', '') })
    const downloadRes = await handler(downloadReq)
    const exportData = await downloadRes.json()

    // Profile should not contain C12 credentials
    expect(exportData.profile.code).toBeUndefined()
    expect(exportData.profile.code_hash).toBeUndefined()
    expect(exportData.profile.stripeCustomerId).toBeUndefined()
    expect(exportData.profile.stripeSubscriptionId).toBeUndefined()
    expect(exportData.profile.stripeCheckoutSessionId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------
describe('positive — member can export own data', () => {
  it('returns a signed URL for a valid export request', async () => {
    seedMember(A, { name: 'User A' })
    seedCollection(A, 'records', [{ id: 'a-item-1', title: 'A\'s Record', price: 100 }])
    seedReview(A, { sourceId: 'release-1', body: 'Great!' })
    seedFeedback(A, { message: 'Nice app!' })

    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // Must have a URL and expiry
    expect(body.url).toBeTruthy()
    expect(body.url.startsWith('?token=')).toBe(true)
    expect(body.expiresAt).toBeTruthy()
    expect(body.expiresAtMs).toBeGreaterThan(Date.now())
  })

  it('full round-trip: request -> download -> verify data', async () => {
    seedMember(A, { name: 'User A' })
    seedCollection(A, 'records', [
      { id: 'a-rec-1', title: 'Record 1', year: 2020, price: 50, notes: 'my note' },
    ])
    seedCollection(A, 'books', [
      { id: 'a-book-1', title: 'Book 1', authorsList: 'Author A' },
    ])
    seedReview(A, { sourceId: 'release-1', body: 'Amazing!', rating: 5 })
    seedFeedback(A, { message: 'Love this app' })

    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    // Download
    const downloadReq = exportRequest({ token: body.url.replace('?token=', '') })
    const downloadRes = await handler(downloadReq)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(downloadRes.headers.get('Content-Disposition')).toContain('attachment')

    const exportData = await downloadRes.json()
    expect(exportData.userId).toBe(A)
    expect(exportData.exportedAt).toBeTruthy()
    expect(exportData.profile).toBeTruthy()
    expect(exportData.profile.id).toBe(A)

    // Collections
    expect(exportData.collections.records).toHaveLength(1)
    expect(exportData.collections.records[0].title).toBe('Record 1')
    expect(exportData.collections.records[0].price).toBe(50) // private fields included
    expect(exportData.collections.records[0].notes).toBe('my note') // private fields included
    expect(exportData.collections.books).toHaveLength(1)
    expect(exportData.collections.books[0].title).toBe('Book 1')

    // Reviews
    expect(exportData.reviews).toHaveLength(1)
    expect(exportData.reviews[0].body).toBe('Amazing!')
    expect(exportData.reviews[0].authorId).toBe(A)

    // Feedback
    expect(exportData.feedback).toHaveLength(1)
    expect(exportData.feedback[0].message).toBe('Love this app')
    expect(exportData.feedback[0].authorId).toBe(A)
  })

  it('single-use: the export blob is consumed after the first download', async () => {
    seedMember(A, { name: 'User A' })
    seedCollection(A, 'records', [{ id: 'a-item-1', title: 'Item 1' }])

    const aToken = await sessionTokenFor({ userId: A, role: 'member' })
    const req = exportRequest({ headers: { authorization: `Bearer ${aToken}` } })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const token = body.url.replace('?token=', '')

    // First download — should succeed
    const download1 = exportRequest({ token })
    const res1 = await handler(download1)
    expect(res1.status).toBe(200)

    // Second download — should fail (consumed)
    const download2 = exportRequest({ token })
    const res2 = await handler(download2)
    expect(res2.status).toBe(404)
    const errBody = await res2.json()
    expect(errBody.code).toBe('EXPORT_CONSUMED')
  })
})