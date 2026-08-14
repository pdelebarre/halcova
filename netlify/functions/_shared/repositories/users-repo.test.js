// @vitest-environment node
//
// Users/requests repository tests against pg-mem with the REAL migration
// applied. Covers the identity repo surface: save/get/list/remove users with
// the exact blob shape (plan default 'free', features/collections jsonb,
// createdAt), the O(1) code_hash lookup (case/whitespace-insensitive), request
// CRUD + deduped pending lookup by email, and the interim plaintext `code`
// column (Part B hashes + rotates).

import { beforeEach, describe, expect, it } from 'vitest'
import { createUsersRepo, codeHashFor } from './users-repo'
import { createMemDb } from './test-helpers'

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  collections: { records: true, books: true },
  features: { lending: true },
  plan: 'free',
  role: 'member',
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createUsersRepo(db)
})

describe('saveUser / getUser / listUsers — exact blob shape', () => {
  it('round-trips the full member shape (code, collections, features, plan, createdAt)', async () => {
    await repo.saveUser(MEMBER)
    const got = await repo.getUser('u1')
    expect(got).toEqual(MEMBER)
    expect(got.plan).toBe('free')
    expect(got.features).toEqual({ lending: true })
    expect(got.collections).toEqual({ records: true, books: true })
  })

  it('defaults plan to free and features/collections to empty objects when absent', async () => {
    await repo.saveUser({ id: 'u2', name: 'Bob', email: 'bob@example.com', code: 'RU-BBBB-CCCC-DDDD' })
    const got = await repo.getUser('u2')
    expect(got.plan).toBe('free')
    expect(got.features).toEqual({})
    expect(got.collections).toEqual({})
  })

  it('lists users and returns null for a missing id', async () => {
    await repo.saveUser(MEMBER)
    await repo.saveUser({ id: 'u2', name: 'Bob', code: 'RU-BBBB-CCCC-DDDD' })
    const users = await repo.listUsers()
    expect(users.map((u) => u.id).sort()).toEqual(['u1', 'u2'])
    expect(await repo.getUser('nope')).toBeNull()
  })

  it('preserves the existing code_hash when an update carries no new code', async () => {
    await repo.saveUser(MEMBER)
    await repo.saveUser({ ...MEMBER, collections: { records: true, books: false } })
    const got = await repo.getUser('u1')
    expect(got.code).toBe(MEMBER.code)
    expect(got.collections).toEqual({ records: true, books: false })
  })
})

describe('findUserByCode — O(1) code_hash lookup', () => {
  it('finds a member by their code through the unique code_hash', async () => {
    await repo.saveUser(MEMBER)
    const user = await repo.findUserByCode('RU-AAAA-BBBB-CCCC')
    expect(user).toMatchObject({ id: 'u1', name: 'Ada' })
  })

  it('is case/whitespace insensitive (normalizes inside, like the blob path)', async () => {
    await repo.saveUser(MEMBER)
    expect(await repo.findUserByCode('  ru-aaaa-bbbb-cccc  ')).toMatchObject({ id: 'u1' })
  })

  it('returns null for an unknown/empty code', async () => {
    await repo.saveUser(MEMBER)
    expect(await repo.findUserByCode('RU-NOPE-NOPE-NOPE')).toBeNull()
    expect(await repo.findUserByCode('')).toBeNull()
    expect(await repo.findUserByCode(null)).toBeNull()
  })

  it('stores the canonical sha256 hash under a unique index (Part B ready)', async () => {
    await repo.saveUser(MEMBER)
    const { rows } = await db.query('SELECT code_hash FROM users WHERE id = $1', ['u1'])
    expect(rows[0].code_hash).toBe(codeHashFor(MEMBER.code))
  })
})

describe('removeUserRecord', () => {
  it('deletes the user row', async () => {
    await repo.saveUser(MEMBER)
    expect(await repo.removeUserRecord('u1')).toBe(true)
    expect(await repo.getUser('u1')).toBeNull()
    expect(await repo.removeUserRecord('u1')).toBe(false)
  })
})

describe('requests — save/list/get/remove/findPendingRequestByEmail', () => {
  const REQ = {
    id: 'r1',
    name: 'Ada',
    email: 'ADA@Example.com ',
    status: 'pending',
    createdAt: '2026-08-02T09:00:00.000Z',
  }

  it('round-trips the request shape and lists it', async () => {
    await repo.saveRequest(REQ)
    expect(await repo.getRequest('r1')).toEqual(REQ)
    expect(await repo.listRequests()).toEqual([REQ])
  })

  it('preserves approvedAt/rejectedAt on approve/reject (full data jsonb)', async () => {
    await repo.saveRequest(REQ)
    await repo.saveRequest({ ...REQ, status: 'approved', approvedAt: '2026-08-03T09:00:00.000Z' })
    expect(await repo.getRequest('r1')).toMatchObject({ status: 'approved', approvedAt: '2026-08-03T09:00:00.000Z' })
  })

  it('finds a pending request by email case/whitespace-insensitively', async () => {
    await repo.saveRequest(REQ)
    await repo.saveRequest({ ...REQ, id: 'r2', email: 'bob@example.com', status: 'rejected' })
    expect(await repo.findPendingRequestByEmail('ada@example.com')).toMatchObject({ id: 'r1' })
    expect(await repo.findPendingRequestByEmail('  ADA@EXAMPLE.COM ')).toMatchObject({ id: 'r1' })
    // Only pending requests match — the rejected one is excluded.
    expect(await repo.findPendingRequestByEmail('bob@example.com')).toBeNull()
    expect(await repo.findPendingRequestByEmail('')).toBeNull()
  })

  it('removes a request', async () => {
    await repo.saveRequest(REQ)
    expect(await repo.removeRequest('r1')).toBe(true)
    expect(await repo.listRequests()).toEqual([])
  })
})
