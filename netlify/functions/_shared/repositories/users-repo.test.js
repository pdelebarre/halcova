// @vitest-environment node
//
// Users/requests repository tests against pg-mem with the REAL migrations
// (001 + 002) applied. Covers the identity repo surface: save/get/list/remove
// users with the exact blob shape (plan default 'free', features/collections
// jsonb, createdAt), the O(1) code_hash lookup (case/whitespace-insensitive),
// request CRUD + deduped pending lookup by email, and Part B's hashing: the
// plaintext `code` column is dropped (migration 002) so a Postgres-backed user
// never returns `code` (or `code_hash`).

import { beforeEach, describe, expect, it } from 'vitest'
import { createUsersRepo, codeHashFor, hashCode } from './users-repo'
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

describe('hashCode — sha256 of the normalized code', () => {
  it('hashes the SAME normalizeCode (trim + uppercase) so lookups ignore how a code was typed', () => {
    expect(hashCode('  ru-aaaa-bbbb-cccc  ')).toBe(hashCode('RU-AAAA-BBBB-CCCC'))
    // auth.js uppercases before findUserByCode; hashCode normalizes too, so
    // both paths resolve to the identical hash.
    expect(hashCode('RU-AAAA-BBBB-CCCC'.toUpperCase())).toBe(hashCode('RU-AAAA-BBBB-CCCC'))
    expect(hashCode('RU-AAAA-BBBB-CCCC')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null for an empty / missing code', () => {
    expect(hashCode('')).toBeNull()
    expect(hashCode(null)).toBeNull()
    expect(hashCode(undefined)).toBeNull()
  })

  it('differs for different codes (sha256 collision resistance)', () => {
    expect(hashCode('RU-AAAA-BBBB-CCCC')).not.toBe(hashCode('RU-AAAA-BBBB-CCCD'))
  })
})

describe('saveUser / getUser / listUsers — hashed code, exact blob shape otherwise', () => {
  it('round-trips the full member shape WITHOUT the plaintext code, and stores the hash', async () => {
    await repo.saveUser(MEMBER)
    const got = await repo.getUser('u1')
    // A Postgres-backed user never carries `code` (or `code_hash`) — the
    // client only ever holds the code it was issued.
    expect(got).toEqual({ ...MEMBER, code: undefined })
    expect(got).not.toHaveProperty('code_hash')
    expect(got.plan).toBe('free')
    expect(got.features).toEqual({ lending: true })
    expect(got.collections).toEqual({ records: true, books: true })

    // The DB row stores only the sha256 hash under the unique index.
    const { rows } = await db.query('SELECT code_hash FROM users WHERE id = $1', ['u1'])
    expect(rows[0].code_hash).toBe(codeHashFor(MEMBER.code))
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
    expect(users.every((u) => !('code' in u) && !('code_hash' in u))).toBe(true)
    expect(await repo.getUser('nope')).toBeNull()
  })

  it('preserves the existing code_hash when an update carries no new code', async () => {
    await repo.saveUser(MEMBER)
    const before = (await db.query('SELECT code_hash FROM users WHERE id = $1', ['u1'])).rows[0].code_hash
    await repo.saveUser({ ...MEMBER, code: undefined, collections: { records: true, books: false } })
    const got = await repo.getUser('u1')
    expect(got.collections).toEqual({ records: true, books: false })
    expect(got).not.toHaveProperty('code')
    const after = (await db.query('SELECT code_hash FROM users WHERE id = $1', ['u1'])).rows[0].code_hash
    expect(after).toBe(before)
  })

  it('updates the hash when a new code is saved (rotation)', async () => {
    await repo.saveUser(MEMBER)
    await repo.saveUser({ ...MEMBER, code: 'RU-NEWW-NEWW-NEWW' })
    // The OLD code no longer resolves, the NEW one does.
    expect(await repo.findUserByCode(MEMBER.code)).toBeNull()
    expect(await repo.findUserByCode('RU-NEWW-NEWW-NEWW')).toMatchObject({ id: 'u1' })
  })
})

describe('findUserByCode — O(1) code_hash lookup', () => {
  it('finds a member by their code through the unique code_hash', async () => {
    await repo.saveUser(MEMBER)
    const user = await repo.findUserByCode('RU-AAAA-BBBB-CCCC')
    expect(user).toMatchObject({ id: 'u1', name: 'Ada' })
    expect(user).not.toHaveProperty('code')
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
