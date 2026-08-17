// @vitest-environment node
//
// Blobs repository seam test: createBlobRepository() must expose the feedback
// facade on the SAME op surface as the Postgres repo (feedback-repo.js), so a
// caller like feedback.js / admin.js can't tell which backend it's on. In
// particular, `deleteByAuthor` (the member-delete feedback purge, T8 H1) must
// be wired through — a regression guard against dropping it when a new op is
// added to the feedback stores. Mirrors the Postgres-side seam test in
// postgres-repository.test.js and the direct store tests in feedback-blob.test.js.
// @netlify/blobs is an in-memory map so no site context is required.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlobRepository } from './blob-repository'

// In-memory @netlify/blobs registry (the same trick as feedback-blob.test.js /
// admin.test.js): getStore returns a per-name in-memory store, so the lazy
// feedback facade opens the shared `runout-feedback` store on first use.
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

let repo

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  repo = createBlobRepository()
})

describe('feedback seam — deleteByAuthor wiring (T8 H1 regression)', () => {
  it('exposes deleteByAuthor on the Blobs seam and it removes only the author\'s feedback', async () => {
    // The seam must stay on the same op surface as the Postgres repo
    // (feedback-repo.js). Dropping deleteByAuthor here would re-break the
    // member-delete feedback purge (T8 H1) on the Blobs path.
    expect(typeof repo.feedback.deleteByAuthor).toBe('function')

    await repo.feedback.createFeedback({
      type: 'suggestion', category: 'other', message: 'u1 msg', authorId: 'u1', authorName: 'Ada',
    })
    await repo.feedback.createFeedback({
      type: 'bug', category: 'scanner', message: 'u2 msg', authorId: 'u2', authorName: 'Bo',
    })

    expect(await repo.feedback.deleteByAuthor('u1')).toBe(true)
    const remaining = await repo.feedback.listFeedback()
    expect(remaining.map((f) => f.authorId)).toEqual(['u2'])
    // index:open only holds the survivor's id.
    const index = stores['runout-feedback'].data.get('index:open')
    expect(JSON.parse(JSON.stringify(index))).toEqual([remaining[0].id])
  })
})
