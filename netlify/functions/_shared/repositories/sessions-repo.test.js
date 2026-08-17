// @vitest-environment node
//
// Postgres sessions repository tests (SEC-EPIC-1, #176) — driven through
// pg-mem with the REAL migration SQL applied (including 007_sessions.sql), so
// the sessions table + indexes are exercised on every run. Covers create /
// get-by-hash / revoke-once / revoke-all / delete-all, and the invariant that
// only the token HASH is stored (never the raw token).

import { beforeEach, describe, expect, it } from 'vitest'
import { createSessionsRepo } from './sessions-repo'
import { createMemDb } from './test-helpers'

const SESSION = {
  tokenHash: 'a'.repeat(64),
  userId: 'u1',
  role: 'member',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createSessionsRepo(db)
})

describe('sessions table (migration 007)', () => {
  it('creates the table and unique token_hash primary key', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`,
    )
    const cols = rows.map((r) => r.column_name).sort()
    expect(cols).toEqual(['created_at', 'expires_at', 'revoked_at', 'role', 'status', 'token_hash', 'user_id'])
  })

  it('saves and reads a session by token hash (raw token never stored)', async () => {
    await repo.save(SESSION)
    const got = await repo.getByTokenHash(SESSION.tokenHash)
    expect(got).toMatchObject({
      tokenHash: SESSION.tokenHash,
      userId: 'u1',
      role: 'member',
      status: 'active',
    })
    expect(new Date(got.expiresAt).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('returns null for an unknown token hash', async () => {
    expect(await repo.getByTokenHash('f'.repeat(64))).toBeNull()
    expect(await repo.getByTokenHash('')).toBeNull()
  })

  it('upserts on the same token hash (idempotent save)', async () => {
    await repo.save(SESSION)
    await repo.save({ ...SESSION, status: 'revoked', revokedAt: '2026-08-02T00:00:00.000Z' })
    const got = await repo.getByTokenHash(SESSION.tokenHash)
    expect(got.status).toBe('revoked')
    expect(got.revokedAt).toBe('2026-08-02T00:00:00.000Z')
  })
})

describe('revocation', () => {
  it('revokes a token exactly once (first call true, later calls false)', async () => {
    await repo.save(SESSION)
    expect(await repo.revokeByTokenHash(SESSION.tokenHash)).toBe(true)
    expect(await repo.revokeByTokenHash(SESSION.tokenHash)).toBe(false)
    const got = await repo.getByTokenHash(SESSION.tokenHash)
    expect(got.status).toBe('revoked')
    expect(got.revokedAt).toBeTruthy()
  })

  it('revokeByTokenHash on an unknown token is a safe no-op', async () => {
    expect(await repo.revokeByTokenHash('f'.repeat(64))).toBe(false)
  })

  it('revokeAllForUser revokes only that user\'s sessions', async () => {
    await repo.save(SESSION)
    await repo.save({ ...SESSION, tokenHash: 'b'.repeat(64), userId: 'u1' })
    await repo.save({ ...SESSION, tokenHash: 'c'.repeat(64), userId: 'u2' })

    await repo.revokeAllForUser('u1')

    expect((await repo.getByTokenHash('a'.repeat(64))).status).toBe('revoked')
    expect((await repo.getByTokenHash('b'.repeat(64))).status).toBe('revoked')
    expect((await repo.getByTokenHash('c'.repeat(64))).status).toBe('active')
  })

  it('deleteAllForUser removes every session for a user', async () => {
    await repo.save(SESSION)
    await repo.save({ ...SESSION, tokenHash: 'b'.repeat(64), userId: 'u1' })
    await repo.save({ ...SESSION, tokenHash: 'c'.repeat(64), userId: 'u2' })

    await repo.deleteAllForUser('u1')

    expect(await repo.getByTokenHash('a'.repeat(64))).toBeNull()
    expect(await repo.getByTokenHash('b'.repeat(64))).toBeNull()
    expect(await repo.getByTokenHash('c'.repeat(64))).not.toBeNull()
  })
})
