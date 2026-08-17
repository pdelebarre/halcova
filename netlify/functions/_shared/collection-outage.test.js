// @vitest-environment node
//
// SEC-4.1 (#202, P0): a Postgres outage must NOT silently switch the data
// authority to Blobs. This drives the REAL collection.js default export (with
// DATABASE_URL set + a throwing Postgres repo) and asserts a CONTROLLED 503
// with code DATA_SOURCE_UNAVAILABLE — never silent Blobs data, never a 500
// that leaks internals.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../collection'
import { sessionTokenFor } from './session-test-helpers'
import { createBlobRepository } from './repositories/blob-repository'

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

// The Postgres repo is DOWN: every items read throws.
const { repoRef } = vi.hoisted(() => ({ repoRef: { current: null } }))
vi.mock('./repository', () => ({
  getRepository: () => repoRef.current,
}))

const USER_ID = 'u1'
let MEMBER_TOKEN = ''

function seedMember() {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = {
    id: USER_ID,
    name: 'Ada',
    email: 'ada@example.com',
    code: 'RU-AAAA-BBBB-CCCC',
    collections: { records: true, books: true },
    plan: 'free',
    role: 'member',
    status: 'active',
  }
  identity.data.set(`user:${USER_ID}`, user)
  identity.data.set('index:users', [USER_ID])
  return user
}

function req(method, path = '', auth, body) {
  return {
    method,
    url: `http://localhost/.netlify/functions/collection${path}`,
    headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? auth : null) },
    text: async () => JSON.stringify(body ?? {}),
    json: async () => body ?? {},
  }
}

beforeAll(() => {
  // Force the Postgres path (DATABASE_URL configured).
  process.env.DATABASE_URL = 'postgres://dbhost/runout'
})

afterAll(() => {
  delete process.env.DATABASE_URL
})

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  // The real blob repo provides the working sessions/users store (so auth + the
  // session token work), but `items` is swapped for a THROWING Postgres-backed
  // items repo to simulate an outage. `backend: 'postgres'` makes the handler
  // take the Postgres path. Blobs still holds collection data (what a silent
  // fallback would have served) so the test proves the outage is NOT masked.
  const base = createBlobRepository()
  repoRef.current = {
    ...base,
    backend: 'postgres',
    items: {
      listItems: vi.fn().mockRejectedValue(new Error('ECONNREFUSED postgres')),
      listItemIds: vi.fn().mockRejectedValue(new Error('ECONNREFUSED postgres')),
      countOwned: vi.fn().mockRejectedValue(new Error('ECONNREFUSED postgres')),
      getItem: vi.fn().mockRejectedValue(new Error('ECONNREFUSED postgres')),
    },
  }
  seedMember()
  MEMBER_TOKEN = await sessionTokenFor({ userId: USER_ID, role: 'member' })
  // Seed the member's Blobs collection store with data — this is what a silent
  // fallback would have served, proving the outage is NOT masked.
  const store = stores[`collection-${USER_ID}-records`] || createStore()
  stores[`collection-${USER_ID}-records`] = store
  store.data.set('index', ['blob-item'])
  store.data.set('item:blob-item', { id: 'blob-item', title: 'From Blobs', year: 1999 })
})

describe('SEC-4.1 (#202) — Postgres outage surfaces a controlled 503', () => {
  it('a GET during a Postgres outage returns 503 DATA_SOURCE_UNAVAILABLE, not silent Blobs data', async () => {
    const res = await handler(req('GET', '?collection=records', `Bearer ${MEMBER_TOKEN}`))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('DATA_SOURCE_UNAVAILABLE')
    // The outage is NOT masked by Blobs data.
    expect(body.items).toBeUndefined()
    expect(body.error).not.toContain('ECONNREFUSED')
  })

  it('a write during a Postgres outage also returns 503 (no silent Blobs fallback)', async () => {
    repoRef.current.items.transaction = vi.fn().mockRejectedValue(new Error('ECONNREFUSED postgres'))
    const res = await handler(req('POST', '?collection=records', `Bearer ${MEMBER_TOKEN}`, { title: 'X' }))
    // The cap pre-check (countOwned) rejects during the outage → controlled 503.
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('DATA_SOURCE_UNAVAILABLE')
  })
})
