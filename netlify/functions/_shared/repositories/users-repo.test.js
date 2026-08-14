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
    // client only ever holds the code it was issued. The S2 nullable billing
    // fields default to null (columns don't exist until S3's migration), so
    // the read shape matches the Blobs normalizeUser exactly.
    expect(got).toEqual({
      ...MEMBER,
      code: undefined,
      planExpiresAt: null,
      planChangedAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
    })
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

  it('defaults the S2 nullable billing fields to null on rows without them (no migration)', async () => {
    // The S3 columns don't exist yet — a Postgres row reads back with every
    // new field null, exactly like the Blobs normalizeUser, so old rows read
    // cleanly across both backends (ADR-0003 §2.3).
    await repo.saveUser(MEMBER)
    const got = await repo.getUser('u1')
    expect(got.planExpiresAt).toBeNull()
    expect(got.planChangedAt).toBeNull()
    expect(got.stripeCustomerId).toBeNull()
    expect(got.stripeSubscriptionId).toBeNull()
    expect(got.stripeCheckoutSessionId).toBeNull()
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

// ---- S3 billing columns + webhook idempotency (migration 003) --------------

describe('S3 billing fields — round-trip, preserve-on-undefined, Stripe lookups', () => {
  const BILLED = {
    ...MEMBER,
    plan: 'premium',
    planExpiresAt: '2027-08-14T00:00:00.000Z',
    planChangedAt: '2026-08-14T00:00:00.000Z',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_1',
    stripeCheckoutSessionId: 'cs_test_1',
  }

  it('round-trips the billing columns through the real 003 migration', async () => {
    await repo.saveUser(BILLED)
    const got = await repo.getUser('u1')
    expect(got.planExpiresAt).toBe('2027-08-14T00:00:00.000Z')
    expect(got.planChangedAt).toBe('2026-08-14T00:00:00.000Z')
    expect(got.stripeCustomerId).toBe('cus_123')
    expect(got.stripeSubscriptionId).toBe('sub_1')
    expect(got.stripeCheckoutSessionId).toBe('cs_test_1')
    // Still never leaks the code / hash.
    expect(got).not.toHaveProperty('code')
    expect(got).not.toHaveProperty('code_hash')
  })

  it('preserves existing billing fields on an update that does not carry them (undefined = keep)', async () => {
    await repo.saveUser(BILLED)
    // An admin update touching only collections must NOT wipe the billing ids.
    await repo.saveUser({ ...BILLED, collections: { records: true, books: false }, planExpiresAt: undefined, stripeSubscriptionId: undefined })
    const got = await repo.getUser('u1')
    expect(got.collections).toEqual({ records: true, books: false })
    expect(got.stripeSubscriptionId).toBe('sub_1')
    expect(got.stripeCustomerId).toBe('cus_123')
    expect(got.stripeCheckoutSessionId).toBe('cs_test_1')
    expect(got.planExpiresAt).toBe('2027-08-14T00:00:00.000Z')
  })

  it('clears a billing field on an explicit null (subscription.deleted downgrade)', async () => {
    await repo.saveUser(BILLED)
    await repo.saveUser({ ...BILLED, plan: 'free', planExpiresAt: null })
    const got = await repo.getUser('u1')
    expect(got.plan).toBe('free')
    expect(got.planExpiresAt).toBeNull()
    // The billing ids survive the downgrade (idempotency + the portal).
    expect(got.stripeSubscriptionId).toBe('sub_1')
    expect(got.stripeCustomerId).toBe('cus_123')
  })

  it('resolves a user by checkout session id (O(1) unique index)', async () => {
    await repo.saveUser(BILLED)
    expect(await repo.findUserByStripeSession('cs_test_1')).toMatchObject({ id: 'u1', plan: 'premium' })
    expect(await repo.findUserByStripeSession('cs_nope')).toBeNull()
    expect(await repo.findUserByStripeSession('')).toBeNull()
  })

  it('resolves a user by subscription id (O(1) unique index)', async () => {
    await repo.saveUser(BILLED)
    expect(await repo.findUserByStripeSubscription('sub_1')).toMatchObject({ id: 'u1' })
    expect(await repo.findUserByStripeSubscription('sub_nope')).toBeNull()
  })

  it('the unique session index rejects a second user claiming the same session id', async () => {
    await repo.saveUser(BILLED)
    // A racing webhook delivery must not create a second account for the same
    // checkout session — the unique index (003) makes the insert fail.
    await expect(repo.saveUser({ ...BILLED, id: 'u2', email: 'other@example.com' })).rejects.toThrow()
  })
})

// ---- S8 one-time code delivery (migration 004) ------------------------------

describe('codeDelivered — one-time access-code delivery flag (S8, #54)', () => {
  it('round-trips false (pending) -> true (delivered) and preserves it on unrelated updates', async () => {
    // A brand-new prospect is materialized with codeDelivered: false — the
    // status poll delivers the code exactly once, then flips it to true.
    await repo.saveUser({ ...MEMBER, codeDelivered: false })
    expect((await repo.getUser('u1')).codeDelivered).toBe(false)

    await repo.saveUser({ ...(await repo.getUser('u1')), codeDelivered: true })
    expect((await repo.getUser('u1')).codeDelivered).toBe(true)

    // Preserve-on-undefined: an unrelated update must not wipe the marker.
    await repo.saveUser({ ...(await repo.getUser('u1')), codeDelivered: undefined, collections: { records: true, books: false } })
    const got = await repo.getUser('u1')
    expect(got.codeDelivered).toBe(true)
    expect(got.collections).toEqual({ records: true, books: false })
  })

  it('reads a row with no code_delivered as undefined (not-yet-delivered)', async () => {
    // MEMBER carries no codeDelivered -> the column stays NULL (migration 004
    // is nullable + additive), and the read treats it as "not yet delivered"
    // so a pre-004 row still delivers its code once.
    await repo.saveUser(MEMBER)
    expect((await repo.getUser('u1')).codeDelivered).toBeUndefined()
  })
})
