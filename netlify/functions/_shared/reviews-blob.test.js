// @vitest-environment node
//
// Blobs fallback reviews store tests with an in-memory @netlify/blobs-shaped
// store (no site context needed). Covers the SHARED `runout-reviews` layout
// (`release:<kind>:<sourceId>` -> { reviews }, `id:<reviewId>` index,
// `index:releases`), the last-write-wins authorId upsert (edit keeps the same
// id/createdAt — no duplicates), status filtering + aggregate math, setStatus /
// deleteReview / deleteByAuthor, junk-id safety, and the O(1) id index.
// The ops mirror reviews-repo.js exactly so the future reviews.js function can
// pick the Postgres or Blobs path like collection.js does.

import { beforeEach, describe, expect, it } from 'vitest'
import { createReviewsBlobStore } from './reviews-blob'
import { parseReleaseKey } from './reviews-shared'

// A minimal @netlify/blobs-shaped store: get(key, { type }) / setJSON / delete.
function createMemStore() {
  const map = new Map()
  return {
    async get(key, { type } = {}) {
      const v = map.get(key)
      if (v === undefined) return null
      return type === 'json' ? JSON.parse(v) : v
    },
    async setJSON(key, value) {
      map.set(key, JSON.stringify(value))
    },
    async delete(key) {
      map.delete(key)
    },
    _raw() {
      return Object.fromEntries(map)
    },
  }
}

const REVIEW = {
  kind: 'records',
  sourceId: '372469',
  authorId: 'u1',
  authorName: 'Ada',
  rating: 5,
  body: 'Essential pressing.',
}

let store
let repo

beforeEach(async () => {
  store = createMemStore()
  repo = createReviewsBlobStore({ store })
})

describe('upsertReview — one review per member per release (last-write-wins)', () => {
  it('creates a review, returns it with a server-assigned uuid id, and writes the shared layout', async () => {
    const created = await repo.upsertReview(REVIEW)
    expect(created).toMatchObject(REVIEW)
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created.status).toBe('published')

    // Shared store layout: the release key holds the review, the id index and
    // the releases index are maintained.
    const raw = store._raw()
    expect(JSON.parse(raw['release:records:372469']).reviews).toHaveLength(1)
    expect(JSON.parse(raw[`id:${created.id}`])).toEqual(['records', '372469'])
    expect(JSON.parse(raw['index:releases'])).toEqual(['records:372469'])
  })

  it('editing the same author replaces their entry in place — no duplicate, id/createdAt kept', async () => {
    const first = await repo.upsertReview(REVIEW)
    // Pre-date updated_at so "edited bumps it" is observable even when both
    // writes land in the same millisecond.
    const data = JSON.parse(store._raw()['release:records:372469'])
    data.reviews[0].updatedAt = '2026-01-01T00:00:00.000Z'
    await store.setJSON('release:records:372469', data)

    const edited = await repo.upsertReview({ ...REVIEW, rating: 2, body: 'On second thought…' })

    expect(edited.id).toBe(first.id)
    expect(edited.rating).toBe(2)
    expect(edited.body).toBe('On second thought…')
    expect(edited.createdAt).toBe(first.createdAt)
    expect(edited.updatedAt).not.toBe('2026-01-01T00:00:00.000Z') // bumped

    const after = JSON.parse(store._raw()['release:records:372469'])
    expect(after.reviews).toHaveLength(1) // never duplicates
  })

  it('keeps two DIFFERENT authors on the same release as separate reviews', async () => {
    await repo.upsertReview(REVIEW)
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', authorName: 'Bob', rating: 4 })
    const data = JSON.parse(store._raw()['release:records:372469'])
    expect(data.reviews).toHaveLength(2)
  })

  it('is scoped per (kind, source_id) — another release is a separate array', async () => {
    await repo.upsertReview(REVIEW)
    await repo.upsertReview({ ...REVIEW, sourceId: '999999', rating: 3 })
    expect(JSON.parse(store._raw()['release:records:999999']).reviews).toHaveLength(1)
    expect(JSON.parse(store._raw()['index:releases']).sort()).toEqual(['records:372469', 'records:999999'])
  })

  it('clamps a junk rating into 1..5 instead of 500ing', async () => {
    expect((await repo.upsertReview({ ...REVIEW, rating: 99 })).rating).toBe(5)
    expect((await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: -3 })).rating).toBe(1)
  })

  it('preserves the admin-set status when an edit omits status', async () => {
    const created = await repo.upsertReview({ ...REVIEW, status: 'hidden' })
    const edited = await repo.upsertReview({ ...REVIEW, body: 'still hidden' })
    expect(edited.status).toBe('hidden')
    expect(edited.id).toBe(created.id)
  })
})

describe('listReviews + aggregate — newest first, AVG/COUNT math', () => {
  it('returns published reviews newest-first and the correct aggregate', async () => {
    // Insert out of order with explicit timestamps so the sort is observable.
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', rating: 5 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: 4 })
    const data = JSON.parse(store._raw()['release:records:372469'])
    data.reviews.find((r) => r.authorId === 'u1').createdAt = '2026-01-01T00:00:00.000Z'
    data.reviews.find((r) => r.authorId === 'u2').createdAt = '2026-01-02T00:00:00.000Z'
    await store.setJSON('release:records:372469', data)
    await repo.upsertReview({ ...REVIEW, authorId: 'u3', rating: 3 }) // newest

    const { reviews, aggregate } = await repo.listReviews('records', '372469')
    expect(reviews.map((r) => r.authorId)).toEqual(['u3', 'u2', 'u1'])
    expect(aggregate.avg).toBe(4) // (5 + 4 + 3) / 3
    expect(aggregate.count).toBe(3)
  })

  it('returns an empty list and a zero aggregate for an unknown release', async () => {
    expect(await repo.listReviews('records', 'nope')).toEqual({ reviews: [], aggregate: { avg: 0, count: 0 } })
  })
})

describe('status filtering — published vs hidden', () => {
  it('filters by status and computes the aggregate over that same set', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', rating: 5, status: 'published' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: 1, status: 'hidden' })

    const pub = await repo.listReviews('records', '372469') // default: published
    expect(pub.reviews.map((r) => r.authorId)).toEqual(['u1'])
    expect(pub.aggregate).toEqual({ avg: 5, count: 1 })

    const hidden = await repo.listReviews('records', '372469', { status: 'hidden' })
    expect(hidden.reviews.map((r) => r.authorId)).toEqual(['u2'])
    expect(hidden.aggregate).toEqual({ avg: 1, count: 1 })
  })
})

describe('getReview / getByAuthor — O(1) id index + author prefill', () => {
  it('finds a review by id through the id index, and by author', async () => {
    const created = await repo.upsertReview(REVIEW)
    expect(await repo.getReview(created.id)).toEqual(created)
    expect(await repo.getByAuthor('records', '372469', 'u1')).toEqual(created)
  })

  it('returns null for a junk id instead of 500ing', async () => {
    expect(await repo.getReview('not-a-uuid')).toBeNull()
    expect(await repo.deleteReview('not-a-uuid')).toBe(false)
    expect(await repo.getByAuthor('records', '372469', 'nobody')).toBeNull()
  })
})

describe('setStatus — admin hide/show + pending', () => {
  it('sets the status and bumps updated_at', async () => {
    const created = await repo.upsertReview(REVIEW)
    expect(await repo.setStatus(created.id, 'hidden')).toBe(true)
    expect((await repo.getReview(created.id)).status).toBe('hidden')
    expect(await repo.setStatus(created.id, 'published')).toBe(true)
    expect((await repo.getReview(created.id)).status).toBe('published')
  })

  it('is a no-op for a junk id or a junk status', async () => {
    expect(await repo.setStatus('not-a-uuid', 'hidden')).toBe(false)
    expect(await repo.setStatus('11111111-1111-1111-1111-111111111111', 'garbage')).toBe(false)
  })
})

describe('deleteReview', () => {
  it('deletes a review, cleans the id index, and reports success', async () => {
    const created = await repo.upsertReview(REVIEW)
    expect(await repo.deleteReview(created.id)).toBe(true)
    expect(await repo.getReview(created.id)).toBeNull()
    expect(await repo.deleteReview(created.id)).toBe(false) // already gone
    expect(store._raw()[`id:${created.id}`]).toBeUndefined()
  })
})

describe('deleteByAuthor — member deletion cleanup', () => {
  it('removes every review the member wrote across releases, leaves others', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', sourceId: 'other', rating: 4 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2' })

    expect(await repo.deleteByAuthor('u1')).toBe(true)
    const remaining = await repo.listAll()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].authorId).toBe('u2')
    expect(await repo.deleteByAuthor('u1')).toBe(false) // nothing left
  })
})

describe('listAll — admin listing', () => {
  it('enumerates every release newest-first and optionally status-filters', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', rating: 5 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: 1, status: 'hidden' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u3', sourceId: 'other', rating: 3 })

    expect(await repo.listAll()).toHaveLength(3)
    const hidden = await repo.listAll({ status: 'hidden' })
    expect(hidden).toHaveLength(1)
    expect(hidden[0].authorId).toBe('u2')
  })
})

describe('parseReleaseKey — robust key splitting (M1)', () => {
  it('splits a well-formed index entry into kind + sourceId', () => {
    expect(parseReleaseKey('records:372469')).toEqual({ kind: 'records', sourceId: '372469' })
    expect(parseReleaseKey('books:zyTCAlFPjgYC')).toEqual({ kind: 'books', sourceId: 'zyTCAlFPjgYC' })
  })

  it('never mis-splits a sourceId containing a colon (legacy/corrupt data)', () => {
    // A pre-M1 bad write could have produced `records:a:b`. Split on the FIRST
    // `:` only — kind is always a known name with no `:`, so the whole rest is
    // the sourceId, never a truncated one.
    expect(parseReleaseKey('records:a:b')).toEqual({ kind: 'records', sourceId: 'a:b' })
    expect(parseReleaseKey('books:zy:TC')).toEqual({ kind: 'books', sourceId: 'zy:TC' })
  })

  it('returns null when there is no separator', () => {
    expect(parseReleaseKey('nokind')).toBeNull()
    expect(parseReleaseKey('')).toBeNull()
    expect(parseReleaseKey(undefined)).toBeNull()
  })
})

describe('legacy colon-in-sourceId keys cannot misbehave (M1 defense-in-depth)', () => {
  it('listAll/deleteByAuthor read a legacy index entry whose sourceId contains a colon', async () => {
    // Simulate a pre-M1 corrupt write: the release key AND the index entry were
    // written with the full `123:extra` sourceId. parseReleaseKey must recover
    // the FULL sourceId so listAll/deleteByAuthor hit the right release.
    const store = createMemStore()
    const u1 = { ...REVIEW, id: '00000000-0000-0000-0000-000000000001' }
    const u2 = { ...REVIEW, authorId: 'u2', authorName: 'Bob', id: '00000000-0000-0000-0000-000000000002' }
    store.setJSON('release:records:123:extra', { reviews: [u1, u2] })
    store.setJSON('index:releases', ['records:123:extra'])
    store.setJSON('id:00000000-0000-0000-0000-000000000001', ['records', '123:extra'])
    store.setJSON('id:00000000-0000-0000-0000-000000000002', ['records', '123:extra'])
    const legacyRepo = createReviewsBlobStore({ store })

    expect(await legacyRepo.listAll()).toHaveLength(2)
    expect(await legacyRepo.deleteByAuthor('u1')).toBe(true)
    const remaining = await legacyRepo.listAll()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].authorId).toBe('u2')
    expect(store._raw()['id:00000000-0000-0000-0000-000000000001']).toBeUndefined()
  })

  it('getReview parses a legacy STRING id index value without mis-splitting', async () => {
    const store = createMemStore()
    // The stored review carries the FULL `123:extra` sourceId (a pre-M1 write).
    const u1 = { ...REVIEW, id: '00000000-0000-0000-0000-000000000001', sourceId: '123:extra' }
    store.setJSON('release:records:123:extra', { reviews: [u1] })
    store.setJSON('index:releases', ['records:123:extra'])
    store.setJSON('id:00000000-0000-0000-0000-000000000001', 'records:123:extra') // legacy string form
    const legacyRepo = createReviewsBlobStore({ store })

    const found = await legacyRepo.getReview('00000000-0000-0000-0000-000000000001')
    expect(found).toMatchObject({ kind: 'records', sourceId: '123:extra', authorId: 'u1' })
  })
})
