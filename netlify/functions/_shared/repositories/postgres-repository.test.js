// @vitest-environment node
//
// Repository wiring tests for the Phase 1 switch: createPostgresRepository()
// must serve reads DB-first and fall back to the Blobs impl on a miss or a DB
// error (read-through), and write to both stores (reversible dual-write) while
// degrading to Blobs-only when Postgres is unreachable. The Blobs impl is
// mocked; the Postgres repo runs on pg-mem.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemDb } from './test-helpers'
import { createPostgresRepository } from './postgres-repository'

const { blob } = vi.hoisted(() => {
  const blob = {
    findUserByCode: vi.fn(),
    getUser: vi.fn(),
    listUsers: vi.fn(),
    saveUser: vi.fn(),
    removeUserRecord: vi.fn(),
    listRequests: vi.fn(),
    getRequest: vi.fn(),
    saveRequest: vi.fn(),
    removeRequest: vi.fn(),
    findPendingRequestByEmail: vi.fn(),
    deleteUserCollections: vi.fn(),
    storeNameFor: vi.fn(),
  }
  return { blob }
})

vi.mock('./blob-users', () => blob)

const USER = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  collections: { records: true, books: true },
  features: { lending: true },
  plan: 'free',
  role: 'member',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createPostgresRepository({ db })
  for (const fn of Object.values(blob)) fn.mockReset()
})

describe('createPostgresRepository — shape', () => {
  it('builds a postgres-backed repository with users, items and lookupCache', () => {
    expect(repo.backend).toBe('postgres')
    expect(repo.users).toBeTruthy()
    expect(repo.items).toBeTruthy()
    expect(repo.lookupCache).toBeTruthy()
  })
})

describe('read-through fallback (reads DB first, Blobs on miss/error)', () => {
  it('serves a user from Postgres without touching Blobs when the row exists', async () => {
    await repo.users.saveUser(USER)
    const user = await repo.users.getUser('u1')
    expect(user.id).toBe('u1')
    expect(blob.getUser).not.toHaveBeenCalled()
  })

  it('falls back to Blobs when Postgres misses (not-yet-backfilled)', async () => {
    blob.getUser.mockResolvedValue({ id: 'blob-user', name: 'From Blobs' })
    const user = await repo.users.getUser('not-in-db')
    expect(user).toEqual({ id: 'blob-user', name: 'From Blobs' })
    expect(blob.getUser).toHaveBeenCalledWith('not-in-db')
  })

  it('falls back to Blobs when a Postgres read errors (DB down)', async () => {
    const broken = createPostgresRepository({
      db: { query: vi.fn(async () => { throw new Error('db down') }), connect: vi.fn() },
    })
    blob.findUserByCode.mockResolvedValue({ id: 'u1', name: 'Ada' })
    const user = await broken.users.findUserByCode('RU-AAAA-BBBB-CCCC')
    expect(user).toMatchObject({ id: 'u1' })
    expect(blob.findUserByCode).toHaveBeenCalledWith('RU-AAAA-BBBB-CCCC')
  })

  it('falls back to Blobs for an empty list result', async () => {
    blob.listUsers.mockResolvedValue([{ id: 'blob-only' }])
    expect(await repo.users.listUsers()).toEqual([{ id: 'blob-only' }])
    expect(blob.listUsers).toHaveBeenCalled()

    blob.listUsers.mockClear()
    await repo.users.saveUser(USER) // Postgres now has a row
    expect((await repo.users.listUsers()).map((u) => u.id)).toEqual(['u1'])
    expect(blob.listUsers).not.toHaveBeenCalled()
  })

  it('falls back to Blobs for findPendingRequestByEmail on a miss', async () => {
    blob.findPendingRequestByEmail.mockResolvedValue({ id: 'r-blob' })
    expect(await repo.users.findPendingRequestByEmail('ada@example.com')).toEqual({ id: 'r-blob' })
    expect(blob.findPendingRequestByEmail).toHaveBeenCalledWith('ada@example.com')
  })
})

describe('reversible write-through (Postgres primary + Blobs mirror)', () => {
  it('writes a user to Postgres AND mirrors it to Blobs', async () => {
    await repo.users.saveUser(USER)
    expect(blob.saveUser).toHaveBeenCalledWith(USER)
    // And the Postgres copy is independently readable.
    expect((await repo.users.getUser('u1')).id).toBe('u1')
  })

  it('degrades to a Blobs-only write when Postgres is unreachable (writes never fail)', async () => {
    const broken = createPostgresRepository({
      db: { query: vi.fn(async () => { throw new Error('db down') }), connect: vi.fn() },
    })
    blob.saveUser.mockResolvedValue(undefined)
    await expect(broken.users.saveUser(USER)).resolves.toBeUndefined()
    expect(blob.saveUser).toHaveBeenCalledWith(USER)
  })

  it('mirrors a request save to Blobs', async () => {
    const req = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T00:00:00.000Z' }
    await repo.users.saveRequest(req)
    expect(blob.saveRequest).toHaveBeenCalledWith(req)
  })
})
