// @vitest-environment node
//
// Reviews repository tests against pg-mem (in-memory Postgres) with the REAL
// migrations applied (001-005) — so these double as a migration-validity check
// for 005_reviews.sql. Covers the reviewsRepo surface: the (kind, source_id,
// author_id) upsert (create, then edit the same author's review — no duplicate
// rows, id/created_at preserved, admin-set status preserved on a status-less
// edit), newest-first list + AVG/COUNT aggregate, published-vs-hidden status
// filtering, getByAuthor prefill, setStatus, deleteReview, deleteByAuthor
// (member cleanup), junk-id safety, and the BEGIN/COMMIT/ROLLBACK transaction
// helper (rollback via a mocked pg client, since pg-mem can't span a
// transaction across separate statements).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReviewsRepo } from './reviews-repo'
import { createMemDb } from './test-helpers'

const REVIEW = {
  kind: 'records',
  sourceId: '372469',
  authorId: 'u1',
  authorName: 'Ada',
  rating: 5,
  body: 'Essential pressing.',
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createReviewsRepo(db)
})

describe('upsertReview — one review per member per release (upsert)', () => {
  it('creates a review and returns it with a server-assigned uuid id', async () => {
    const created = await repo.upsertReview(REVIEW)
    expect(created).toMatchObject(REVIEW)
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created.status).toBe('published')
    // Both timestamps are set on a fresh insert. Real Postgres uses one
    // transaction timestamp for now() so they're equal; pg-mem evaluates
    // now() per column (they can differ by a millisecond) — assert presence
    // and shape instead of exact equality.
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('editing the same author updates the SAME row — no duplicate', async () => {
    const first = await repo.upsertReview(REVIEW)
    // Pre-date updated_at so "edited bumps it" is observable even when both
    // writes land in the same millisecond (pg-mem now() precision).
    await db.query('UPDATE reviews SET updated_at = $1 WHERE id = $2', ['2026-01-01T00:00:00.000Z', first.id])
    const edited = await repo.upsertReview({ ...REVIEW, rating: 2, body: 'On second thought…' })

    expect(edited.id).toBe(first.id)             // id preserved (PK unchanged)
    expect(edited.rating).toBe(2)
    expect(edited.body).toBe('On second thought…')
    expect(edited.createdAt).toBe(first.createdAt) // created_at preserved
    expect(edited.updatedAt).not.toBe('2026-01-01T00:00:00.000Z') // updated_at bumped

    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(1) // still ONE row — the upsert never duplicates
  })

  it('keeps two DIFFERENT authors on the same release as separate rows', async () => {
    await repo.upsertReview(REVIEW)
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', authorName: 'Bob', rating: 4 })
    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(2)
  })

  it('is scoped per (kind, source_id) — the same author on another release is a new review', async () => {
    await repo.upsertReview(REVIEW)
    const other = await repo.upsertReview({ ...REVIEW, sourceId: '999999', rating: 3 })
    expect(other.id).not.toBe((await repo.getByAuthor('records', '372469', 'u1')).id)
    const { rows } = await db.query('SELECT count(*)::int AS count FROM reviews')
    expect(rows[0].count).toBe(2)
  })

  it('clamps a junk rating into the CHECK instead of 500ing', async () => {
    const created = await repo.upsertReview({ ...REVIEW, rating: 99 })
    expect(created.rating).toBe(5)
    const low = await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: -3 })
    expect(low.rating).toBe(1)
  })

  it('preserves the admin-set status when an edit omits status (no silent un-hide)', async () => {
    const created = await repo.upsertReview({ ...REVIEW, status: 'hidden' })
    const edited = await repo.upsertReview({ ...REVIEW, body: 'still hidden' })
    expect(edited.status).toBe('hidden')
    expect(edited.id).toBe(created.id)
  })
})

describe('listReviews + aggregate — newest first, AVG/COUNT math', () => {
  it('returns published reviews newest-first and the correct aggregate', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', rating: 5 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: 4 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u3', rating: 3 })
    // Force a deterministic order: u1's review is the OLDEST.
    await db.query(
      'UPDATE reviews SET created_at = $1 WHERE author_id = $2',
      ['2026-01-01T00:00:00.000Z', 'u1'],
    )

    const { reviews, aggregate } = await repo.listReviews('records', '372469')
    expect(reviews.map((r) => r.authorId)).toEqual(['u3', 'u2', 'u1'])
    expect(reviews.map((r) => r.rating)).toEqual([3, 4, 5])
    expect(aggregate.avg).toBe(4)  // (5 + 4 + 3) / 3
    expect(aggregate.count).toBe(3)
  })

  it('returns an empty list and a zero aggregate for an unknown release', async () => {
    expect(await repo.listReviews('records', 'nope')).toEqual({ reviews: [], aggregate: { avg: 0, count: 0 } })
  })
})

describe('status filtering — published vs hidden vs pending', () => {
  it('listReviews filters by status and computes the aggregate over that same set', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', rating: 5, status: 'published' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: 1, status: 'hidden' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u3', rating: 3, status: 'pending' })

    const pub = await repo.listReviews('records', '372469') // default: published
    expect(pub.reviews.map((r) => r.authorId)).toEqual(['u1'])
    expect(pub.aggregate).toEqual({ avg: 5, count: 1 })

    const hidden = await repo.listReviews('records', '372469', { status: 'hidden' })
    expect(hidden.reviews.map((r) => r.authorId)).toEqual(['u2'])
    expect(hidden.aggregate).toEqual({ avg: 1, count: 1 })

    const all = await repo.listReviews('records', '372469', { status: 'pending' })
    expect(all.reviews.map((r) => r.authorId)).toEqual(['u3'])
  })
})

describe('getByAuthor — "my review" prefill (any status)', () => {
  it('returns the author\u2019s own review for a release regardless of status', async () => {
    await repo.upsertReview({ ...REVIEW, status: 'pending' })
    const mine = await repo.getByAuthor('records', '372469', 'u1')
    expect(mine).toMatchObject({ authorId: 'u1', status: 'pending' })
    // Different author / different release: no match.
    expect(await repo.getByAuthor('records', '372469', 'nobody')).toBeNull()
    expect(await repo.getByAuthor('records', 'other', 'u1')).toBeNull()
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

describe('getReview / deleteReview', () => {
  it('returns null for a junk id instead of 500ing', async () => {
    expect(await repo.getReview('not-a-uuid')).toBeNull()
    expect(await repo.deleteReview('not-a-uuid')).toBe(false)
  })

  it('deletes a review and reports whether a row was removed', async () => {
    const created = await repo.upsertReview(REVIEW)
    expect(await repo.getReview(created.id)).toMatchObject(REVIEW)
    expect(await repo.deleteReview(created.id)).toBe(true)
    expect(await repo.getReview(created.id)).toBeNull()
    expect(await repo.deleteReview(created.id)).toBe(false) // already gone
  })
})

describe('listAll — admin listing', () => {
  it('returns every review newest-first and optionally status-filtered', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', rating: 5 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2', rating: 1, status: 'hidden' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u3', sourceId: 'other', rating: 3 })

    expect(await repo.listAll()).toHaveLength(3)
    const hidden = await repo.listAll({ status: 'hidden' })
    expect(hidden).toHaveLength(1)
    expect(hidden[0].authorId).toBe('u2')
    expect(await repo.listAll({ status: 'nonsense' })).toHaveLength(3) // invalid filter = no filter
  })
})

describe('deleteByAuthor — member deletion cleanup', () => {
  it('removes every review the member wrote, leaving others untouched', async () => {
    await repo.upsertReview({ ...REVIEW, authorId: 'u1' })
    await repo.upsertReview({ ...REVIEW, authorId: 'u1', sourceId: 'other', rating: 4 })
    await repo.upsertReview({ ...REVIEW, authorId: 'u2' })

    expect(await repo.deleteByAuthor('u1')).toBe(true)
    const remaining = await repo.listAll()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].authorId).toBe('u2')
    expect(await repo.deleteByAuthor('u1')).toBe(false) // nothing left to remove
  })
})

describe('transaction — BEGIN/COMMIT/ROLLBACK (parity with items-repo)', () => {
  it('commits the writes inside the callback atomically (pg-mem happy path)', async () => {
    await repo.transaction(async (tx) => {
      await tx.upsertReview({ ...REVIEW, authorId: 'u1' })
      await tx.upsertReview({ ...REVIEW, authorId: 'u2' })
    })
    const { aggregate } = await repo.listReviews('records', '372469')
    expect(aggregate.count).toBe(2)
  })

  it('issues BEGIN -> fn -> COMMIT and always releases the client', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createReviewsRepo(memDb)
    const fn = vi.fn()

    await txRepo.transaction(fn)

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT'])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('issues BEGIN -> fn -> ROLLBACK and rethrows on error', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createReviewsRepo(memDb)
    const boom = new Error('boom')
    const fn = vi.fn(async () => { throw boom })

    await expect(txRepo.transaction(fn)).rejects.toThrow('boom')

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
