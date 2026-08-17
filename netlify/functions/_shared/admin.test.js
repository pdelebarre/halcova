// @vitest-environment node
//
// Admin-function tests (netlify/functions/admin.js). The identity `_shared/users`
// facade is mocked as an in-memory map; `_shared/auth` is real (so
// generateAccessCode / publicUser are the real ones). Covers:
//   - GET never emits `code` or `code_hash` for any user (publicUser strips both)
//   - POST `rotate` mints a NEW code, persists it via saveUser, returns it once
//     in the response ({ user, code } — same shape as approve), and the old
//     semantics (re-reveal from plaintext) are gone
//   - approve still returns { user, code } with the code only top-level
//   - Task 5 — review moderation (hideReview / showReview / deleteReview + the
//     GET ?reviews=1 listing), on BOTH the Blobs path and the Postgres path
//     (pg-mem), and never leaking codes/emails
//   - Task 7 — deleteUser also removes the member's reviews on both data paths
//
// The reviews data layer is NOT mocked: `@netlify/blobs` is an in-memory map
// (like reviews.test.js) and `./postgres` is a controllable switch, so the real
// createReviewsRepo / createReviewsBlobStore run under the hood.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { KNOWN_FEATURES, sanitizeFeatures } from '../admin'
import { adminSessionToken } from './session-test-helpers'
import { createMemDb } from './repositories/test-helpers'
import { createFeedbackRepo } from './repositories/feedback-repo'
import { createReviewsRepo } from './repositories/reviews-repo'

const usersMock = vi.hoisted(() => ({
  listUsers: vi.fn(async () => []),
  listRequests: vi.fn(async () => []),
  getUser: vi.fn(async () => null),
  saveUser: vi.fn(async (u) => u),
  saveRequest: vi.fn(async (r) => r),
  getRequest: vi.fn(async () => null),
  removeUserRecord: vi.fn(async () => true),
  removeRequest: vi.fn(async () => true),
  deleteUserCollections: vi.fn(async () => {}),
}))

vi.mock('./users', () => usersMock)

// In-memory @netlify/blobs so the Blobs reviews path (the default when
// DATABASE_URL is unset) is exercised without a site context — same trick as
// reviews.test.js. The shared runout-reviews store lives in `stores`.
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

// Controllable Postgres switch so the SAME admin handler can be exercised on
// the Blobs path (default) and the Postgres path (pg-mem) without touching the
// module under test — admin.js reads isPostgresConfigured()/db from ./postgres.
const pgRef = vi.hoisted(() => ({ configured: false, db: null }))
vi.mock('./postgres', () => ({
  isPostgresConfigured: () => pgRef.configured,
  get db() { return pgRef.db },
}))

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

const CODE_RE = /^RU-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/

// The owner's admin session token, minted per-test (SEC-1.6, #181) — the admin
// API authorizes by the session's role, never by re-checking the admin key.
let ADMIN_TOKEN = ''

function req(method, body, path = '') {
  return {
    method,
    url: `http://localhost/.netlify/functions/admin${path}`,
    headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? `Bearer ${ADMIN_TOKEN}` : null) },
    json: async () => body,
  }
}

async function post(body) {
  return handler(req('POST', body))
}

const review = (overrides = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  kind: 'records',
  sourceId: '372469',
  authorId: 'u1',
  authorName: 'Ada',
  rating: 5,
  body: 'Essential pressing.',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

// Seed the shared runout-reviews blob store directly (the same layout
// createReviewsBlobStore uses) so createdAt ordering is deterministic.
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
}

// Seed the Postgres reviews table via the real repo, then pin created_at so
// newest-first ordering is deterministic.
async function seedPgReviews(db, reviews) {
  const repo = createReviewsRepo(db)
  for (const r of reviews) {
    await repo.upsertReview({
      id: r.id, // server-assigned unless a fixture id is supplied (see below)
      kind: r.kind, sourceId: r.sourceId, authorId: r.authorId,
      authorName: r.authorName, rating: r.rating, body: r.body, status: r.status,
    })
    if (r.createdAt) {
      await db.query(
        'UPDATE reviews SET created_at = $1 WHERE kind = $2 AND source_id = $3 AND author_id = $4',
        [r.createdAt, r.kind, r.sourceId, r.authorId],
      )
    }
  }
}

// Seed the shared runout-feedback blob store directly (the same layout
// createFeedbackBlobStore uses: `fb:<id>` -> object, `index:open` -> id list)
// so the deleteUser cascade can assert on the store contents.
function seedBlobFeedback(items) {
  const store = stores['runout-feedback'] || createStore()
  stores['runout-feedback'] = store
  const ids = []
  for (const f of items) {
    const obj = {
      type: 'suggestion', category: 'other', message: 'seed message', status: 'open',
      adminNote: '', url: '', appVersion: '', userAgent: '',
      authorId: 'u1', authorName: 'Ada', ...f,
    }
    store.data.set(`fb:${obj.id}`, obj)
    ids.push(obj.id)
  }
  store.data.set('index:open', ids)
}

// Seed the Postgres feedback table via the real repo (parity with seedPgReviews).
async function seedPgFeedback(db, items) {
  const repo = createFeedbackRepo(db)
  for (const f of items) {
    await repo.createFeedback({
      type: 'suggestion', category: 'other', message: 'seed message',
      authorId: 'u1', authorName: 'Ada', ...f,
    })
  }
}

beforeEach(async () => {
  for (const fn of Object.values(usersMock)) fn.mockClear()
  usersMock.listUsers.mockResolvedValue([])
  usersMock.listRequests.mockResolvedValue([])
  usersMock.getUser.mockResolvedValue(null)
  usersMock.saveUser.mockImplementation(async (u) => u)
  usersMock.getRequest.mockResolvedValue(null)
  // Fresh reviews state on every test: empty blob stores + the Blobs path (no
  // DATABASE_URL). Postgres-path tests flip pgRef.configured themselves.
  for (const key of Object.keys(stores)) delete stores[key]
  pgRef.configured = false
  pgRef.db = null
  ADMIN_TOKEN = await adminSessionToken()
})

describe('GET /admin — the member list never leaks codes or hashes', () => {
  it('strips code AND code_hash from every listed user (Part B)', async () => {
    usersMock.listUsers.mockResolvedValue([MEMBER, { ...MEMBER, id: 'u2', code: 'RU-BBBB-CCCC-DDDD', code_hash: 'deadbeef' }])
    const res = await handler(req('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    for (const u of body.users) {
      expect(u).not.toHaveProperty('code')
      expect(u).not.toHaveProperty('code_hash')
    }
    expect(body.users[0]).toMatchObject({ id: 'u1', name: 'Ada' })
  })
})

describe('POST rotate — a lost code is rotated, not re-revealed', () => {
  it('mints a new RU-… code, persists it, and returns it exactly once in { user, code }', async () => {
    usersMock.getUser.mockResolvedValue(MEMBER)
    const res = await post({ action: 'rotate', userId: 'u1' })
    expect(res.status).toBe(200)
    const body = await res.json()

    // The new code is a real RU-… code, different from the old one.
    expect(body.code).toMatch(CODE_RE)
    expect(body.code).not.toBe(MEMBER.code)
    // The code appears ONLY at the top level — never on the user object.
    expect(body.user).toMatchObject({ id: 'u1', name: 'Ada' })
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('code_hash')

    // saveUser persisted the new plaintext code (the Postgres path hashes it;
    // the Blobs mirror keeps it for read-through) — the member record changed.
    expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
    const saved = usersMock.saveUser.mock.calls[0][0]
    expect(saved.code).toBe(body.code)
    expect(saved.code).not.toBe(MEMBER.code)
  })

  it('rejects when the user is missing, unknown, or the owner', async () => {
    expect((await post({ action: 'rotate' })).status).toBe(400)
    expect((await post({ action: 'rotate', userId: 'nope' })).status).toBe(404)
    expect((await post({ action: 'rotate', userId: 'owner' })).status).toBe(400)
    expect(usersMock.saveUser).not.toHaveBeenCalled()
  })
})

describe('POST approve — still returns the generated code once (shape preserved)', () => {
  it('approves a pending request and returns { user, code } with the code top-level only', async () => {
    const request = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T09:00:00.000Z' }
    usersMock.getRequest.mockResolvedValue(request)
    const res = await post({ action: 'approve', requestId: 'r1', collections: { records: true, books: false } })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.code).toMatch(CODE_RE)
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('code_hash')
    expect(body.user.collections).toEqual({ records: true, books: false })
    // The approved member was persisted with the generated code (hash stored
    // by the Postgres repo; the Blobs mirror keeps plaintext for read-through).
    expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
    expect(usersMock.saveUser.mock.calls[0][0].code).toBe(body.code)
  })
})

describe('auth guard & unknown actions', () => {
  it('401s without a session and 400s on an unknown action', async () => {
    const res = await handler({ ...req('POST', { action: 'nope' }), headers: { get: () => null } })
    expect(res.status).toBe(401)
    expect((await post({ action: 'nope' })).status).toBe(400)
  })
})

describe('plan enum (S2 — premium / lifetime / unlimited / free)', () => {
  it('updateUser accepts the full plan enum', async () => {
    usersMock.getUser.mockResolvedValue(MEMBER)
    for (const plan of ['premium', 'lifetime', 'unlimited', 'free']) {
      usersMock.saveUser.mockClear()
      const res = await post({ action: 'updateUser', userId: 'u1', plan })
      expect(res.status).toBe(200)
      expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
      expect(usersMock.saveUser.mock.calls[0][0].plan).toBe(plan)
    }
  })

  it('updateUser rejects an unknown plan (400) and never persists it', async () => {
    usersMock.getUser.mockResolvedValue(MEMBER)
    const res = await post({ action: 'updateUser', userId: 'u1', plan: 'platinum' })
    expect(res.status).toBe(400)
    expect(usersMock.saveUser).not.toHaveBeenCalled()
  })

  it('still refuses to edit the owner account', async () => {
    const res = await post({ action: 'updateUser', userId: 'owner', plan: 'premium' })
    expect(res.status).toBe(400)
    expect(usersMock.saveUser).not.toHaveBeenCalled()
  })
})

describe('per-account feature flags (lending + games)', () => {
  it('KNOWN_FEATURES contains both the lending and games flags', () => {
    expect(KNOWN_FEATURES).toEqual(['lending', 'games'])
  })

  it('sanitizeFeatures always returns the full known map, coerced to booleans', () => {
    expect(sanitizeFeatures({ games: true })).toEqual({ lending: false, games: true })
    expect(sanitizeFeatures({ lending: true, games: true })).toEqual({ lending: true, games: true })
    expect(sanitizeFeatures({})).toEqual({ lending: false, games: false })
    expect(sanitizeFeatures(undefined)).toEqual({ lending: false, games: false })
    // Unknown keys are dropped; truthy values coerce to true — a client can
    // never smuggle an arbitrary feature payload onto a user record.
    expect(sanitizeFeatures({ games: 'yes', lending: 1, evil: { x: 1 } })).toEqual({ lending: true, games: true })
  })

  it('approve persists a sanitized full features map (a games grant survives)', async () => {
    const request = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T09:00:00.000Z' }
    usersMock.getRequest.mockResolvedValue(request)
    const res = await post({
      action: 'approve',
      requestId: 'r1',
      collections: { records: true, books: false },
      features: { games: true },
    })
    expect(res.status).toBe(201)
    expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
    expect(usersMock.saveUser.mock.calls[0][0].features).toEqual({ lending: false, games: true })
  })
})

describe('GET /admin?reviews=1 — the admin review moderation listing (Blobs path)', () => {
  it('returns all reviews newest-first with the public fields and no secrets', async () => {
    seedBlobReviews([
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1', authorName: 'Ada', rating: 5, body: 'Essential.', createdAt: '2026-01-01T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: 'u2', authorName: 'Bob', rating: 4, body: 'Solid.', createdAt: '2026-01-02T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000003', authorId: 'u3', authorName: 'Cleo', rating: 3, body: 'Meh.', status: 'hidden', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' }),
    ])

    const res = await handler(req('GET', undefined, '?reviews=1'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.reviews.map((r) => r.id)).toEqual([
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
    ]) // newest first
    expect(body.reviews[0]).toMatchObject({
      kind: 'records', sourceId: '372469', authorId: 'u3', authorName: 'Cleo',
      rating: 3, body: 'Meh.', status: 'hidden',
      createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z',
    })
    // Review objects never carry codes/emails — only public authorName + ids.
    for (const r of body.reviews) {
      expect(r).not.toHaveProperty('code')
      expect(r).not.toHaveProperty('code_hash')
      expect(r).not.toHaveProperty('email')
    }
    expect(body.limit).toBe(1000)
    expect(body.offset).toBe(0)
  })

  it('paginates with limit/offset and honors a status filter', async () => {
    seedBlobReviews([
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1', status: 'published', createdAt: '2026-01-01T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: 'u2', status: 'hidden', createdAt: '2026-01-02T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000003', authorId: 'u3', status: 'published', createdAt: '2026-01-03T00:00:00.000Z' }),
    ])

    const page = await (await handler(req('GET', undefined, '?reviews=1&limit=1&offset=1'))).json()
    // newest first, so offset 1 = u2 (hidden); limit 1 keeps just it
    expect(page.reviews.map((r) => r.authorId)).toEqual(['u2'])
    expect(page.limit).toBe(1)
    expect(page.offset).toBe(1)

    const filtered = await (await handler(req('GET', undefined, '?reviews=1&status=hidden'))).json()
    expect(filtered.reviews.map((r) => r.authorId)).toEqual(['u2'])
  })

  it('does not include reviews unless ?reviews=1 is sent', async () => {
    seedBlobReviews([review()])
    const body = await (await handler(req('GET'))).json()
    expect(body).not.toHaveProperty('reviews')
  })
})

describe('POST hideReview / showReview / deleteReview — admin moderation (Blobs path)', () => {
  it('hides a published review (setStatus hidden)', async () => {
    seedBlobReviews([review()])
    const res = await post({ action: 'hideReview', reviewId: review().id })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const stored = stores['runout-reviews'].data.get('release:records:372469').reviews
    expect(stored[0].status).toBe('hidden')
  })

  it('shows a hidden review (setStatus published)', async () => {
    seedBlobReviews([review({ status: 'hidden' })])
    const res = await post({ action: 'showReview', reviewId: review().id })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const stored = stores['runout-reviews'].data.get('release:records:372469').reviews
    expect(stored[0].status).toBe('published')
  })

  it('deletes any review regardless of author (admin override)', async () => {
    seedBlobReviews([
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: 'u2' }),
    ])
    const res = await post({ action: 'deleteReview', reviewId: '00000000-0000-0000-0000-000000000002' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const stored = stores['runout-reviews'].data.get('release:records:372469').reviews
    expect(stored.map((r) => r.authorId)).toEqual(['u1'])
    expect(stores['runout-reviews'].data.has('id:00000000-0000-0000-0000-000000000002')).toBe(false)
  })

  it('400s on a missing reviewId and 404s on an unknown one', async () => {
    seedBlobReviews([review()])
    for (const action of ['hideReview', 'showReview', 'deleteReview']) {
      const missing = await post({ action })
      expect(missing.status).toBe(400)
      expect((await missing.json()).error).toContain('reviewId')

      const unknown = await post({ action, reviewId: '00000000-0000-0000-0000-00000000dead' })
      expect(unknown.status).toBe(404)
    }
  })

  it('401s without a session', async () => {
    seedBlobReviews([review()])
    const res = await handler({ ...req('POST', { action: 'hideReview', reviewId: review().id }), headers: { get: () => null } })
    expect(res.status).toBe(401)
  })
})

describe('admin moderation on the Postgres path (pg-mem)', () => {
  it('hides and lists reviews through the SQL repo', async () => {
    pgRef.configured = true
    pgRef.db = await createMemDb()
    await seedPgReviews(pgRef.db, [
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: 'u2', createdAt: '2026-01-02T00:00:00.000Z' }),
    ])

    const hide = await post({ action: 'hideReview', reviewId: '00000000-0000-0000-0000-000000000002' })
    expect(hide.status).toBe(200)
    const { rows } = await pgRef.db.query('SELECT status FROM reviews WHERE id = $1', ['00000000-0000-0000-0000-000000000002'])
    expect(rows[0].status).toBe('hidden')

    const list = await (await handler(req('GET', undefined, '?reviews=1'))).json()
    expect(list.reviews.map((r) => r.authorId)).toEqual(['u2', 'u1']) // newest first
    expect(list.reviews.every((r) => !('code' in r) && !('email' in r))).toBe(true)
  })

  it('falls back to the Blobs store when the Postgres reviews path throws', async () => {
    // The Postgres path is "configured" but every query fails (an outage) —
    // moderation must degrade to the shared Blobs store, mirroring reviews.js.
    seedBlobReviews([review()])
    pgRef.configured = true
    pgRef.db = {
      query: async () => { throw new Error('connection refused') },
      connect: async () => { throw new Error('connection refused') },
    }

    const hide = await post({ action: 'hideReview', reviewId: review().id })
    expect(hide.status).toBe(200)
    expect((await hide.json()).ok).toBe(true)
    // The fallback hid the review in the Blobs store, not Postgres.
    const stored = stores['runout-reviews'].data.get('release:records:372469').reviews
    expect(stored[0].status).toBe('hidden')

    // The ?reviews=1 listing also serves from the fallback.
    const list = await (await handler(req('GET', undefined, '?reviews=1'))).json()
    expect(list.reviews).toHaveLength(1)
    expect(list.reviews[0].status).toBe('hidden')
  })
})

describe('deleteUser — the member\'s reviews are removed too (Task 7)', () => {
  it('removes the member\'s reviews on the Blobs path and leaves others alone', async () => {
    seedBlobReviews([
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: 'u2', createdAt: '2026-01-02T00:00:00.000Z' }),
    ])
    usersMock.getUser.mockResolvedValue(MEMBER)

    const res = await post({ action: 'deleteUser', userId: 'u1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(usersMock.removeUserRecord).toHaveBeenCalledWith('u1')
    expect(usersMock.deleteUserCollections).toHaveBeenCalledWith('u1')

    const stored = stores['runout-reviews'].data.get('release:records:372469').reviews
    expect(stored.map((r) => r.authorId)).toEqual(['u2'])
    expect(stores['runout-reviews'].data.has('id:00000000-0000-0000-0000-000000000001')).toBe(false)
  })

  it('removes the member\'s review rows on the Postgres path (pg-mem)', async () => {
    pgRef.configured = true
    pgRef.db = await createMemDb()
    await seedPgReviews(pgRef.db, [
      review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1' }),
      review({ id: '00000000-0000-0000-0000-000000000002', authorId: 'u2' }),
    ])
    usersMock.getUser.mockResolvedValue(MEMBER)

    const res = await post({ action: 'deleteUser', userId: 'u1' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    const { rows } = await pgRef.db.query('SELECT author_id FROM reviews')
    expect(rows.map((r) => r.author_id)).toEqual(['u2'])
  })

  it('still refuses to delete the owner and never touches reviews', async () => {
    seedBlobReviews([review()])
    const res = await post({ action: 'deleteUser', userId: 'owner' })
    expect(res.status).toBe(400)
    expect(usersMock.removeUserRecord).not.toHaveBeenCalled()
    expect(stores['runout-reviews'].data.get('release:records:372469').reviews).toHaveLength(1)
  })

  it('fails the whole delete when the authoritative Postgres reviews cleanup is down (no silent Blobs-only cleanup)', async () => {
    seedBlobReviews([review({ id: '00000000-0000-0000-0000-000000000001', authorId: 'u1' })])
    usersMock.getUser.mockResolvedValue(MEMBER)
    // Postgres is the authoritative reviews backend and it is DOWN.
    pgRef.configured = true
    pgRef.db = {
      query: async () => { throw new Error('connection refused') },
      connect: async () => { throw new Error('connection refused') },
    }

    const res = await post({ action: 'deleteUser', userId: 'u1' })
    expect(res.status).toBe(500)
    // The cleanup is ordered BEFORE the user record is removed, so the member is
    // NOT deleted when the reviews cleanup fails — no orphaned reviews pointing
    // at a removed user.
    expect(usersMock.removeUserRecord).not.toHaveBeenCalled()
    expect(usersMock.deleteUserCollections).not.toHaveBeenCalled()
    // And the Blobs store was NOT silently cleaned on the Postgres path (that
    // would leave the authoritative Postgres rows orphaned once the user went).
    expect(stores['runout-reviews'].data.get('release:records:372469').reviews).toHaveLength(1)
  })

  it('is a no-op when the deleted member has no reviews (idempotent cleanup)', async () => {
    usersMock.getUser.mockResolvedValue(MEMBER)
    const res = await post({ action: 'deleteUser', userId: 'u1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(usersMock.removeUserRecord).toHaveBeenCalledWith('u1')
    expect(usersMock.deleteUserCollections).toHaveBeenCalledWith('u1')
  })
})

// REGRESSION (T8 #78, epic #74): deleting a member must also remove their
// FEEDBACK on both backends. The repo layer already has deleteByAuthor (see
// feedback-repo.test.js / feedback-blob.test.js), but the member-delete path
// in admin.js never wires it — so these tests FAIL against the current code.
// They are kept (skipped) as the repro handed back to the implementer: wire
// feedback cleanup into handleDeleteUser (parity with deleteMemberReviews:
// Blobs-only on the Blobs path, Postgres-authoritative + best-effort Blobs
// sweep on the Postgres path, ordered BEFORE removeUserRecord) and un-skip.
describe('deleteUser — the member\'s feedback is removed too (T8 #78)', () => {
  // REGRESSION (T8 H1) — wired: handleDeleteUser now purges feedback via
  // deleteMemberFeedback (parity with deleteMemberReviews). Un-skipped.
  it('removes the member\'s feedback on the Blobs path and leaves others alone', async () => {
    seedBlobFeedback([
      { id: '10000000-0000-4000-8000-000000000001', authorId: 'u1', message: 'member suggestion' },
      { id: '10000000-0000-4000-8000-000000000002', authorId: 'u2', type: 'bug', message: 'other member bug' },
    ])
    usersMock.getUser.mockResolvedValue(MEMBER)

    const res = await post({ action: 'deleteUser', userId: 'u1' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(usersMock.removeUserRecord).toHaveBeenCalledWith('u1')

    // The member's feedback is gone from the shared runout-feedback store;
    // the other member's survives, and index:open only holds the survivor.
    // NOTE: this mock's setJSON stores the PARSED array (not a JSON string),
    // so index:open reads back as an array — assert on it directly.
    const store = stores['runout-feedback']
    expect(store.data.has('fb:10000000-0000-4000-8000-000000000001')).toBe(false)
    expect(store.data.has('fb:10000000-0000-4000-8000-000000000002')).toBe(true)
    expect(store.data.get('index:open')).toEqual(['10000000-0000-4000-8000-000000000002'])
  })

  // REGRESSION (T8 H1) — wired: handleDeleteUser now purges feedback on the
  // Postgres-authoritative path + best-effort Blobs sweep. Un-skipped.
  it('removes the member\'s feedback rows on the Postgres path (pg-mem)', async () => {
    pgRef.configured = true
    pgRef.db = await createMemDb()
    await seedPgFeedback(pgRef.db, [
      { id: '10000000-0000-4000-8000-000000000001', authorId: 'u1' },
      { id: '10000000-0000-4000-8000-000000000002', authorId: 'u2', type: 'bug' },
    ])
    usersMock.getUser.mockResolvedValue(MEMBER)

    const res = await post({ action: 'deleteUser', userId: 'u1' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    const { rows } = await pgRef.db.query('SELECT author_id FROM feedback')
    expect(rows.map((r) => r.author_id)).toEqual(['u2'])
  })
})
