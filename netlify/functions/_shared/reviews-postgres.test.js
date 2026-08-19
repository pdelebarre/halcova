// @vitest-environment node
//
// Handler-level tests for the Postgres reviews path
// (netlify/functions/reviews.js's exported handlePostgres): the same API
// contract as the Blobs path, driven with a pg-mem-backed `db` injected via a
// mock of ./postgres (the module the handler imports its `db` from). Covers
// the upsert (create 201 / edit 200, no duplicate rows), validation 400s, the
// GET list + aggregate + mine, DELETE ownership, and the owner override — the
// reviews table exists because createMemDb() applies the REAL migrations
// (001-005). Auth / plan gate / rate limit live in the default export and are
// covered in reviews.test.js (like collection-postgres.test.js vs
// collection.test.js).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePostgres } from '../reviews'
import { createReviewsRepo } from './repositories/reviews-repo'
import { createMemDb } from './repositories/test-helpers'

// Inject a pg-mem-backed `db` into reviews.js (which imports it from
// ./postgres). `isPostgresConfigured` is irrelevant here — handlePostgres is
// called directly, bypassing the default export's dispatch.
const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null } }))
vi.mock('./postgres', () => ({
  isPostgresConfigured: () => true,
  get db() { return dbRef.current },
}))

const MEMBER = { id: 'u1', role: 'member', status: 'active', collections: { records: true, books: true }, name: 'Ada', plan: 'free' }
const BOB = { id: 'u2', role: 'member', status: 'active', collections: { records: true, books: true }, name: 'Bob', plan: 'free' }
const OWNER = { id: 'owner', role: 'admin', status: 'active', collections: { records: true, books: true }, name: 'Admin' }

const SOURCE_ID = '372469'

function req(method, path = '', body) {
  return {
    method,
    url: `http://localhost/.netlify/functions/reviews${path}`,
    headers: { get: () => null },
    json: async () => body,
  }
}

async function call(method, path, body, user = MEMBER) {
  const r = req(method, path, body)
  const url = new URL(r.url)
  const isPost = method === 'POST'
  return handlePostgres(r, {
    user,
    // The default export derives kind/sourceId from the POST body (the route
    // contract) or the query string — mirror it here.
    kind: isPost ? (body?.kind || url.searchParams.get('kind')) : url.searchParams.get('kind'),
    sourceId: isPost ? (body?.sourceId || url.searchParams.get('sourceId')) : url.searchParams.get('sourceId'),
    id: url.searchParams.get('id'),
    body,
  })
}

const postBody = (overrides = {}) => ({ kind: 'records', sourceId: SOURCE_ID, rating: 5, body: 'Love it.', ...overrides })

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  dbRef.current = db
  repo = createReviewsRepo(db)
})

describe('POST — upsert on the reviews table (create 201 / edit 200)', () => {
  it('201 creates the caller\'s review with their display name and no duplicate row', async () => {
    const res = await call('POST', '', postBody({ rating: 5, body: '   Love it.   ' }))
    expect(res.status).toBe(201)
    const { review } = await res.json()
    expect(review).toMatchObject({
      kind: 'records', sourceId: SOURCE_ID, authorId: MEMBER.id,
      authorName: 'Ada', rating: 5, body: 'Love it.', status: 'published',
    })
    expect(review.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(review.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(1)
  })

  it('200 updates on a second POST by the same author — same row, no duplicate', async () => {
    const first = await (await call('POST', '', postBody({ rating: 5 }))).json()
    const res = await call('POST', '', postBody({ rating: 2, body: 'On second thought…' }))
    expect(res.status).toBe(200)
    const { review: edited } = await res.json()
    expect(edited.id).toBe(first.review.id)
    expect(edited.rating).toBe(2)
    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(1) // the upsert never duplicates
  })

  it('keeps two DIFFERENT authors on the same release as separate rows', async () => {
    await call('POST', '', postBody({ rating: 5 }), MEMBER)
    await call('POST', '', postBody({ rating: 4 }), BOB)
    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(2)
  })

  it('400s INVALID_RATING for 0, 6 and junk', async () => {
    for (const rating of [0, 6, 1.5, 'x']) {
      const res = await call('POST', '', postBody({ rating }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_RATING')
    }
  })

  it('400s BODY_TOO_LONG past 2000 characters', async () => {
    const res = await call('POST', '', postBody({ body: 'x'.repeat(2001) }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('BODY_TOO_LONG')
  })

  it('400s INVALID_KIND for a bad kind', async () => {
    const res = await call('POST', '', postBody({ kind: 'games' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_KIND')
  })

  it('400s MISSING_SOURCE_ID without a sourceId', async () => {
    const res = await call('POST', '', { kind: 'records', rating: 5 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_SOURCE_ID')
  })

  it('400s INVALID_SOURCE_ID for malformed sourceIds on POST (M1)', async () => {
    // `:`/control/oversize/non-numeric ids are rejected on the Postgres path
    // too, before any row is written.
    for (const sourceId of ['a:b', 'a\u0000b', 'x'.repeat(65), 'not-numeric']) {
      const res = await call('POST', '', postBody({ sourceId }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_SOURCE_ID')
    }
    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(0) // nothing written
  })
})

describe('GET — published reviews + aggregate + mine', () => {
  it('returns published reviews newest-first, the aggregate, and the caller\'s own review', async () => {
    await repo.upsertReview({ kind: 'records', sourceId: SOURCE_ID, authorId: MEMBER.id, authorName: 'Ada', rating: 5, body: 'Love it.' })
    await repo.upsertReview({ kind: 'records', sourceId: SOURCE_ID, authorId: BOB.id, authorName: 'Bob', rating: 4, body: 'Solid.' })
    await repo.upsertReview({ kind: 'records', sourceId: SOURCE_ID, authorId: 'u3', authorName: 'Cleo', rating: 3, body: 'Okay.' })
    // Force a deterministic order: u1's review is the OLDEST.
    await db.query('UPDATE reviews SET created_at = $1 WHERE author_id = $2', ['2026-01-01T00:00:00.000Z', MEMBER.id])

    const res = await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    // L1 — only the caller's own entry keeps its authorId; others' are stripped.
    expect(body.reviews.map((r) => r.authorId)).toEqual([undefined, undefined, MEMBER.id])
    expect(body.reviews[1]).not.toHaveProperty('authorId')
    expect(body.reviews[2].authorId).toBe(MEMBER.id)
    expect(body.aggregate).toEqual({ avg: 4, count: 3 })
    expect(body.mine).toMatchObject({ authorId: MEMBER.id, rating: 5 })
  })

  it('excludes hidden reviews from the list/aggregate but surfaces a hidden draft as mine', async () => {
    await repo.upsertReview({ kind: 'records', sourceId: SOURCE_ID, authorId: MEMBER.id, authorName: 'Ada', rating: 5, body: 'draft', status: 'hidden' })
    await repo.upsertReview({ kind: 'records', sourceId: SOURCE_ID, authorId: BOB.id, authorName: 'Bob', rating: 4, body: 'Solid.' })
    const body = await (await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)).json()
    expect(body.reviews.map((r) => r.authorId)).toEqual([undefined]) // Bob's authorId stripped (L1)
    expect(body.aggregate).toEqual({ avg: 4, count: 1 })
    expect(body.mine).toMatchObject({ authorId: MEMBER.id, status: 'hidden' })
  })

  it('returns an empty list/zero aggregate and a null mine for a review-less release', async () => {
    const body = await (await call('GET', `?kind=records&sourceId=${SOURCE_ID}`)).json()
    expect(body).toEqual({ reviews: [], aggregate: { avg: 0, count: 0 }, mine: null })
  })

  it('400s INVALID_SOURCE_ID for a malformed sourceId on GET (M1)', async () => {
    for (const sourceId of ['a:b', 'a\u0000b', 'x'.repeat(65), 'not-numeric']) {
      const res = await call('GET', `?kind=records&sourceId=${encodeURIComponent(sourceId)}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_SOURCE_ID')
    }
  })
})

describe('DELETE — only the author (or the owner)', () => {
  it('deletes the caller\'s own review', async () => {
    const { review: mine } = await (await call('POST', '', postBody({ rating: 5 }))).json()
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=${mine.id}`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(await repo.getReview(mine.id)).toBeNull()
  })

  it('403s FORBIDDEN on someone else\'s review', async () => {
    const { review: bobs } = await (await call('POST', '', postBody({ rating: 4 }), BOB)).json()
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=${bobs.id}`, null, MEMBER)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
    expect(await repo.getReview(bobs.id)).not.toBeNull() // untouched
  })

  it('403s FORBIDDEN when the review does not exist (non-enumerating)', async () => {
    // SEC-7.1 (#338): a non-admin caller gets a uniform 403 whether the review
    // is someone else's or doesn't exist (was 404).
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=00000000-0000-0000-0000-00000000dead`)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })

  it('400s MISSING_ID without an id', async () => {
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}`)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_ID')
  })

  it('lets the owner (admin) delete anyone\'s review', async () => {
    const { review: bobs } = await (await call('POST', '', postBody({ rating: 4 }), BOB)).json()
    const res = await call('DELETE', `?kind=records&sourceId=${SOURCE_ID}&id=${bobs.id}`, null, OWNER)
    expect(res.status).toBe(200)
    expect(await repo.getReview(bobs.id)).toBeNull()
  })
})
