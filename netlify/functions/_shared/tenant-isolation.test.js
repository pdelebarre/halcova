// @vitest-environment node
//
// SEC-EPIC-2 IDOR / cross-tenant penetration + server-side authorization
// suite (#186, #188, #189, #191). Driven through the REAL default handlers
// (collection, lending, reviews, feedback) with @netlify/blobs mocked as an
// in-memory registry — no store or network is touched. Proves that User B can
// NEVER read, modify, delete, lend, or manipulate User A's objects by changing
// an object id / collection kind / lending id / review id / sourceId, or by
// spoofing ownerId/userId/role/plan/collections in the body or query, and that
// every such attempt yields 401/403/404 (never 200 with someone else's data).
//
// It also pins the server-side authorization boundaries (#191): a free member
// can't exceed the cap by calling the API directly (even with a spoofed
// `plan`/`collections` in the body), a member without the lending flag can't
// lend by crafting a request, and a member without a collection kind can't read
// or write that kind. And the mass-assignment guard (#188): a crafted body with
// identity/privilege fields is stripped by the server, never stored.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import collectionHandler from '../collection'
import lendingHandler from '../lending'
import reviewsHandler from '../reviews'
import feedbackHandler from '../feedback'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'

// Hoisted so the @netlify/blobs mock (which must be registered before the
// modules under test are imported) can share the in-memory store registry.
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

const A = 'user-a' // User A (the victim)
const B = 'user-b' // User B (the attacker)
const RECORDS = 'records'

let A_TOKEN = ''
let B_TOKEN = ''
let ADMIN_TOKEN = ''
let DEMO_TOKEN = ''

// Seed a member identity in the runout-identity store (resolveSession reads it
// back for member sessions). Defaults to a full free member; pass overrides to
// craft limited accounts (e.g. no books kind, no lending flag).
function seedMember(id, { name = 'Member', plan = 'free', collections = { records: true, books: true }, features = {}, status = 'active' } = {}) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = { id, name, email: `${id}@example.com`, code: `RU-CODE-${id}`, collections, plan, features, role: 'member', status }
  identity.data.set(`code:RU-CODE-${id}`, id)
  identity.data.set(`user:${id}`, user)
  const index = identity.data.get('index:users') || []
  if (!index.includes(id)) identity.data.set('index:users', [...index, id])
  return user
}

// Seed a member's collection store with items (mirrors storeNameFor).
function collectionStore(userId, kind = RECORDS, items = []) {
  const store = createStore()
  stores[`collection-${userId}-${kind}`] = store
  store.data.set('index', items.map((i) => i.id))
  for (const item of items) store.data.set(`item:${item.id}`, item)
  return store
}

function item(id, overrides = {}) {
  return { id, title: `Title ${id}`, year: 2000, ...overrides }
}

function req(method, path = '', body, token) {
  return {
    method,
    url: `http://localhost/.netlify/functions${path}`,
    headers: {
      get: (k) => (String(k).toLowerCase() === 'authorization' ? `Bearer ${token}` : null),
    },
    json: async () => body,
  }
}

const call = (handler, method, path, body, token) => handler(req(method, path, body, token))

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  A_TOKEN = await sessionTokenFor({ userId: A, role: 'member' })
  B_TOKEN = await sessionTokenFor({ userId: B, role: 'member' })
  ADMIN_TOKEN = await adminSessionToken()
  DEMO_TOKEN = await demoSessionToken()
})

// ---------------------------------------------------------------------------
// #186 — SEC-2.1: spoofed ownerId/userId is ignored everywhere
// ---------------------------------------------------------------------------
describe('#186 — spoofed tenant id is ignored (authenticated tenant context)', () => {
  it('POST with a spoofed ownerId/userId in the body stores the item in the CALLER store, not the victim', async () => {
    seedMember(A); seedMember(B)
    // B's store must be empty before.
    const res = await call(collectionHandler, 'POST', `?collection=${RECORDS}`, {
      title: 'A spoofed add', year: 1999, ownerId: A, userId: A, role: 'admin', plan: 'unlimited', id: 'victim-id',
    }, B_TOKEN)
    expect(res.status).toBe(201)
    const stored = await res.json()
    // Server-assigned id, NOT the spoofed 'victim-id'.
    expect(stored.id).not.toBe('victim-id')
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/)
    // Identity/privilege fields never reach the stored object.
    expect(stored.ownerId).toBeUndefined()
    expect(stored.userId).toBeUndefined()
    expect(stored.role).toBeUndefined()
    expect(stored.plan).toBeUndefined()
    // The item landed in B's store (storeNameFor(B, records))…
    expect(stores[`collection-${B}-${RECORDS}`].data.has(`item:${stored.id}`)).toBe(true)
    // …and the victim A's store was NOT created / touched by B's add.
    expect(stores[`collection-${A}-${RECORDS}`]).toBeUndefined()
  })

  it('GET with a spoofed ownerId/userId in the query returns only the CALLER store', async () => {
    seedMember(A); seedMember(B)
    collectionStore(A, RECORDS, [item('a1'), item('a2')]) // A has 2 items
    const res = await call(collectionHandler, 'GET', `?collection=${RECORDS}&ownerId=${A}&userId=${A}`, null, B_TOKEN)
    expect(res.status).toBe(200)
    const body = await res.json()
    // B sees B's own (empty) store — never A's items, even though the query
    // asks for ownerId=A.
    expect(body.items).toEqual([])
  })

  it('lending ignores a spoofed ownerId/userId in the body and scopes to the caller store', async () => {
    seedMember(A); seedMember(B, { features: { lending: true } })
    collectionStore(A, RECORDS, [item('a1')])
    const res = await call(lendingHandler, 'POST', '', {
      action: 'lend', collection: RECORDS, itemId: 'a1',
      ownerId: A, userId: A, borrower: { name: 'B' },
    }, B_TOKEN)
    // B's store has no item 'a1' -> 404 (B cannot lend A's item by id).
    expect(res.status).toBe(404)
    // A's item was not mutated by B.
    expect(stores[`collection-${A}-${RECORDS}`].data.get('item:a1').lending).toBeUndefined()
  })

  it('reviews ignores a spoofed authorId in the body and stamps the session user', async () => {
    seedMember(A); seedMember(B)
    const res = await call(reviewsHandler, 'POST', '', {
      kind: RECORDS, sourceId: '111', rating: 5, body: 'by B', authorId: A, role: 'admin',
    }, B_TOKEN)
    expect(res.status).toBe(201)
    const { review } = await res.json()
    expect(review.authorId).toBe(B) // server-derived, never the spoofed A
  })

  it('feedback ignores a spoofed authorId in the body and stamps the session user', async () => {
    seedMember(A); seedMember(B)
    const res = await call(feedbackHandler, 'POST', '', {
      message: 'hello', type: 'suggestion', authorId: A, role: 'admin',
    }, B_TOKEN)
    expect(res.status).toBe(201)
    const fb = await res.json()
    expect(fb.authorId).toBe(B) // server-derived, never the spoofed A
  })
})

// ---------------------------------------------------------------------------
// #188 — SEC-2.3: mass assignment eliminated
// ---------------------------------------------------------------------------
describe('#188 — mass assignment is eliminated (field allowlist)', () => {
  it('POST strips ownerId/userId/role/plan/collections/status/id from the stored item', async () => {
    seedMember(A)
    const res = await call(collectionHandler, 'POST', `?collection=${RECORDS}`, {
      title: 'Clean', year: 2020, genre: ['Rock'],
      ownerId: 'evil', userId: 'evil', role: 'admin', plan: 'unlimited',
      collections: { records: true, books: true }, status: 'active', id: 'forged',
    }, A_TOKEN)
    expect(res.status).toBe(201)
    const stored = await res.json()
    expect(stored).toMatchObject({ title: 'Clean', year: 2020, genre: ['Rock'] })
    expect(stored.id).not.toBe('forged')
    for (const f of ['ownerId', 'userId', 'role', 'plan', 'collections', 'status']) {
      expect(stored[f]).toBeUndefined()
    }
    // And what was actually persisted in the store matches.
    const persisted = stores[`collection-${A}-${RECORDS}`].data.get(`item:${stored.id}`)
    expect(persisted.ownerId).toBeUndefined()
    expect(persisted.plan).toBeUndefined()
  })

  it('PUT strips identity/privilege fields from the patch and cannot retarget another user\'s item', async () => {
    seedMember(A); seedMember(B)
    const aStore = collectionStore(A, RECORDS, [item('a1')])
    // B tries to overwrite A's item a1 (PUT id=a1) with a forged ownerId.
    const res = await call(collectionHandler, 'PUT', `?collection=${RECORDS}&id=a1`, {
      title: 'Hijacked', ownerId: A, userId: A, role: 'admin', plan: 'unlimited', status: 'active', id: 'x',
    }, B_TOKEN)
    // B's store has no item a1 -> 404, and A's item is untouched.
    expect(res.status).toBe(404)
    expect(aStore.data.get('item:a1').title).toBe('Title a1')

    // A's own legitimate PUT also strips the spoofed fields.
    const ok = await call(collectionHandler, 'PUT', `?collection=${RECORDS}&id=a1`, {
      title: 'Mine now', plan: 'unlimited', role: 'admin', ownerId: 'evil',
    }, A_TOKEN)
    expect(ok.status).toBe(200)
    const updated = await ok.json()
    expect(updated.title).toBe('Mine now')
    expect(updated.plan).toBeUndefined()
    expect(updated.role).toBeUndefined()
    expect(updated.ownerId).toBeUndefined()
  })

  it('POST with a forged id does not overwrite the victim\'s existing object', async () => {
    seedMember(A); seedMember(B)
    const aStore = collectionStore(A, RECORDS, [item('existing-a')])
    // B tries to add an item with id equal to A's existing item id.
    await call(collectionHandler, 'POST', `?collection=${RECORDS}`, {
      title: 'B adds', id: 'existing-a',
    }, B_TOKEN)
    // A's item is intact (B's POST landed in B's own store under a new id).
    expect(aStore.data.get('item:existing-a').title).toBe('Title existing-a')
    expect(stores[`collection-${A}-${RECORDS}`].data.get('item:existing-a').title).toBe('Title existing-a')
  })
})

// ---------------------------------------------------------------------------
// #189 — SEC-2.4: IDOR / cross-tenant penetration
// ---------------------------------------------------------------------------
describe('#189 — IDOR / cross-tenant penetration', () => {
  it('B cannot read A\'s collection by listing', async () => {
    seedMember(A); seedMember(B)
    collectionStore(A, RECORDS, [item('a1'), item('a2')])
    const res = await call(collectionHandler, 'GET', `?collection=${RECORDS}`, null, B_TOKEN)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([]) // B's own store is empty
  })

  it('B cannot read A\'s item by changing the store/kind (books)', async () => {
    seedMember(A); seedMember(B)
    collectionStore(A, 'books', [item('b1')])
    const res = await call(collectionHandler, 'GET', '?collection=books', null, B_TOKEN)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('B cannot DELETE A\'s item by id (delete is scoped to B\'s own store)', async () => {
    seedMember(A); seedMember(B)
    const aStore = collectionStore(A, RECORDS, [item('a1')])
    const res = await call(collectionHandler, 'DELETE', `?collection=${RECORDS}&id=a1`, null, B_TOKEN)
    // Deleting a missing id in B's store still 200s (idempotent) but must NOT
    // touch A's item — the security property is that a1 survives in A's store.
    expect(res.status).toBe(200)
    expect(aStore.data.has('item:a1')).toBe(true)
    expect(aStore.data.get('index')).toEqual(['a1'])
  })

  it('B cannot UPDATE A\'s item by id (404, A untouched)', async () => {
    seedMember(A); seedMember(B)
    const aStore = collectionStore(A, RECORDS, [item('a1')])
    const res = await call(collectionHandler, 'PUT', `?collection=${RECORDS}&id=a1`, { title: 'Hijack' }, B_TOKEN)
    expect(res.status).toBe(404)
    expect(aStore.data.get('item:a1').title).toBe('Title a1')
  })

  it('B cannot LEND A\'s item by id (404, A untouched)', async () => {
    seedMember(A); seedMember(B, { features: { lending: true } })
    const aStore = collectionStore(A, RECORDS, [item('a1')])
    const res = await call(lendingHandler, 'POST', '', { action: 'lend', collection: RECORDS, itemId: 'a1', borrower: { name: 'B' } }, B_TOKEN)
    expect(res.status).toBe(404)
    expect(aStore.data.get('item:a1').lending).toBeUndefined()
  })

  it('B cannot RETURN A\'s loan by id', async () => {
    seedMember(A); seedMember(B, { features: { lending: true } })
    const aStore = collectionStore(A, RECORDS, [item('a1', { lending: { borrower: { name: 'X' }, lentOn: new Date().toISOString() } })])
    const res = await call(lendingHandler, 'POST', '', { action: 'return', collection: RECORDS, itemId: 'a1' }, B_TOKEN)
    expect(res.status).toBe(404)
    expect(aStore.data.get('item:a1').lending).toBeDefined() // A's loan intact
  })

  it('B cannot delete A\'s review (403 FORBIDDEN, A untouched)', async () => {
    seedMember(A); seedMember(B)
    // A writes a review.
    const created = await (await call(reviewsHandler, 'POST', '', { kind: RECORDS, sourceId: '222', rating: 5, body: 'A review' }, A_TOKEN)).json()
    const aReviewId = created.review.id
    // B tries to delete it.
    const res = await call(reviewsHandler, 'DELETE', `?id=${aReviewId}`, null, B_TOKEN)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
    // A's review still exists (A can GET it back as "mine").
    const list = await (await call(reviewsHandler, 'GET', `?kind=${RECORDS}&sourceId=222`, null, A_TOKEN)).json()
    expect(list.mine.id).toBe(aReviewId)
  })

  it('B cannot edit A\'s review by upserting with A\'s sourceId as a different author', async () => {
    seedMember(A); seedMember(B)
    await call(reviewsHandler, 'POST', '', { kind: RECORDS, sourceId: '333', rating: 5, body: 'A says' }, A_TOKEN)
    // B posts on the same release — this creates B's OWN review (upsert keyed on
    // authorId from the session), it does NOT overwrite A's.
    await call(reviewsHandler, 'POST', '', { kind: RECORDS, sourceId: '333', rating: 1, body: 'B says', authorId: A }, B_TOKEN)
    const list = await (await call(reviewsHandler, 'GET', `?kind=${RECORDS}&sourceId=333`, null, A_TOKEN)).json()
    expect(list.mine.authorId).toBe(A)
    expect(list.mine.body).toBe('A says') // A's review unmodified
  })

  it('a member cannot access the admin feedback inbox (GET/PATCH/DELETE are 403)', async () => {
    seedMember(A); seedMember(B)
    // B is a member, not admin.
    const getRes = await call(feedbackHandler, 'GET', '', null, B_TOKEN)
    expect(getRes.status).toBe(403)
    const patchRes = await call(feedbackHandler, 'PATCH', '', { id: 'x', status: 'done' }, B_TOKEN)
    expect(patchRes.status).toBe(403)
    const delRes = await call(feedbackHandler, 'DELETE', '?id=x', null, B_TOKEN)
    expect(delRes.status).toBe(403)
  })

  it('feedback member submissions are private to the author + owner', async () => {
    seedMember(A); seedMember(B)
    // A submits; B cannot list it (403, not admin) and the author is A.
    const aFb = await (await call(feedbackHandler, 'POST', '', { message: 'A secret', type: 'bug' }, A_TOKEN)).json()
    expect(aFb.authorId).toBe(A)
    // B cannot triage/delete A's feedback.
    const del = await call(feedbackHandler, 'DELETE', `?id=${aFb.id}`, null, B_TOKEN)
    expect(del.status).toBe(403)
  })

  it('demo is read-only across every write surface (403)', async () => {
    seedMember(A); seedMember(B)
    const col = await call(collectionHandler, 'POST', `?collection=${RECORDS}`, { title: 'x' }, DEMO_TOKEN)
    expect(col.status).toBe(403)
    expect((await col.json()).code).toBe('DEMO_READONLY')
    const rev = await call(reviewsHandler, 'POST', '', { kind: RECORDS, sourceId: '444', rating: 5 }, DEMO_TOKEN)
    expect(rev.status).toBe(403)
    const fb = await call(feedbackHandler, 'POST', '', { message: 'x' }, DEMO_TOKEN)
    expect(fb.status).toBe(403)
    // Demo lending is blocked by the feature gate (demo has no lending flag).
    const lend = await call(lendingHandler, 'POST', '', { action: 'lend', collection: RECORDS, itemId: 'x', borrower: { name: 'D' } }, DEMO_TOKEN)
    expect(lend.status).toBe(403)
  })

  it('unauthenticated requests are 401 on every handler', async () => {
    const col = await call(collectionHandler, 'GET', `?collection=${RECORDS}`, null, '')
    expect(col.status).toBe(401)
    const rev = await call(reviewsHandler, 'GET', `?kind=${RECORDS}&sourceId=1`, null, '')
    expect(rev.status).toBe(401)
    const fb = await call(feedbackHandler, 'GET', '', null, '')
    expect(fb.status).toBe(401)
    const lend = await call(lendingHandler, 'POST', '', { action: 'lend', collection: RECORDS, itemId: 'x', borrower: { name: 'N' } }, '')
    expect(lend.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// #191 — SEC-2.6: server-side plan/feature authorization
// ---------------------------------------------------------------------------
describe('#191 — server-side plan/feature authorization (frontend flags are not a boundary)', () => {
  it('a free member at the cap cannot exceed it by calling POST directly, even with a spoofed plan', async () => {
    seedMember(A) // plan 'free' -> cap 10
    // Seed exactly 10 owned items (the free cap) in A's store.
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`)
    collectionStore(A, RECORDS, ids.map((id) => item(id)))
    const res = await call(collectionHandler, 'POST', `?collection=${RECORDS}`, {
      title: 'Over the cap', plan: 'unlimited', collections: { records: true }, role: 'admin',
    }, A_TOKEN)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_LIMIT')
  })

  it('a member WITHOUT the lending flag cannot lend by crafting a request (spoofed features ignored)', async () => {
    seedMember(A, { features: {} }) // no lending flag, free plan
    collectionStore(A, RECORDS, [item('a1')])
    const res = await call(lendingHandler, 'POST', '', {
      action: 'lend', collection: RECORDS, itemId: 'a1', borrower: { name: 'B' },
      features: { lending: true }, plan: 'premium', role: 'admin', // all spoofed
    }, A_TOKEN)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FEATURE_OFF')
    expect(stores[`collection-${A}-${RECORDS}`].data.get('item:a1').lending).toBeUndefined()
  })

  it('a member WITHOUT a collection kind cannot read or write that kind (403)', async () => {
    seedMember(A, { collections: { records: true, books: false } })
    // A has no books plan -> 403 on GET and POST for books.
    const getRes = await call(collectionHandler, 'GET', '?collection=books', null, A_TOKEN)
    expect(getRes.status).toBe(403)
    const postRes = await call(collectionHandler, 'POST', '?collection=books', { title: 'x', collections: { books: true }, plan: 'unlimited' }, A_TOKEN)
    expect(postRes.status).toBe(403)
    // A can still read their granted kind.
    const ok = await call(collectionHandler, 'GET', '?collection=records', null, A_TOKEN)
    expect(ok.status).toBe(200)
  })

  it('a member without a collection kind cannot review that kind (403 PLAN_FORBIDDEN)', async () => {
    seedMember(A, { collections: { records: true, books: false } })
    const res = await call(reviewsHandler, 'POST', '', { kind: 'books', sourceId: '555', rating: 5, body: 'x' }, A_TOKEN)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAN_FORBIDDEN')
  })

  it('the admin/owner path can manage members\' collection data through the isolated owner store', async () => {
    // The owner keeps the LEGACY stores and is never capped — a write by the
    // owner lands in runout-collection, not in a member store.
    seedMember(A)
    const res = await call(collectionHandler, 'POST', `?collection=${RECORDS}`, { title: 'Owner add', plan: 'unlimited' }, ADMIN_TOKEN)
    expect(res.status).toBe(201)
    expect(stores['runout-collection'].data.has('index')).toBe(true)
    // The owner's add never lands in any member store.
    expect(stores[`collection-${A}-${RECORDS}`]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SEC-3.2 (#195) — payload-size cap on the lending POST path (raw body with
// `.text()` so the real byte-cap path in readJsonBody runs; the shared `req`
// helper only exposes `.json()`).
// ---------------------------------------------------------------------------
describe('SEC-3.2 (#195) — payload-size cap on the lending POST path', () => {
  it('413s PAYLOAD_TOO_LARGE on a lend body over the byte cap (nothing lent)', async () => {
    seedMember(B, { features: { lending: true } })
    collectionStore(B, RECORDS, [item('a1')])
    const big = JSON.stringify({ action: 'lend', collection: RECORDS, itemId: 'a1', borrower: { name: 'x'.repeat(70 * 1024) } })
    const r = {
      method: 'POST',
      url: 'http://localhost/.netlify/functions/lending',
      headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? `Bearer ${B_TOKEN}` : null) },
      text: async () => big,
      json: async () => JSON.parse(big),
    }
    const res = await lendingHandler(r)
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    // The item was NOT lent (the cap rejected before any write).
    expect(stores[`collection-${B}-${RECORDS}`].data.get('item:a1').lending).toBeUndefined()
  })
})
