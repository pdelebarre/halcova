// @vitest-environment node
//
// Unit tests for the server-managed session-token layer (SEC-EPIC-1, #176):
//   - createSession mints an opaque token, stores ONLY its sha256 hash (the
//     raw token is never persisted), and records the server-set role,
//   - tokens are unique per login (no session fixation),
//   - isSessionLive gates on active + not-revoked + unexpired,
//   - revokeSession / revokeAllForUser kill sessions server-side,
//   - sessionTtlMs honors RUNOUT_SESSION_TTL_DAYS but is hard-capped at 90 days.
//
// The @netlify/blobs store is an in-memory map (same pattern as the other
// suites) and DATABASE_URL is unset, so the runout-sessions Blobs repo runs.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore } from '@netlify/blobs'
import {
  createSession,
  getSessionByToken,
  isSessionLive,
  revokeAllForUser,
  revokeSession,
  sessionTokenHash,
  sessionTtlMs,
} from './sessions'

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

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  delete process.env.RUNOUT_SESSION_TTL_DAYS
})

afterEach(() => {
  delete process.env.RUNOUT_SESSION_TTL_DAYS
})

describe('createSession — opaque, hash-only, role-captured', () => {
  it('returns an opaque token and stores ONLY its sha256 hash — never the raw token', async () => {
    const { token, record } = await createSession({ userId: 'u1', role: 'member' })
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(token).not.toContain('u1')

    const sessions = stores['runout-sessions']
    // The raw token must not appear as a key or inside any stored value.
    const keys = [...sessions.data.keys()]
    expect(keys.some((k) => k.includes(token))).toBe(false)
    for (const value of sessions.data.values()) {
      expect(JSON.stringify(value)).not.toContain(token)
    }
    // The stored record is keyed by the hash and carries the server-set role.
    expect(keys).toContain(`session:${sessionTokenHash(token)}`)
    expect(record.role).toBe('member')
    expect(record.userId).toBe('u1')
    expect(record.status).toBe('active')
    expect(record.expiresAt).toBeTruthy()
  })

  it('mints a UNIQUE token on every call — no session fixation across logins', async () => {
    const a = await createSession({ userId: 'u1', role: 'member' })
    const b = await createSession({ userId: 'u1', role: 'member' })
    expect(a.token).not.toBe(b.token)
    expect(a.record.tokenHash).not.toBe(b.record.tokenHash)
  })

  it('captures the role server-side (admin/demo/member) — never from the caller', async () => {
    const admin = await createSession({ userId: 'owner', role: 'admin' })
    const demo = await createSession({ userId: 'demo', role: 'demo' })
    expect(admin.record.role).toBe('admin')
    expect(demo.record.role).toBe('demo')
  })
})

describe('isSessionLive — active, unrevoked, unexpired', () => {
  it('is live for an active, unexpired session', async () => {
    const { record } = await createSession({ userId: 'u1', role: 'member' })
    expect(isSessionLive(record)).toBe(true)
  })

  it('is NOT live for a revoked session', async () => {
    const created = await createSession({ userId: 'u1', role: 'member' })
    await revokeSession(created.token)
    const revoked = await getSessionByToken(created.token)
    expect(revoked.status).toBe('revoked')
    expect(isSessionLive(revoked)).toBe(false)
  })

  it('is NOT live for an expired session', async () => {
    // createSession with `now` far in the past => expiresAt is long gone.
    const { record } = await createSession({ userId: 'u1', role: 'member', now: Date.now() - 200 * 24 * 60 * 60 * 1000 })
    expect(isSessionLive(record)).toBe(false)
  })

  it('returns false for a null record', () => {
    expect(isSessionLive(null)).toBe(false)
  })
})

describe('revocation — server-side kill', () => {
  it('revokeSession kills exactly that token and is idempotent', async () => {
    const created = await createSession({ userId: 'u1', role: 'member' })
    expect(await revokeSession(created.token)).toBe(true)
    // Already revoked — a no-op.
    expect(await revokeSession(created.token)).toBe(false)
    expect(await getSessionByToken(created.token)).toMatchObject({ status: 'revoked' })
  })

  it('revokeSession on an unknown token is a safe no-op', async () => {
    expect(await revokeSession('nope-not-a-real-token')).toBe(false)
  })

  it('revokeAllForUser revokes every live session for a user', async () => {
    const s1 = await createSession({ userId: 'u1', role: 'member' })
    const s2 = await createSession({ userId: 'u1', role: 'member' })
    const other = await createSession({ userId: 'u2', role: 'member' })

    await revokeAllForUser('u1')

    expect((await getSessionByToken(s1.token)).status).toBe('revoked')
    expect((await getSessionByToken(s2.token)).status).toBe('revoked')
    // Another user's session is untouched.
    expect((await getSessionByToken(other.token)).status).toBe('active')
  })
})

describe('sessionTtlMs — env-tunable but hard-capped', () => {
  it('defaults to 30 days', () => {
    expect(sessionTtlMs()).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('honors RUNOUT_SESSION_TTL_DAYS', () => {
    process.env.RUNOUT_SESSION_TTL_DAYS = '7'
    expect(sessionTtlMs()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('is hard-capped at 90 days regardless of env', () => {
    process.env.RUNOUT_SESSION_TTL_DAYS = '365'
    expect(sessionTtlMs()).toBe(90 * 24 * 60 * 60 * 1000)
  })
})
