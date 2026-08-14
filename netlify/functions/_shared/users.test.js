// @vitest-environment node
//
// Direct tests for the O(1) access-code index (T1, ADR-0002 Phase 0) in
// _shared/users.js: findUserByCode must resolve through a single `code:<norm>`
// blob read (no O(n) scan), lazily backfill pre-Phase-0 stores, and saveUser /
// removeUserRecord must keep the index in sync. @netlify/blobs is mocked as an
// in-memory map.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findUserByCode, getUser, removeUserRecord, saveUser } from './users'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      gets: [],
      async get(key) {
        this.gets.push(String(key))
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

// Get (or lazily create) the identity store — the @netlify/blobs mock creates
// stores on first access, so the test helper mirrors that.
const identity = () => {
  if (!stores['runout-identity']) stores['runout-identity'] = createStore()
  return stores['runout-identity']
}

// Insert a user record. With `withIndex` also writes the `code:<norm>` entry
// (the Phase-0 layout); without it, simulates a pre-Phase-0 store that only
// has the user record + list index.
function seedUser(user, { withIndex = true } = {}) {
  const store = identity()
  if (withIndex) store.data.set(`code:${user.code}`, user.id)
  store.data.set(`user:${user.id}`, user)
  const ids = store.data.get('index:users') || []
  if (!ids.includes(user.id)) store.data.set('index:users', [...ids, user.id])
  return user
}

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  collections: { records: true, books: true },
  plan: 'free',
  role: 'member',
  status: 'active',
}

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
})

describe('findUserByCode — O(1) code index (T1)', () => {
  it('resolves a user through the code index with a single read — no index:users scan', async () => {
    seedUser(MEMBER)
    const store = identity()

    const user = await findUserByCode('RU-AAAA-BBBB-CCCC')
    expect(user).toMatchObject({ id: 'u1', name: 'Ada' })
    // The code index was read; the O(n) scan path was NOT touched.
    expect(store.gets).toContain('code:RU-AAAA-BBBB-CCCC')
    expect(store.gets).not.toContain('index:users')
  })

  it('is case/whitespace insensitive because the code is normalized inside', async () => {
    seedUser(MEMBER)
    expect(await findUserByCode('  ru-aaaa-bbbb-cccc  ')).toMatchObject({ id: 'u1' })
  })

  it('returns null for an unknown code', async () => {
    seedUser(MEMBER)
    expect(await findUserByCode('RU-NOPE-NOPE-NOPE')).toBeNull()
  })

  it('returns null for an empty code without touching the store', async () => {
    seedUser(MEMBER)
    const store = identity()
    expect(await findUserByCode('')).toBeNull()
    expect(await findUserByCode(null)).toBeNull()
    expect(await findUserByCode(undefined)).toBeNull()
    expect(store.gets).toHaveLength(0)
  })

  it('lazily backfills a missing index entry from the O(n) scan and writes it', async () => {
    // Pre-Phase-0 store: the user exists but there is no `code:` index entry.
    seedUser(MEMBER, { withIndex: false })
    const store = identity()

    const user = await findUserByCode('RU-AAAA-BBBB-CCCC')
    expect(user).toMatchObject({ id: 'u1' })
    // The scan found the match and persisted the index entry for next time.
    expect(store.gets).toContain('index:users')
    expect(store.data.get('code:RU-AAAA-BBBB-CCCC')).toBe('u1')
  })

  it('falls back to the scan when the index entry is stale (points at a user with a different code)', async () => {
    seedUser({ ...MEMBER, code: 'RU-NEW-NEW-NEW' })
    const store = identity()
    store.data.set('code:RU-OLD-OLD-OLD', 'u1') // stale entry left by a code rotation

    expect(await findUserByCode('RU-OLD-OLD-OLD')).toBeNull()
    // The real code still resolves through the fresh index entry.
    expect(await findUserByCode('RU-NEW-NEW-NEW')).toMatchObject({ id: 'u1' })
  })

  it('normalizes a missing plan field to free so reads always expose the plan', async () => {
    seedUser({ ...MEMBER, plan: undefined })
    expect((await findUserByCode('RU-AAAA-BBBB-CCCC')).plan).toBe('free')
  })

  it('getUser also normalizes the plan field', async () => {
    seedUser({ ...MEMBER, plan: undefined })
    expect((await getUser('u1')).plan).toBe('free')
  })
})

describe('saveUser — keeps the code index in sync', () => {
  it('writes the code index and user-list index when creating a user with a code', async () => {
    const store = identity()
    await saveUser({ id: 'u2', name: 'Bob', code: 'RU-BBBB-CCCC-DDDD' })

    expect(store.data.get('code:RU-BBBB-CCCC-DDDD')).toBe('u2')
    expect(store.data.get('index:users')).toContain('u2')
    expect(store.data.get('user:u2')).toMatchObject({ id: 'u2' })
  })

  it('drops the old index key and writes the new one when a code changes', async () => {
    const store = identity()
    await saveUser({ id: 'u2', name: 'Bob', code: 'RU-OLD-CODE-1111' })
    expect(store.data.get('code:RU-OLD-CODE-1111')).toBe('u2')

    await saveUser({ id: 'u2', name: 'Bob', code: 'RU-NEW-CODE-2222' })
    expect(store.data.get('code:RU-NEW-CODE-2222')).toBe('u2')
    expect(store.data.has('code:RU-OLD-CODE-1111')).toBe(false)
  })

  it('skips the index entirely for users without a code (e.g. the owner is never stored)', async () => {
    const store = identity()
    await saveUser({ id: 'u3', name: 'NoCode' })

    expect(store.data.get('user:u3')).toMatchObject({ id: 'u3' })
    expect([...store.data.keys()].some((k) => k.startsWith('code:'))).toBe(false)
  })
})

describe('removeUserRecord — removes the code index too', () => {
  it('deletes the user, the code index and the user-list entry', async () => {
    const store = identity()
    await saveUser({ id: 'u4', name: 'Doomed', code: 'RU-DELETE-3333' })
    expect(store.data.get('code:RU-DELETE-3333')).toBe('u4')

    await removeUserRecord('u4')
    expect(store.data.has('user:u4')).toBe(false)
    expect(store.data.has('code:RU-DELETE-3333')).toBe(false)
    expect(store.data.get('index:users')).not.toContain('u4')
  })
})
