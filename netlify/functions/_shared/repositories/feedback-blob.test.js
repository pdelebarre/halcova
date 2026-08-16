// @vitest-environment node
//
// Blobs fallback feedback store tests with an in-memory @netlify/blobs-shaped
// store (no site context needed). Covers the SHARED `runout-feedback` layout
// (`fb:<id>` -> feedback object, `index:open` -> the inbox enumeration),
// create / list / update / deleteFeedback with the T1 allow-lists and clamping
// (junk type → 'suggestion', junk status → no-op update, junk id never 500s),
// newest-first inbox ordering + status/type filters + pagination, and
// deleteByAuthor (member deletion cleanup). The ops mirror feedback-repo.js
// exactly so the future feedback.js function can pick the Postgres or Blobs
// path like collection.js does.

import { beforeEach, describe, expect, it } from 'vitest'
import { createFeedbackBlobStore } from '../feedback-blob'

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

let store
let repo

beforeEach(async () => {
  store = createMemStore()
  repo = createFeedbackBlobStore({ store })
})

describe('createFeedback', () => {
  it('creates a feedback, returns it with a server-assigned uuid id + defaults, and writes the shared layout', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    expect(created).toMatchObject({ ...FEEDBACK, status: 'open', adminNote: '' })
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Shared store layout: the feedback object at `fb:<id>` and the inbox
    // enumeration `index:open` holding its id.
    const raw = store._raw()
    expect(JSON.parse(raw[`fb:${created.id}`])).toMatchObject({ ...FEEDBACK, status: 'open', adminNote: '' })
    expect(JSON.parse(raw['index:open'])).toEqual([created.id])
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

  // The message length CHECK (1–4000) is enforced by the Postgres DATABASE in
  // T1; on the Blobs path there is no such gate and the store trusts the
  // validated input (the future feedback.js function validates `message`
  // before it reaches the repo). A full-length message round-trips untouched —
  // never truncated.
  it('round-trips a message of exactly 4000 chars', async () => {
    const created = await repo.createFeedback({ ...FEEDBACK, message: 'x'.repeat(4000) })
    expect(created.message).toHaveLength(4000)
  })

  it('keeps every submission in the index:open inbox enumeration', async () => {
    await repo.createFeedback(FEEDBACK)
    await repo.createFeedback({ ...FEEDBACK, authorId: 'u2', type: 'bug' })
    const ids = JSON.parse(store._raw()['index:open'])
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(store._raw()[`fb:${id}`]).toBeDefined()
  })
})

describe('listFeedback — newest first + status/type filters + pagination', () => {
  // Deterministic order: explicit, distinct created_at per author (newest
  // first is u4 → u3 → u2 → u1) so the sort never depends on the store's
  // now() resolution within a test.
  async function seed() {
    const rows = [
      ['u1', '2026-01-01T00:00:00.000Z', 'suggestion', 'open'],
      ['u2', '2026-01-02T00:00:00.000Z', 'bug', 'open'],
      ['u3', '2026-01-03T00:00:00.000Z', 'suggestion', 'done'],
      ['u4', '2026-01-04T00:00:00.000Z', 'bug', 'wontfix'],
    ]
    for (const [authorId, createdAt, type, status] of rows) {
      const created = await repo.createFeedback({ ...FEEDBACK, authorId, type, status })
      const data = JSON.parse(store._raw()[`fb:${created.id}`])
      data.createdAt = createdAt
      await store.setJSON(`fb:${created.id}`, data)
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
  it('sets the status and returns the updated object, leaving the rest intact', async () => {
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
    // The object is untouched.
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

  it('deletes a feedback, cleans the inbox index, and reports success', async () => {
    const created = await repo.createFeedback(FEEDBACK)
    expect(await repo.deleteFeedback(created.id)).toBe(true)
    expect(store._raw()[`fb:${created.id}`]).toBeUndefined()
    expect(JSON.parse(store._raw()['index:open'])).toEqual([])
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
    // The index only holds the survivor's id.
    const ids = JSON.parse(store._raw()['index:open'])
    expect(ids).toHaveLength(1)
    expect(store._raw()[`fb:${ids[0]}`]).toBeDefined()
    expect(await repo.deleteByAuthor('u1')).toBe(false) // nothing left to remove
  })
})

describe('index:open — the inbox enumeration', () => {
  it('stays in sync across create / delete / deleteByAuthor', async () => {
    const a = await repo.createFeedback(FEEDBACK)
    const b = await repo.createFeedback({ ...FEEDBACK, authorId: 'u2', type: 'bug' })
    expect(JSON.parse(store._raw()['index:open']).sort()).toEqual([a.id, b.id].sort())

    await repo.deleteFeedback(a.id)
    expect(JSON.parse(store._raw()['index:open'])).toEqual([b.id])

    await repo.deleteByAuthor('u2')
    expect(JSON.parse(store._raw()['index:open'])).toEqual([])
  })

  it('skips a missing fb: blob behind a stale index entry instead of 500ing', async () => {
    // Simulate a stale index: the second id has no matching `fb:` blob.
    store.setJSON('fb:00000000-0000-0000-0000-000000000001', {
      ...FEEDBACK,
      id: '00000000-0000-0000-0000-000000000001',
      status: 'open',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    store.setJSON('index:open', [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002', // no matching blob — stale
    ])

    const list = await repo.listFeedback()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('00000000-0000-0000-0000-000000000001')
  })
})
