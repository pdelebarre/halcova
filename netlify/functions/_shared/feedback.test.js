// @vitest-environment node
//
// Endpoint tests for netlify/functions/feedback.js (feat/feedback, T3 — issue
// #80, epic #74), driven through the REAL default handler. Mirrors admin.test.js:
// @netlify/blobs is an in-memory map and ./_shared/postgres is a controllable
// switch, so the SAME handler runs on the Blobs path, the Postgres path
// (pg-mem, real migrations 001-006 applied), and the Postgres→Blobs fallback —
// all via the repository seam (getRepository / __resetRepositoryForTests).
//
// Covers:
//   - the four operations (POST submit / GET list / PATCH triage / DELETE)
//     end-to-end on BOTH backends, with the author always derived server-side
//     (a spoofed authorId/authorName in the body is ignored)
//   - admin ops are admin-key-only (401 without it)
//   - POST auth: 401 no/unknown code, 403 disabled, 403 demo read-only
//   - validation: message required + capped at 4000, type/category allow-lists,
//     junk input never 500s (malformed JSON → 400)
//   - rate limiting: 429 RATE_LIMITED + Retry-After once the hourly window
//     per identity is exhausted
//   - secret hygiene: responses never contain the access code / admin key /
//     code_hash
//   - a Postgres outage degrades to the Blobs store instead of 500ing

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { FEEDBACK_RATE_LIMIT, FEEDBACK_RATE_WINDOW_MS } from '../feedback'
import { ADMIN_KEY } from './auth'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'
import { createFeedbackRepo } from './repositories/feedback-repo'
import { createMemDb } from './repositories/test-helpers'
import { createUsersRepo } from './repositories/users-repo'
import { windowIndex } from './rate-limit'
import { __resetRepositoryForTests } from './repository'

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

// Controllable Postgres switch so the seam (repository.js) can be exercised on
// the Blobs path (default), the Postgres path (pg-mem), and the fallback —
// repository.js / postgres-repository.js import ./postgres, which this mocks.
const pgRef = vi.hoisted(() => ({ configured: false, db: null }))
vi.mock('./postgres', () => ({
  isPostgresConfigured: () => pgRef.configured,
  get db() { return pgRef.db },
}))

const BACKENDS = ['blobs', 'postgres']
const CODE = 'RU-AAAA-BBBB-CCCC'
const USER_ID = 'u1'
const DEMO_CODE = 'RUNOUT-DEMO-0000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Session tokens minted per-test AFTER the backend is chosen (SEC-EPIC-1): the
// Bearer is a server-managed session token, not the access code / admin key.
let MEMBER_TOKEN = ''
let ADMIN_TOKEN = ''
let DEMO_TOKEN = ''

async function mintTokens() {
  MEMBER_TOKEN = await sessionTokenFor({ userId: USER_ID, role: 'member' })
  ADMIN_TOKEN = await adminSessionToken()
  DEMO_TOKEN = await demoSessionToken()
}

const ID_1 = '10000000-0000-4000-8000-000000000001'
const ID_2 = '10000000-0000-4000-8000-000000000002'
const ID_3 = '10000000-0000-4000-8000-000000000003'

function req(method, path = '', body, auth = `Bearer ${ADMIN_TOKEN}`) {
  return {
    method,
    url: `http://localhost/.netlify/functions/feedback${path}`,
    headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? auth : null) },
    json: async () => body,
  }
}

function call(method, path = '', body, auth) {
  return handler(req(method, path, body, auth))
}

const submitBody = (overrides = {}) => ({
  type: 'suggestion',
  category: 'scanner',
  message: 'Please support CD barcodes.',
  ...overrides,
})

// Build (or reset) the repository seam for a backend.
async function setBackend(backend) {
  if (backend === 'postgres') {
    pgRef.configured = true
    pgRef.db = await createMemDb()
  } else {
    pgRef.configured = false
    pgRef.db = null
  }
  __resetRepositoryForTests()
}

// Blobs path: seed a member into the runout-identity store so the real
// authorize → findUserByCode resolves them (same trick as reviews.test.js).
function seedMemberBlobs({ id = USER_ID, name = 'Ada', code = CODE, status = 'active' } = {}) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = {
    id, name, email: `${id}@example.com`, code,
    collections: { records: true, books: true }, plan: 'free', role: 'member',
    status, features: {},
  }
  identity.data.set(`code:${code}`, id)
  identity.data.set(`user:${id}`, user)
  identity.data.set('index:users', [...new Set([...(identity.data.get('index:users') || []), id])])
  return user
}

// Postgres path: seed a member into the users table (the repo hashes the code).
async function seedMemberPg({ id = USER_ID, name = 'Ada', code = CODE, status = 'active' } = {}) {
  await createUsersRepo(pgRef.db).saveUser({
    id, name, email: `${id}@example.com`, code,
    collections: { records: true, books: true }, plan: 'free', role: 'member',
    status, features: {},
  })
}

// Seed feedback rows directly into a backend with pinned created_at so inbox
// ordering is deterministic. `items` are feedback-shaped overrides.
async function seedFeedback(backend, items) {
  if (backend === 'blobs') {
    const store = stores['runout-feedback'] || createStore()
    stores['runout-feedback'] = store
    const ids = []
    for (const f of items) {
      const obj = {
        type: 'suggestion', category: 'other', message: 'seed message', status: 'open',
        adminNote: '', url: '', appVersion: '', userAgent: '',
        authorId: USER_ID, authorName: 'Ada', ...f,
      }
      store.data.set(`fb:${obj.id}`, obj)
      ids.push(obj.id)
    }
    store.data.set('index:open', ids)
  } else {
    const repo = createFeedbackRepo(pgRef.db)
    for (const f of items) {
      const created = await repo.createFeedback({
        type: 'suggestion', category: 'other', message: 'seed message', authorId: USER_ID,
        authorName: 'Ada', ...f,
      })
      await pgRef.db.query('UPDATE feedback SET created_at = $1 WHERE id = $2', [f.createdAt, created.id])
    }
  }
}

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  delete process.env.DATABASE_URL
  await setBackend('blobs')
  await mintTokens()
})

describe.each(BACKENDS)('four operations on the %s backend (via the repository seam)', (backend) => {
  beforeEach(async () => {
    await setBackend(backend)
    // Re-mint on the ACTUAL backend so the session lives where auth reads it.
    await mintTokens()
  })

  const seedMember = async () => {
    if (backend === 'blobs') seedMemberBlobs()
    else await seedMemberPg()
  }

  it('POST creates with the server-derived author, then GET/PATCH/DELETE triage end-to-end', async () => {
    await seedMember()

    // POST — member submit. A spoofed authorId/authorName in the body is
    // ignored: the author always comes from the session.
    const res = await call('POST', '', submitBody({
      type: 'bug',
      category: 'scanner',
      message: '  Scanner crashes on iOS 17.  ',
      authorId: 'u999',
      authorName: 'Impostor',
    }), `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created).toMatchObject({
      type: 'bug', category: 'scanner', message: 'Scanner crashes on iOS 17.',
      status: 'open', adminNote: '', authorId: USER_ID, authorName: 'Ada',
    })
    expect(created.id).toMatch(UUID_RE)
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // GET — the admin inbox shows it, newest first.
    const list = await call('GET', '', null, `Bearer ${ADMIN_TOKEN}`)
    expect(list.status).toBe(200)
    const { items } = await list.json()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(created.id)
    expect(items[0].authorName).toBe('Ada')

    // PATCH — admin triage (status + owner-only note).
    const patch = await call('PATCH', '', { id: created.id, status: 'in_progress', adminNote: 'Looking into it.' }, `Bearer ${ADMIN_TOKEN}`)
    expect(patch.status).toBe(200)
    const updated = await patch.json()
    expect(updated).toMatchObject({ id: created.id, status: 'in_progress', adminNote: 'Looking into it.' })
    expect(updated.message).toBe('Scanner crashes on iOS 17.')
    expect(updated.authorId).toBe(USER_ID)

    // DELETE — admin removes it.
    const del = await call('DELETE', `?id=${created.id}`, null, `Bearer ${ADMIN_TOKEN}`)
    expect(del.status).toBe(204)
    const list2 = await call('GET', '', null, `Bearer ${ADMIN_TOKEN}`)
    expect((await list2.json()).items).toHaveLength(0)
  })

  it('accepts the admin session on POST too — the author is the owner', async () => {
    const res = await call('POST', '', submitBody(), `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.authorId).toBe('owner')
    expect(created.authorName).toBe('Admin')
  })

  it('GET filters the inbox by status and type; junk filters are a no-op', async () => {
    await seedFeedback(backend, [
      { id: ID_1, type: 'suggestion', category: 'other', message: 'one', status: 'open', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: ID_2, type: 'bug', category: 'scanner', message: 'two', status: 'open', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: ID_3, type: 'bug', category: 'billing', message: 'three', status: 'done', createdAt: '2026-01-03T00:00:00.000Z' },
    ])
    const all = await (await call('GET', '', null, `Bearer ${ADMIN_TOKEN}`)).json()
    expect(all.items.map((i) => i.id)).toEqual([ID_3, ID_2, ID_1]) // newest first
    const bugs = await (await call('GET', '?type=bug', null, `Bearer ${ADMIN_TOKEN}`)).json()
    expect(bugs.items.map((i) => i.id)).toEqual([ID_3, ID_2])
    const openBugs = await (await call('GET', '?type=bug&status=open', null, `Bearer ${ADMIN_TOKEN}`)).json()
    expect(openBugs.items.map((i) => i.id)).toEqual([ID_2])
    const junk = await call('GET', '?type=garbage&status=nonsense', null, `Bearer ${ADMIN_TOKEN}`)
    expect(junk.status).toBe(200)
    expect((await junk.json()).items).toHaveLength(3)
  })

  it('PATCH 404s unknown and junk ids — never 500', async () => {
    expect((await call('PATCH', '', { id: 'nope', status: 'done' }, `Bearer ${ADMIN_TOKEN}`)).status).toBe(404)
    expect((await call('PATCH', '', { id: ID_3, status: 'done' }, `Bearer ${ADMIN_TOKEN}`)).status).toBe(404)
  })

  it('DELETE 404s unknown and junk ids — never 500', async () => {
    expect((await call('DELETE', '?id=nope', null, `Bearer ${ADMIN_TOKEN}`)).status).toBe(404)
    expect((await call('DELETE', `?id=${ID_3}`, null, `Bearer ${ADMIN_TOKEN}`)).status).toBe(404)
  })

  it('rejects non-admin sessions on GET/PATCH/DELETE (none → 401, member → 403)', async () => {
    await seedMember()
    expect((await call('GET', '', null, '')).status).toBe(401)
    expect((await call('GET', '', null, `Bearer ${MEMBER_TOKEN}`)).status).toBe(403)
    expect((await call('PATCH', '', { id: ID_1, status: 'done' }, `Bearer ${MEMBER_TOKEN}`)).status).toBe(403)
    expect((await call('DELETE', `?id=${ID_1}`, null, `Bearer ${MEMBER_TOKEN}`)).status).toBe(403)
  })
})

describe('POST auth & validation — backend-independent guards (Blobs path)', () => {
  it('401s without a bearer code and with an unknown code', async () => {
    seedMemberBlobs()
    expect((await call('POST', '', submitBody(), '')).status).toBe(401)
    expect((await call('POST', '', submitBody(), 'Bearer RU-ZZZZ-ZZZZ-ZZZZ')).status).toBe(401)
  })

  it('403s for a disabled account', async () => {
    seedMemberBlobs({ status: 'disabled' })
    const res = await call('POST', '', submitBody(), `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(403)
  })

  it('403s DEMO_READONLY for the demo session', async () => {
    const res = await call('POST', '', submitBody(), `Bearer ${DEMO_TOKEN}`)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DEMO_READONLY')
  })

  it('400s MESSAGE_REQUIRED for an empty, whitespace, or missing message', async () => {
    seedMemberBlobs()
    expect((await call('POST', '', submitBody({ message: '' }), `Bearer ${MEMBER_TOKEN}`)).status).toBe(400)
    expect((await call('POST', '', submitBody({ message: '   ' }), `Bearer ${MEMBER_TOKEN}`)).status).toBe(400)
    expect((await call('POST', '', { type: 'suggestion' }, `Bearer ${MEMBER_TOKEN}`)).status).toBe(400)
  })

  it('400s MESSAGE_TOO_LONG past 4000 characters', async () => {
    seedMemberBlobs()
    const res = await call('POST', '', submitBody({ message: 'x'.repeat(4001) }), `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MESSAGE_TOO_LONG')
  })

  it('400s INVALID_TYPE for a junk type', async () => {
    seedMemberBlobs()
    const res = await call('POST', '', submitBody({ type: 'garbage' }), `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_TYPE')
  })

  it('400s INVALID_CATEGORY for a junk category', async () => {
    seedMemberBlobs()
    const res = await call('POST', '', submitBody({ category: 'nonsense' }), `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_CATEGORY')
  })

  it('defaults type to suggestion and category to other when absent', async () => {
    seedMemberBlobs()
    const res = await call('POST', '', { message: 'Just saying hi.' }, `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.type).toBe('suggestion')
    expect(created.category).toBe('other')
  })

  it('treats a malformed JSON body as empty — 400, never 500', async () => {
    seedMemberBlobs()
    const res = await handler({
      method: 'POST',
      url: 'http://localhost/.netlify/functions/feedback',
      headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? `Bearer ${MEMBER_TOKEN}` : null) },
      json: async () => { throw new Error('bad json') },
    })
    expect(res.status).toBe(400)
  })

  it('429s RATE_LIMITED once the hourly submission window is exhausted (with Retry-After)', async () => {
    seedMemberBlobs()
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set(
      'rl:feedback:u1',
      { w: windowIndex(Date.now(), FEEDBACK_RATE_WINDOW_MS), count: FEEDBACK_RATE_LIMIT },
    )
    const res = await call('POST', '', submitBody(), `Bearer ${MEMBER_TOKEN}`)
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('405s on an unsupported method (admin session present)', async () => {
    expect((await call('PUT', '', {}, `Bearer ${ADMIN_TOKEN}`)).status).toBe(405)
  })

  it('never leaks the access code, the admin key, code_hash, session tokens, or PII beyond the session', async () => {
    seedMemberBlobs() // seeded member email is u1@example.com
    const post = await call('POST', '', submitBody(), `Bearer ${MEMBER_TOKEN}`)
    const postText = await post.text()
    expect(postText).not.toContain(CODE)
    expect(postText).not.toContain('code_hash')
    expect(postText).not.toContain(ADMIN_KEY)
    expect(postText).not.toContain(MEMBER_TOKEN)
    // Only the public display name is stamped on feedback — the member's email
    // (PII beyond the session) must never appear in a submission response.
    expect(postText).not.toContain('u1@example.com')
    expect(postText).not.toContain('email')
    const list = await call('GET', '', null, `Bearer ${ADMIN_TOKEN}`)
    const listText = await list.text()
    expect(listText).not.toContain(CODE)
    expect(listText).not.toContain('code_hash')
    expect(listText).not.toContain('u1@example.com')
    expect(listText).not.toContain('email')
  })
})

describe('Postgres outage → Blobs fallback (never 500s)', () => {
  it('serves the admin inbox from the Blobs store when Postgres errors', async () => {
    await seedFeedback('blobs', [
      { id: ID_1, message: 'fallback item', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    pgRef.configured = true
    pgRef.db = {
      query: async () => { throw new Error('connection refused') },
      connect: async () => { throw new Error('connection refused') },
    }
    __resetRepositoryForTests()
    const res = await call('GET', '', null, `Bearer ${ADMIN_TOKEN}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].message).toBe('fallback item')
  })
})
