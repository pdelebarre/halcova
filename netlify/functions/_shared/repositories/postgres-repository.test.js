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
    findUserByEmail: vi.fn(),
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

  it('still degrades a NON-auth write (requests) to a Blobs-only write when Postgres is unreachable', async () => {
    // Auth writes now fail closed (see the M1 block below); reversible
    // non-auth writes (requests, items) keep degrading so they never fail.
    const broken = createPostgresRepository({
      db: { query: vi.fn(async () => { throw new Error('db down') }), connect: vi.fn() },
    })
    const req = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T00:00:00.000Z' }
    blob.saveRequest.mockResolvedValue(undefined)
    await expect(broken.users.saveRequest(req)).resolves.toBeUndefined()
    expect(blob.saveRequest).toHaveBeenCalledWith(req)
  })

  it('mirrors a request save to Blobs', async () => {
    const req = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T00:00:00.000Z' }
    await repo.users.saveRequest(req)
    expect(blob.saveRequest).toHaveBeenCalledWith(req)
  })
})

describe('M1 — fail-closed auth writes + auth-prefers-Postgres reads', () => {
  it('fail-closes a rotate when the Blobs mirror fails: the new code is NOT stored, nothing is half-applied', async () => {
    await repo.users.saveUser(USER)
    blob.saveUser.mockRejectedValue(new Error('blobs unavailable'))
    await expect(repo.users.saveUser({ ...USER, code: 'RU-NEWW-NEWW-NEWW' })).rejects.toThrow(/Auth write failed/)

    // Postgres was rolled back — the NEW code must not authenticate…
    expect(await repo.users.findUserByCode('RU-NEWW-NEWW-NEWW')).toBeNull()
    // …and the OLD code still does (the rotation never took effect; the admin
    // was told with a 5xx and can retry). Status quo, never a half-apply.
    expect(await repo.users.findUserByCode(USER.code)).toMatchObject({ id: 'u1' })
  })

  it('after a successful rotate the OLD code is dead for auth even if the Blobs mirror is stale', async () => {
    await repo.users.saveUser(USER)
    await repo.users.saveUser({ ...USER, code: 'RU-NEWW-NEWW-NEWW' })

    // Simulate the M1 hazard: the mirror still answers with the OLD (revoked)
    // code as if the rotation never happened.
    blob.findUserByCode.mockResolvedValue({ ...USER, code: USER.code })

    // Auth is Postgres-authoritative: the old code is a record-miss → rejected,
    // and the stale mirror is never consulted (regardless of mirror state).
    expect(await repo.users.findUserByCode(USER.code)).toBeNull()
    expect(blob.findUserByCode).not.toHaveBeenCalled()
    // The NEW code still resolves from Postgres.
    expect(await repo.users.findUserByCode('RU-NEWW-NEWW-NEWW')).toMatchObject({ id: 'u1' })
  })

  it('fail-closes a disable when the Blobs mirror fails: the status change is rolled back', async () => {
    await repo.users.saveUser(USER)
    blob.saveUser.mockRejectedValue(new Error('blobs unavailable'))
    await expect(repo.users.saveUser({ ...USER, status: 'disabled' })).rejects.toThrow(/Auth write failed/)

    // Rolled back — the member is still ACTIVE in Postgres (the disable did not
    // take effect; the admin saw a 5xx and can retry). No half-applied disable.
    expect(await repo.users.findUserByCode(USER.code)).toMatchObject({ id: 'u1', status: 'active' })
  })

  it('a disabled member cannot authenticate even when the Blobs mirror is stale-active', async () => {
    await repo.users.saveUser(USER)
    await repo.users.saveUser({ ...USER, status: 'disabled' })

    // Poison the mirror: it still answers with an ACTIVE member holding the code.
    blob.findUserByCode.mockResolvedValue({ ...USER, status: 'active', code: USER.code })

    // Postgres is authoritative: the DISABLED record is served — the caller
    // (authorize) rejects status !== 'active'. The stale-active mirror is
    // never consulted.
    const found = await repo.users.findUserByCode(USER.code)
    expect(found).toMatchObject({ id: 'u1', status: 'disabled' })
    expect(blob.findUserByCode).not.toHaveBeenCalled()
  })

  it('fail-closes deleteUser when the Blobs mirror delete fails', async () => {
    await repo.users.saveUser(USER)
    blob.removeUserRecord.mockRejectedValue(new Error('blobs unavailable'))
    await expect(repo.users.removeUserRecord('u1')).rejects.toThrow(/Auth write failed/)

    // Rolled back — the member still exists and can still authenticate.
    expect(await repo.users.findUserByCode(USER.code)).toMatchObject({ id: 'u1' })
  })

  it('fail-closes an auth write when Postgres is unreachable (never degrades to a Blobs-only write)', async () => {
    const broken = createPostgresRepository({
      db: {
        query: vi.fn(async () => { throw new Error('db down') }),
        connect: vi.fn(async () => { throw new Error('db down') }),
      },
    })
    blob.saveUser.mockResolvedValue(undefined)
    await expect(broken.users.saveUser(USER)).rejects.toThrow()
    // No Blobs-only fallback — a code/status change can't split across stores
    // while Postgres is down.
    expect(blob.saveUser).not.toHaveBeenCalled()
  })

  it('still falls back to the Blobs mirror on a true DB unavailability during auth (outage never locks members out)', async () => {
    const broken = createPostgresRepository({
      db: { query: vi.fn(async () => { throw new Error('db down') }), connect: vi.fn() },
    })
    blob.findUserByCode.mockResolvedValue({ id: 'u1', name: 'Ada' })
    expect(await broken.users.findUserByCode('RU-AAAA-BBBB-CCCC')).toMatchObject({ id: 'u1' })
    expect(blob.findUserByCode).toHaveBeenCalledWith('RU-AAAA-BBBB-CCCC')
  })
})
