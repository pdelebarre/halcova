// @vitest-environment node
//
// Feedback repository tests against pg-mem (in-memory Postgres) with the REAL
// migrations applied (001-006) — so these double as a migration-validity check
// for 006_feedback.sql. Covers the feedbackRepo surface: create (server uuid,
// type/status/category defaults, junk-type coercion), newest-first list with
// status/type filters + pagination, triage update (status + admin note),
// deleteFeedback, deleteByAuthor (member cleanup), the message length CHECK
// (1–4000), junk-id/junk-status/junk-type safety (never 500), and the
// BEGIN/COMMIT/ROLLBACK transaction helper (rollback via a mocked pg client,
// since pg-mem can't span a transaction across separate statements).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeedbackRepo } from './feedback-repo'
import { createMemDb } from './test-helpers'

const FEEDBACK = {
  type: 'suggestion',
  category: 'scanner',
  message: 'It would be great to scan CD barcodes too.',
  authorId: 'u1',
  authorName: 'Ada',
  url: '/settings',
  appVersion: '1.4.0',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createFeedbackRepo(db)
})

describe('createFeedback', () => {
  it('creates a row and returns it with a server-assigned uuid id + defaults', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    expect(created).toMatchObject({ ...FEEDBACK, status: 'open', adminNote: '' })
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    // Both timestamps are set on a fresh insert. Real Postgres uses one
    // transaction timestamp for now() so they're equal; pg-mem evaluates
    // now() per column (they can differ by a millisecond) — assert presence
    // and shape instead of exact equality.
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('coerces a junk or missing type to suggestion — never 500, never lost', async () => {
    const junk = await repo.createFeedback({ ...FEEDBACK, type: 'garbage' })
    expect(junk.type).toBe('suggestion')
    const missing = await repo.createFeedback({ ...FEEDBACK, authorId: 'u2', type: undefined })
    expect(missing.type).toBe('suggestion')
  })

  it('defaults category to other and status to open when absent', async () => {
    const created = await repo.createFeedback({ ...FEEDBACK, category: undefined, status: undefined })
    expect(created.category).toBe('other')
    expect(created.status).toBe('open')
  })

  it('accepts an explicit status from the client', async () => {
    const created = await repo.createFeedback({ ...FEEDBACK, status: 'in_progress' })
    expect(created.status).toBe('in_progress')
  })

  it('stores a message of exactly 4000 chars', async () => {
    const created = await repo.createFeedback({ ...FEEDBACK, message: 'x'.repeat(4000) })
    expect(created.message).toHaveLength(4000)
  })

  // The message CHECK (1–4000) is enforced by the DATABASE, not clamped in the
  // repo — an over-long/empty message must be rejected, never truncated. Kept
  // as the last statement of their own tests: a rejected insert must not be
  // followed by reads on the same pg-mem connection.
  it('rejects a message longer than 4000 chars (DB CHECK) instead of truncating', async () => {
    await expect(
      repo.createFeedback({ ...FEEDBACK, message: 'x'.repeat(4001) }),
    ).rejects.toThrow()
  })

  it('rejects an empty message (DB CHECK)', async () => {
    await expect(repo.createFeedback({ ...FEEDBACK, message: '' })).rejects.toThrow()
  })
})

describe('listFeedback — newest first + status/type filters + pagination', () => {
  // Deterministic order: explicit, distinct created_at per author (newest
  // first is u4 → u3 → u2 → u1) so the sort never depends on pg-mem's now()
  // resolution within a test.
  async function seed() {
    const rows = [
      ['u1', '2026-01-01T00:00:00.000Z', 'suggestion', 'open'],
      ['u2', '2026-01-02T00:00:00.000Z', 'bug', 'open'],
      ['u3', '2026-01-03T00:00:00.000Z', 'suggestion', 'done'],
      ['u4', '2026-01-04T00:00:00.000Z', 'bug', 'wontfix'],
    ]
    for (const [authorId, created_at, type, status] of rows) {
      const created = await repo.createFeedback({ ...FEEDBACK, authorId, type, status })
      await db.query('UPDATE feedback SET created_at = $1 WHERE id = $2', [created_at, created.id])
    }
  }

  it('returns everything newest-first', async () => {
    await seed()
    expect((await repo.listFeedback()).map((f) => f.authorId)).toEqual(['u4', 'u3', 'u2', 'u1'])
  })

  it('filters by status, by type, and by both together', async () => {
    await seed()
    expect((await repo.listFeedback({ status: 'open' })).map((f) => f.authorId)).toEqual(['u2', 'u1'])
    expect((await repo.listFeedback({ type: 'bug' })).map((f) => f.authorId)).toEqual(['u4', 'u2'])
    expect((await repo.listFeedback({ status: 'open', type: 'bug' })).map((f) => f.authorId)).toEqual(['u2'])
  })

  it('treats a junk status or type filter as a no-op (never 500)', async () => {
    await seed()
    expect(await repo.listFeedback({ status: 'nonsense' })).toHaveLength(4)
    expect(await repo.listFeedback({ type: 'garbage' })).toHaveLength(4)
    expect(await repo.listFeedback({ status: 'garbage', type: 'nonsense' })).toHaveLength(4)
  })

  it('returns an empty list when nothing matches the filters', async () => {
    await seed()
    expect(await repo.listFeedback({ status: 'duplicate' })).toEqual([])
    expect(await repo.listFeedback({ status: 'in_progress' })).toEqual([])
    expect(await repo.listFeedback({ status: 'done', type: 'bug' })).toEqual([])
  })

  it('returns an empty list on a fresh store', async () => {
    expect(await repo.listFeedback()).toEqual([])
  })

  it('supports limit/offset pagination as a newest-first window', async () => {
    await seed()
    const first = await repo.listFeedback({ limit: 2, offset: 0 })
    expect(first.map((f) => f.authorId)).toEqual(['u4', 'u3'])
    const second = await repo.listFeedback({ limit: 2, offset: 2 })
    expect(second.map((f) => f.authorId)).toEqual(['u2', 'u1'])
  })
})

describe('updateFeedback — admin triage (status + admin note)', () => {
  it('sets the status and returns the updated row, leaving the rest intact', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    const updated = await repo.updateFeedback(created.id, { status: 'in_progress' })
    expect(updated).toMatchObject({ id: created.id, status: 'in_progress', adminNote: '' })
    expect(updated.message).toBe(FEEDBACK.message)
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('sets the owner-only admin note without touching the status', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    const updated = await repo.updateFeedback(created.id, { adminNote: 'Chasing repro steps.' })
    expect(updated.adminNote).toBe('Chasing repro steps.')
    expect(updated.status).toBe('open')
  })

  it('sets status AND admin note together', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    const updated = await repo.updateFeedback(created.id, { status: 'done', adminNote: 'Shipped in 1.5.' })
    expect(updated.status).toBe('done')
    expect(updated.adminNote).toBe('Shipped in 1.5.')
  })

  it('clears the admin note with an empty string', async () => {
    const created = await repo.createFeedback({ ...FEEDBACK, adminNote: 'old note' })
    expect((await repo.updateFeedback(created.id, { adminNote: '' })).adminNote).toBe('')
  })

  it('is a no-op (null) for a junk id or a junk status — never 500', async () => {
    expect(await repo.updateFeedback('not-a-uuid', { status: 'done' })).toBeNull()
    const created = await repo.createFeedback(FEEDBACK)
    // Junk status makes the WHOLE update a no-op — the admin note is not saved.
    expect(await repo.updateFeedback(created.id, { status: 'garbage' })).toBeNull()
    expect(await repo.updateFeedback(created.id, { status: 'garbage', adminNote: 'nope' })).toBeNull()
    // Nothing to update is a no-op too.
    expect(await repo.updateFeedback(created.id, {})).toBeNull()
    // The row is untouched.
    expect((await repo.listFeedback())[0]).toMatchObject({ status: 'open', adminNote: '' })
  })

  it('returns null for a valid-but-unknown id', async () => {
    expect(await repo.updateFeedback('11111111-1111-1111-1111-111111111111', { status: 'done' })).toBeNull()
  })
})

describe('deleteFeedback / deleteByAuthor', () => {
  it('returns false for a junk id instead of 500ing', async () => {
    expect(await repo.deleteFeedback('not-a-uuid')).toBe(false)
  })

  it('deletes a row and reports whether a row was removed', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    expect(await repo.deleteFeedback(created.id)).toBe(true)
    expect(await repo.listFeedback()).toEqual([])
    expect(await repo.deleteFeedback(created.id)).toBe(false) // already gone
  })

  it('removes every piece of feedback the member wrote, leaving others untouched', async () => {
    await repo.createFeedback({ ...FEEDBACK, authorId: 'u1' })
    await repo.createFeedback({ ...FEEDBACK, authorId: 'u1', type: 'bug', message: 'Scanner crashes on iOS.' })
    await repo.createFeedback({ ...FEEDBACK, authorId: 'u2' })

    expect(await repo.deleteByAuthor('u1')).toBe(true)
    const remaining = await repo.listFeedback()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].authorId).toBe('u2')
    expect(await repo.deleteByAuthor('u1')).toBe(false) // nothing left to remove
  })
})

describe('transaction — BEGIN/COMMIT/ROLLBACK (parity with reviews-repo)', () => {
  it('commits the writes inside the callback atomically (pg-mem happy path)', async () => {
    await repo.transaction(async (tx) => {
      await tx.createFeedback({ ...FEEDBACK, authorId: 'u1' })
      await tx.createFeedback({ ...FEEDBACK, authorId: 'u2' })
    })
    expect(await repo.listFeedback()).toHaveLength(2)
  })

  it('issues BEGIN -> fn -> COMMIT and always releases the client', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createFeedbackRepo(memDb)
    const fn = vi.fn()

    await txRepo.transaction(fn)

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT'])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('issues BEGIN -> fn -> ROLLBACK and rethrows on error', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createFeedbackRepo(memDb)
    const boom = new Error('boom')
    const fn = vi.fn(async () => { throw boom })

    await expect(txRepo.transaction(fn)).rejects.toThrow('boom')

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
