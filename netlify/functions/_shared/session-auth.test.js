// @vitest-environment node
//
// SEC-1.9 (#184) — authentication takeover / replay regression suite.
//
// Proves the session-token model resists the classic auth attacks, through the
// REAL resolveSession / requireAdmin and the REAL collection handler on the
// Blobs backend (in-memory @netlify/blobs mock):
//   - Replay: a revoked session token, an expired session token, and a
//     forged/unknown token are all rejected (401 SESSION_INVALID).
//   - Stolen credentials: a session token can only ever resolve to ITS user —
//     a u1 session cannot reach u2's collection data (per-user store
//     isolation), and cross-account reads return 401/403/empty, never u2 rows.
//   - Disabled accounts: a disabled member's session is rejected on
//     revalidation (403).
//   - Logout invalidation: after revokeSession (logout), the token is dead
//     server-side.
//   - Fixation: every login mints a fresh token — two logins never share one.
//   - Privilege escalation: a member session can never call admin actions
//     (403), and the raw admin key is no longer accepted as a bearer (401) —
//     role comes only from the server-created session record.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../collection'
import { createSession, getSessionByToken, revokeAllForUser, revokeSession } from './sessions'
import { requireAdmin, resolveSession } from './session-auth'

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

const U1 = 'u1'
const U2 = 'u2'

function seedMember(id, { name = 'Ada', status = 'active' } = {}) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = {
    id, name, email: `${id}@example.com`, code: `RU-${id.toUpperCase()}-XXXX-XXXX`,
    collections: { records: true, books: true }, plan: 'free', role: 'member',
    status, features: {},
  }
  identity.data.set(`user:${id}`, user)
  identity.data.set('index:users', [...new Set([...(identity.data.get('index:users') || []), id])])
  return user
}

function seedCollection(userId, items) {
  const store = createStore()
  stores[`collection-${userId}-records`] = store
  store.data.set('index', items.map((i) => i.id))
  for (const item of items) store.data.set(`item:${item.id}`, item)
  return store
}

function req(method = 'GET', token = '') {
  return {
    method,
    url: `http://localhost/.netlify/functions/collection?collection=records`,
    headers: {
      get: (k) => (String(k).toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    json: async () => ({}),
  }
}

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  delete process.env.DATABASE_URL
})

describe('Replay — dead session tokens are rejected', () => {
  it('rejects a REVOKED session token (401 SESSION_INVALID)', async () => {
    seedMember(U1)
    const { token } = await createSession({ userId: U1, role: 'member' })
    await revokeSession(token) // logout / server-side kill

    const out = await resolveSession(req('GET', token))
    expect(out.error).toBeTruthy()
    expect(out.error.status).toBe(401)
    expect((await out.error.json()).code).toBe('SESSION_INVALID')
  })

  it('rejects an EXPIRED session token (401 SESSION_INVALID)', async () => {
    seedMember(U1)
    const { token } = await createSession({ userId: U1, role: 'member', now: Date.now() - 40 * 24 * 60 * 60 * 1000 })
    const out = await resolveSession(req('GET', token))
    expect(out.error.status).toBe(401)
    expect((await out.error.json()).code).toBe('SESSION_INVALID')
  })

  it('rejects a FORGED / unknown token (401)', async () => {
    seedMember(U1)
    const out = await resolveSession(req('GET', 'forged-opaque-token-that-was-never-issued'))
    expect(out.error.status).toBe(401)
  })

  it('rejects a raw access code sent as a Bearer (codes are exchange-only now)', async () => {
    seedMember(U1)
    const out = await resolveSession(req('GET', 'RU-U1-XXXX-XXXX'))
    // The code is not a session token — no session record exists for it.
    expect(out.error.status).toBe(401)
  })

  it('rejects a missing token (401)', async () => {
    const out = await resolveSession(req('GET', ''))
    expect(out.error.status).toBe(401)
  })
})

describe('Stolen credentials — no cross-account access', () => {
  it('a session token resolves to exactly its user and no other', async () => {
    seedMember(U1)
    seedMember(U2)
    const { token } = await createSession({ userId: U1, role: 'member' })
    const out = await resolveSession(req('GET', token))
    expect(out.error).toBeUndefined()
    expect(out.user.id).toBe(U1)
    expect(out.user.id).not.toBe(U2)
  })

  it('u1\'s session can read ONLY u1\'s collection store — never u2\'s rows (IDOR)', async () => {
    seedMember(U1)
    seedMember(U2)
    seedCollection(U1, [{ id: 'u1a', title: 'U1 - Record A' }])
    seedCollection(U2, [{ id: 'u2a', title: 'U2 - Record B' }])

    const { token } = await createSession({ userId: U1, role: 'member' })
    const res = await handler(req('GET', token))
    expect(res.status).toBe(200)
    const body = await res.json()
    const titles = body.items.map((i) => i.title)
    expect(titles).toContain('U1 - Record A')
    expect(titles).not.toContain('U2 - Record B')
  })
})

describe('Disabled accounts — a disabled member\'s session is rejected', () => {
  it('rejects on revalidation (403) even while the session record is live', async () => {
    seedMember(U1, { status: 'active' })
    const { token } = await createSession({ userId: U1, role: 'member' })
    // Admin disables the member — the session record is still active.
    seedMember(U1, { status: 'disabled' })

    const out = await resolveSession(req('GET', token))
    expect(out.error.status).toBe(403)
    expect((await out.error.json()).error).toContain('disabled')
  })
})

describe('Logout invalidation — the token is dead server-side after logout', () => {
  it('revoked tokens cannot read the collection API', async () => {
    seedMember(U1)
    seedCollection(U1, [{ id: 'a', title: 'A' }])
    const { token } = await createSession({ userId: U1, role: 'member' })
    expect((await handler(req('GET', token))).status).toBe(200)

    await revokeSession(token) // logout()

    expect((await handler(req('GET', token))).status).toBe(401)
  })
})

describe('SEC-1.3 (#178) — sliding renewal happens server-side during resolveSession', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('extends a session inside the renewal window (same token, new expiry)', async () => {
    seedMember(U1)
    const { token, record } = await createSession({ userId: U1, role: 'member', now: Date.now() - 20 * DAY })
    const out = await resolveSession(req('GET', token))
    expect(out.error).toBeUndefined()
    expect(out.user.id).toBe(U1)
    // The client keeps the SAME token — no churn, no session proliferation.
    expect(out.token).toBe(token)
    // The stored record's expiry was extended server-side.
    expect(new Date(out.session.expiresAt).getTime()).toBeGreaterThan(new Date(record.expiresAt).getTime())
    expect((await getSessionByToken(token)).expiresAt).toBe(out.session.expiresAt)
  })

  it('leaves expiry untouched for a session outside the renewal window', async () => {
    seedMember(U1)
    const { token, record } = await createSession({ userId: U1, role: 'member', now: Date.now() - 5 * DAY })
    const out = await resolveSession(req('GET', token))
    expect(out.error).toBeUndefined()
    expect(out.session.expiresAt).toBe(record.expiresAt)
  })

  it('never renews a session for a DISABLED account (a 403 request is not an activity signal)', async () => {
    seedMember(U1, { status: 'active' })
    const { token, record } = await createSession({ userId: U1, role: 'member', now: Date.now() - 20 * DAY })
    seedMember(U1, { status: 'disabled' })
    const out = await resolveSession(req('GET', token))
    expect(out.error.status).toBe(403)
    expect((await getSessionByToken(token)).expiresAt).toBe(record.expiresAt)
  })
})

describe('SEC-1.4 (#179) — logout-all / server-side bulk revocation', () => {
  it('after logoutAll, EVERY prior token for that user is dead (401)', async () => {
    seedMember(U1)
    const s1 = await createSession({ userId: U1, role: 'member' })
    const s2 = await createSession({ userId: U1, role: 'member' })

    // What the auth `logoutAll` action does server-side:
    await revokeAllForUser(U1)

    for (const { token } of [s1, s2]) {
      expect((await getSessionByToken(token)).status).toBe('revoked')
      const out = await resolveSession(req('GET', token))
      expect(out.error.status).toBe(401)
      expect((await out.error.json()).code).toBe('SESSION_INVALID')
    }
  })

  it('a member logoutAll cannot touch another member\'s sessions (isolation)', async () => {
    seedMember(U1)
    seedMember(U2)
    const mine = await createSession({ userId: U1, role: 'member' })
    const theirs = await createSession({ userId: U2, role: 'member' })

    await revokeAllForUser(U1) // u1 signs out all their own devices

    expect((await resolveSession(req('GET', mine.token))).error.status).toBe(401)
    // u2's session is untouched and still resolves.
    const out = await resolveSession(req('GET', theirs.token))
    expect(out.error).toBeUndefined()
    expect(out.user.id).toBe(U2)
    expect((await getSessionByToken(theirs.token)).status).toBe('active')
  })

  it('logoutAll is idempotent — a second bulk revoke is a safe no-op', async () => {
    seedMember(U1)
    const { token } = await createSession({ userId: U1, role: 'member' })
    await revokeAllForUser(U1)
    await revokeAllForUser(U1) // again — no error, no resurrect
    expect((await getSessionByToken(token)).status).toBe('revoked')
  })

  it('the owner session is revocable too (logoutAll works for the owner)', async () => {
    const { token } = await createSession({ userId: 'owner', role: 'admin' })
    expect((await resolveSession(req('GET', token))).error).toBeUndefined()
    await revokeAllForUser('owner')
    const out = await resolveSession(req('GET', token))
    expect(out.error.status).toBe(401)
    expect((await out.error.json()).code).toBe('SESSION_INVALID')
  })
})

describe('Fixation — fresh session per login', () => {
  it('two logins for the same user never share a token', async () => {
    seedMember(U1)
    const first = await createSession({ userId: U1, role: 'member' })
    const second = await createSession({ userId: U1, role: 'member' })
    expect(first.token).not.toBe(second.token)
    expect((await getSessionByToken(first.token)).status).toBe('active')
    expect((await getSessionByToken(second.token)).status).toBe('active')
  })
})

describe('Privilege escalation — members can never become admin', () => {
  it('a member session cannot call admin actions (requireAdmin → 403)', async () => {
    seedMember(U1)
    const { token } = await createSession({ userId: U1, role: 'member' })
    const out = await requireAdmin(req('GET', token))
    expect(out.error.status).toBe(403)
    expect((await out.error.json()).error).toContain('Admin access required')
  })

  it('a forged "admin-looking" bearer is 401, not admin (the key is not a session)', async () => {
    seedMember(U1)
    const out = await requireAdmin(req('GET', 'runout-dev-admin-key'))
    expect(out.error.status).toBe(401)
  })

  it('the owner is the only admin-role identity (admin session → allowed)', async () => {
    const { token } = await createSession({ userId: 'owner', role: 'admin' })
    const out = await requireAdmin(req('GET', token))
    expect(out.error).toBeUndefined()
    expect(out.user.role).toBe('admin')
  })

  it('a demo session is never admin', async () => {
    const { token } = await createSession({ userId: 'demo', role: 'demo' })
    const out = await requireAdmin(req('GET', token))
    expect(out.error.status).toBe(403)
  })
})

// FINDING-2 — RFC 7235: the auth-scheme is case-insensitive. A client that
// sends `authorization: bearer <token>` (lowercase scheme) must resolve the
// same live session as `Bearer `.
describe('Bearer scheme normalization (RFC 7235) — case-insensitive', () => {
  it('resolves a session token sent with a lowercase "bearer " scheme', async () => {
    seedMember(U1)
    const { token } = await createSession({ userId: U1, role: 'member' })

    const lowercaseReq = {
      method: 'GET',
      url: 'http://localhost/.netlify/functions/collection?collection=records',
      headers: {
        get: (k) => (String(k).toLowerCase() === 'authorization' ? `bearer ${token}` : null),
      },
      json: async () => ({}),
    }

    const out = await resolveSession(lowercaseReq)
    expect(out.error).toBeUndefined()
    expect(out.user.id).toBe(U1)
    // The credential round-trips intact — its case is never lowercased.
    expect(out.token).toBe(token)
  })
})
