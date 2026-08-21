// @vitest-environment node
//
// Endpoint-level tests for the self-serve magic-link flow in
// netlify/functions/auth.js (ADR-0003 S1, #59). The token module itself is
// covered in _shared/magic-link.test.js — THIS suite proves the HTTP layer
// wires it up correctly:
//   - requestMagicLink validates the email, records a pending request (deduped
//     by email), and returns { ok, expiresAt } plus a devLink in dev (the
//     mailer is a no-op without RUNOUT_MAIL_API_KEY),
//   - verifyMagicLink round-trips a real token into a session: a brand-new
//     member gets a free plan + both collections + a freshly-issued RU- code,
//     and the pending request flips to approved,
//   - a returning member is recognized by email and gets a ROTATED code (their
//     plan/collections preserved), so the old code stops working,
//   - a disabled member is never re-enabled by clicking a link (403),
//   - the failure modes map to the right HTTP codes: LINK_EXPIRED / LINK_INVALID /
//     LINK_USED → 401 with the code, missing token → 400,
//   - the code is returned to its owner exactly once and never inside the
//     public user object (publicUser).
//
// The identity + magic-link + rate-limit blob stores are mocked in-memory
// (same pattern as payment.test.js / billing.test.js) so no network or real
// backend is touched.
//
// NOTE: this file lives in _shared/ (not netlify/functions/) so Netlify does
// not treat it as a deployable function — Netlify ignores underscore-prefixed
// paths when discovering functions, and a dotted name like 'auth.test' is
// rejected with a 422 "Incorrect function names" error on deploy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { MAGIC_LINK_VERIFY_IP_LIMIT } from '../auth'
import { signMagicLink } from './magic-link'
import { resolveSession } from './session-auth'
import { createSession, getSessionByToken } from './sessions'
import { getUser, listRequests, listUsers, saveUser } from './users'
import { RATE_LIMIT_WINDOW_MS, windowIndex } from './rate-limit'
import { demoSessionToken } from './session-test-helpers'

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

const SECRET = 'test-magic-secret'

function req(body, { method = 'POST', token = '', ip = '' } = {}) {
  return {
    method,
    // No origin/host → siteUrl falls back to http://localhost:8888; no IP
    // headers → the per-IP rate limiters are skipped (the per-email limiter
    // still runs, at its default 5/window — each test stays well under).
    headers: {
      get: (k) => {
        const key = String(k).toLowerCase()
        if (key === 'authorization' && token) return `Bearer ${token}`
        if (key === 'x-nf-client-connection-ip' && ip) return ip
        return null
      },
    },
    json: async () => body,
  }
}

async function call(body, opts) {
  const res = await handler(req(body, opts))
  return { status: res.status, body: await res.json() }
}

// Sign a valid, unexpired magic-link token with the same secret the function
// uses (RUNOUT_MAGIC_LINK_SECRET, set in beforeEach).
function validToken(email, { expiresInMs = 60_000, jti = 'j1' } = {}) {
  return signMagicLink({ email, expiresAt: Date.now() + expiresInMs, jti, secret: SECRET })
}

// A returning member record (premium, has collections) to prove code rotation.
const RETURNING = {
  id: 'u-member',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-OLD-OLD-OLD',
  collections: { records: true, books: false },
  features: {},
  plan: 'premium',
  planExpiresAt: '2027-08-14T00:00:00.000Z',
  role: 'member',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  process.env.RUNOUT_MAGIC_LINK_SECRET = SECRET
  for (const key of Object.keys(stores)) delete stores[key]
})

afterEach(() => {
  delete process.env.RUNOUT_MAGIC_LINK_SECRET
  delete process.env.NODE_ENV
  delete process.env.RUNOUT_DEV_EMAIL
  for (const key of Object.keys(stores)) delete stores[key]
})

describe('requestMagicLink — email validation + pending request + devLink', () => {
  it('records a pending request and returns { ok, expiresAt } with a devLink (dev mailer)', async () => {
    const { status, body } = await call({ action: 'requestMagicLink', email: '  Ada@Example.COM ' })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.expiresAt).toBeGreaterThan(Date.now())
    // Dev no-op mailer echoes the link so a developer can click through.
    expect(body.devLink).toMatch(/^http:\/\/localhost:8888\/\?magic-link=/)

    // A pending request was created (the future webhook's stable identity),
    // with the email normalized.
    const requests = await listRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ email: 'ada@example.com', status: 'pending' })
    expect(requests[0].name).toBe('ada') // name from the email local part
  })

  it('reuses an existing pending request for the same email (dedupe)', async () => {
    await call({ action: 'requestMagicLink', email: 'ada@example.com' })
    const first = (await listRequests())[0]

    const { status } = await call({ action: 'requestMagicLink', email: 'Ada@Example.com' })
    expect(status).toBe(200)
    expect(await listRequests()).toHaveLength(1)
    expect((await listRequests())[0].id).toBe(first.id)
  })

  it('rejects a malformed email with 400 and records nothing', async () => {
    for (const email of ['not-an-email', 'a@b', 'with space@x.com', '']) {
      const { status } = await call({ action: 'requestMagicLink', email })
      expect(status).toBe(400)
    }
    expect(await listRequests()).toHaveLength(0)
  })

  it('rejects a missing email with 400', async () => {
    const { status } = await call({ action: 'requestMagicLink' })
    expect(status).toBe(400)
    expect(await listRequests()).toHaveLength(0)
  })
})

describe('requestMagicLink — M3 fail-closed in production (#54)', () => {
  it('fails closed (503 MAIL_NOT_CONFIGURED) in production with no mail key — no link, no token, no request', async () => {
    process.env.NODE_ENV = 'production'
    const { status, body } = await call({ action: 'requestMagicLink', email: 'ada@example.com' })
    expect(status).toBe(503)
    expect(body.code).toBe('MAIL_NOT_CONFIGURED')
    // No link is echoed, no token is issued, and no pending request is
    // recorded — a misconfigured prod can never mint a sign-in link.
    expect(body).not.toHaveProperty('devLink')
    expect(body).not.toHaveProperty('ok')
    expect(await listRequests()).toHaveLength(0)
  })

  it('still works in dev (no mail key) — the devLink is echoed so a developer can click through', async () => {
    // NODE_ENV unset / 'test' — the no-op mailer + devLink are dev-only.
    const { status, body } = await call({ action: 'requestMagicLink', email: 'ada@example.com' })
    expect(status).toBe(200)
    expect(body.devLink).toMatch(/^http:\/\/localhost:8888\/\?magic-link=/)
    expect(await listRequests()).toHaveLength(1)
  })

  it('honors the explicit RUNOUT_DEV_EMAIL=1 opt-in even when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_DEV_EMAIL = '1'
    const { status, body } = await call({ action: 'requestMagicLink', email: 'ada@example.com' })
    expect(status).toBe(200)
    expect(body.devLink).toMatch(/^http:\/\/localhost:8888\/\?magic-link=/)
    expect(await listRequests()).toHaveLength(1)
  })
})

describe('verifyMagicLink — self-serve signup round-trip (#59)', () => {
  it('turns a fresh link into a member: free plan, both collections, RU- code, request approved', async () => {
    // The pending request exists (requestMagicLink created it earlier).
    await call({ action: 'requestMagicLink', email: 'ada@example.com' })

    const { status, body } = await call({ action: 'verifyMagicLink', token: validToken('ada@example.com') })
    expect(status).toBe(200)
    // SEC-EPIC-1 (#176/#177): the response is { user, session } — an opaque
    // session token, never the access code.
    expect(body.session).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(body).not.toHaveProperty('code')
    // Self-serve members start on the free tier with both collections and no
    // manual feature flags (no lending).
    expect(body.user).toMatchObject({
      email: 'ada@example.com',
      role: 'member',
      status: 'active',
      plan: 'free',
      collections: { records: true, books: true },
      features: {},
    })
    // The code is never inside the public user object either.
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('stripeCustomerId')

    // The member was created with a freshly-issued RU- code (stored, never
    // returned again), and the request flipped to approved.
    const users = await listUsers()
    expect(users).toHaveLength(1)
    expect(users[0].code).toMatch(/^RU-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect((await listRequests())[0].status).toBe('approved')
  })

  it('creates a trace request + member even if no request was made first', async () => {
    const { status } = await call({ action: 'verifyMagicLink', token: validToken('bob@example.com') })
    expect(status).toBe(200)
    expect(await listUsers()).toHaveLength(1)
    expect((await listRequests())[0]).toMatchObject({ email: 'bob@example.com', status: 'approved' })
  })

  it('rotates the code for a returning member, preserving plan and collections', async () => {
    await saveUser(RETURNING)

    const { status, body } = await call({ action: 'verifyMagicLink', token: validToken('ada@example.com') })
    expect(status).toBe(200)
    expect(body.session).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(body).not.toHaveProperty('code')
    // Plan + collections + billing fields survive the rotation.
    expect(body.user.plan).toBe('premium')
    expect(body.user.collections).toEqual({ records: true, books: false })
    expect(body.user.planExpiresAt).toBe('2027-08-14T00:00:00.000Z')

    // Exactly one account — no duplicate.
    const users = await listUsers()
    expect(users).toHaveLength(1)
    expect(users[0].code).toMatch(/^RU-/)
    expect(users[0].code).not.toBe(RETURNING.code)
    // The OLD code stops working; the NEW one signs in (rotation semantics).
    const oldLogin = await call({ action: 'login', code: 'RU-OLD-OLD-OLD' })
    expect(oldLogin.status).toBe(401)
    const newLogin = await call({ action: 'login', code: users[0].code })
    expect(newLogin.status).toBe(200)
    expect(newLogin.body.user.id).toBe('u-member')
    expect(newLogin.body.session).toMatch(/^[A-Za-z0-9_-]{20,}$/)
  })

  it('never re-enables a disabled member (403) and does not rotate their code', async () => {
    const disabled = { ...RETURNING, status: 'disabled' }
    await saveUser(disabled)

    const { status } = await call({ action: 'verifyMagicLink', token: validToken('ada@example.com') })
    expect(status).toBe(403)
    // Still disabled, still the same code — clicking the link changed nothing.
    expect(await listUsers()).toHaveLength(1)
    expect((await getUser('u-member')).status).toBe('disabled')
    expect((await getUser('u-member')).code).toBe(RETURNING.code)
  })
})

describe('verifyMagicLink — link failure modes', () => {
  it('rejects an expired link with 401 LINK_EXPIRED', async () => {
    const expired = validToken('ada@example.com', { expiresInMs: -1000 })
    const { status, body } = await call({ action: 'verifyMagicLink', token: expired })
    expect(status).toBe(401)
    expect(body.code).toBe('LINK_EXPIRED')
    expect(await listUsers()).toHaveLength(0)
  })

  it('rejects a tampered / invalid link with 401 LINK_INVALID', async () => {
    const good = validToken('ada@example.com')
    const tampered = `${good.slice(0, -1)}X`
    const { status, body } = await call({ action: 'verifyMagicLink', token: tampered })
    expect(status).toBe(401)
    expect(body.code).toBe('LINK_INVALID')
    expect(await listUsers()).toHaveLength(0)
  })

  it('rejects a replayed (already-used) link with 401 LINK_USED — single-use', async () => {
    const token = validToken('ada@example.com')
    expect((await call({ action: 'verifyMagicLink', token })).status).toBe(200)
    // A second verify with the SAME token is rejected (replay-safe).
    const { status, body } = await call({ action: 'verifyMagicLink', token })
    expect(status).toBe(401)
    expect(body.code).toBe('LINK_USED')
    // No duplicate account was created.
    expect(await listUsers()).toHaveLength(1)
  })

  it('rejects a missing token with 400', async () => {
    const { status } = await call({ action: 'verifyMagicLink' })
    expect(status).toBe(400)
  })
})

describe('end-to-end: request → click the devLink → session', () => {
  it('round-trips the real devLink token through verifyMagicLink', async () => {
    const { body: requested } = await call({ action: 'requestMagicLink', email: 'ada@example.com' })
    const token = new URL(requested.devLink).searchParams.get('magic-link')
    expect(token).toBeTruthy()

    const { status, body } = await call({ action: 'verifyMagicLink', token })
    expect(status).toBe(200)
    expect(body.user.email).toBe('ada@example.com')
    expect(body.session).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(body).not.toHaveProperty('code')
    // The request used for the checkout identity is now approved.
    expect((await listRequests())[0].status).toBe('approved')
  })
})

// SEC-1.4 (#179) — "sign out all devices" endpoint.
describe('logoutAll — sign out all devices', () => {
  async function seedMember(id, email) {
    await saveUser({
      id, name: id, email, code: `RU-${id.toUpperCase()}-XXXX-XXXX`,
      collections: { records: true, books: true }, role: 'member', status: 'active', features: {},
    })
  }

  function sessionReq(token) {
    return {
      method: 'GET',
      url: 'http://localhost/.netlify/functions/auth',
      headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
      json: async () => ({}),
    }
  }

  it('revokes EVERY session for the signed-in user (current one included) and returns { ok: true }', async () => {
    await seedMember('u-member', 'ada@example.com')
    const s1 = await createSession({ userId: 'u-member', role: 'member' })
    const s2 = await createSession({ userId: 'u-member', role: 'member' })

    const { status, body } = await call({ action: 'logoutAll' }, { token: s1.token })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })

    for (const { token } of [s1, s2]) {
      expect((await getSessionByToken(token)).status).toBe('revoked')
      expect((await resolveSession(sessionReq(token))).error.status).toBe(401)
    }
  })

  it('401s without a valid session (logoutAll must be authorized)', async () => {
    const { status } = await call({ action: 'logoutAll' })
    expect(status).toBe(401)
  })

  it('a member logoutAll cannot revoke another member\'s sessions', async () => {
    await seedMember('u1', 'ada@example.com')
    await seedMember('u2', 'bob@example.com')
    const mine = await createSession({ userId: 'u1', role: 'member' })
    const theirs = await createSession({ userId: 'u2', role: 'member' })

    expect((await call({ action: 'logoutAll' }, { token: mine.token })).status).toBe(200)
    // u1's session is dead; u2's is untouched.
    expect((await getSessionByToken(mine.token)).status).toBe('revoked')
    expect((await getSessionByToken(theirs.token)).status).toBe('active')
    expect((await resolveSession(sessionReq(theirs.token))).error).toBeUndefined()
  })

  it('the OWNER session is revocable via logoutAll too', async () => {
    const { token } = await createSession({ userId: 'owner', role: 'admin' })
    const { status } = await call({ action: 'logoutAll' }, { token })
    expect(status).toBe(200)
    expect((await getSessionByToken(token)).status).toBe('revoked')
    expect((await resolveSession(sessionReq(token))).error.status).toBe(401)
  })
})

// SEC-7.4 (#341) — logout is throttled per-Token and logoutAll per-IP.
describe('SEC-7.4 (#341) — logout / logoutAll rate limits', () => {
  it('429s RATE_LIMIT once a single session token exceeds the per-token logout limit', async () => {
    await saveUser({ id: 'u-limit', name: 'u', email: 'limit@example.com', code: 'RU-LIMIT-XXXX-XXXX', collections: { records: true, books: true }, role: 'member', status: 'active', features: {} })
    const { token } = await createSession({ userId: 'u-limit', role: 'member' })
    // Pre-fill the per-token logout counter at its (default 60) limit.
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set(`rl:auth:logout:${token}`, { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 60 })

    const { status, body } = await call({ action: 'logout' }, { token })
    expect(status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT')
  })

  it('a different token is not throttled by another token’s logout exhaustion', async () => {
    await saveUser({ id: 'u-limit2', name: 'u', email: 'limit2@example.com', code: 'RU-LIM2-XXXX-XXXX', collections: { records: true, books: true }, role: 'member', status: 'active', features: {} })
    const a = await createSession({ userId: 'u-limit2', role: 'member' })
    const b = await createSession({ userId: 'u-limit2', role: 'member' })
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set(`rl:auth:logout:${a.token}`, { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 60 })

    expect((await call({ action: 'logout' }, { token: a.token })).status).toBe(429)
    expect((await call({ action: 'logout' }, { token: b.token })).status).toBe(200)
  })

  it('429s RATE_LIMIT once the per-IP logoutAll limit is exhausted', async () => {
    await saveUser({ id: 'u-limit3', name: 'u', email: 'limit3@example.com', code: 'RU-LIM3-XXXX-XXXX', collections: { records: true, books: true }, role: 'member', status: 'active', features: {} })
    const { token } = await createSession({ userId: 'u-limit3', role: 'member' })
    const ip = '203.0.113.77'
    // Pre-fill the per-IP logoutAll counter at its (default 60) limit.
    stores['runout-rate-limits'] = createStore()
    stores['runout-rate-limits'].data.set(`rl:auth:logoutAll:ip:${ip}`, { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 60 })

    const { status, body } = await call({ action: 'logoutAll' }, { token, ip })
    expect(status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT')
  })
})

// SEC-1.7 (#182) — the VERIFY path is rate-limited (the real brute-force
// surface for magic links), and requestMagicLink stays enumeration-neutral.
describe('SEC-1.7 (#182) — verify-path rate limit', () => {
  it('returns 429 once a client exceeds the per-IP verify limit (invalid-token hammering)', async () => {
    const ip = '203.0.113.7'
    // The limiter allows `limit` requests per window; the (limit+1)-th is 429.
    for (let i = 0; i < MAGIC_LINK_VERIFY_IP_LIMIT; i++) {
      const { status } = await call({ action: 'verifyMagicLink', token: `forged-${i}` }, { ip })
      expect(status).toBe(401) // every allowed call is a genuine invalid-token 401…
    }
    const { status, body } = await call({ action: 'verifyMagicLink', token: 'forged-limit' }, { ip })
    expect(status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT')
    expect(await listUsers()).toHaveLength(0)
  })
})

describe('SEC-1.7 (#182) — requestMagicLink is enumeration-neutral', () => {
  it('a known member email and an unknown email get the SAME response shape (no membership leak)', async () => {
    await saveUser(RETURNING) // ada@example.com is a real, active member

    const member = await call({ action: 'requestMagicLink', email: 'ada@example.com' })
    const ghost = await call({ action: 'requestMagicLink', email: 'ghost@example.com' })

    expect(member.status).toBe(200)
    expect(ghost.status).toBe(200)
    // Identical observable shape — nothing reveals that one email is a member.
    expect(Object.keys(member.body).sort()).toEqual(Object.keys(ghost.body).sort())
    expect(member.body).toMatchObject({ ok: true })
    expect(ghost.body).toMatchObject({ ok: true })
    expect(typeof member.body.expiresAt).toBe('number')
    expect(typeof ghost.body.expiresAt).toBe('number')
    expect(member.body).not.toHaveProperty('member')
    expect(ghost.body).not.toHaveProperty('member')
  })
})

// SEC-EPIC-1 / CWE-287 (#184) — a production deploy with BOTH the magic-link
// secret and RUNOUT_ADMIN_KEY unset must FAIL CLOSED on BOTH sides of the
// magic-link flow. ADMIN_KEY is a module-level constant, so these cases
// re-import the handler with NODE_ENV=production (ADMIN_KEY → '') to simulate
// the misconfigured deploy — same pattern as auth.test.js.
describe('magic link — fails closed when the secret is unconfigured (CWE-287)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    delete process.env.RUNOUT_ADMIN_KEY
    delete process.env.RUNOUT_MAGIC_LINK_SECRET
    delete process.env.RUNOUT_DEV_EMAIL
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.NODE_ENV
    delete process.env.RUNOUT_ADMIN_KEY
    delete process.env.RUNOUT_MAGIC_LINK_SECRET
    delete process.env.RUNOUT_MAIL_API_KEY
    delete process.env.RUNOUT_DEV_EMAIL
    vi.resetModules()
  })

  // Forge the exact CWE-287 attack: a well-formed, unexpired token signed with
  // the empty secret a misconfigured prod would have (HMAC-SHA256('', payload)).
  function forgedToken(email) {
    return signMagicLink({ email, expiresAt: Date.now() + 60_000, jti: 'j-attack', secret: '' })
  }

  it('verifyMagicLink refuses the forged token (503) and never rotates the victim code', async () => {
    await saveUser(RETURNING)
    const mod = await import('../auth')
    const res = await mod.default(req({ action: 'verifyMagicLink', token: forgedToken(RETURNING.email) }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('MAGIC_LINK_NOT_CONFIGURED')
    // No account was created and the victim's code was NOT rotated.
    const users = await listUsers()
    expect(users).toHaveLength(1)
    expect((await getUser(RETURNING.id)).code).toBe(RETURNING.code)
  })

  it('verifyMagicLink for a brand-new email creates no user and no request', async () => {
    const mod = await import('../auth')
    const res = await mod.default(req({ action: 'verifyMagicLink', token: forgedToken('ghost@example.com') }))
    expect(res.status).toBe(503)
    expect(await listUsers()).toHaveLength(0)
    expect(await listRequests()).toHaveLength(0)
  })

  it('requestMagicLink fails closed (503 MAGIC_LINK_NOT_CONFIGURED) even when the mail key IS configured', async () => {
    process.env.RUNOUT_MAIL_API_KEY = 're_fake_key'
    const mod = await import('../auth')
    const res = await mod.default(req({ action: 'requestMagicLink', email: 'ada@example.com' }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('MAGIC_LINK_NOT_CONFIGURED')
    // No link/token was minted and no pending request was recorded.
    expect(await listRequests()).toHaveLength(0)
  })
})

// SEC-3.5 (#198) — CSRF is not applicable to the Bearer-token flow.
//
// Sessions are NOT cookie-based (SEC-EPIC-1 #176): the session token is held
// in localStorage and sent as an `Authorization: Bearer` header on every call.
// There is no ambient cookie credential, so classic cookie-CSRF (a cross-site
// form POST auto-attaching the cookie) cannot apply. These negative tests lock
// that in: a state-changing request without a valid Bearer is rejected 401,
// and no response ever sets a cookie.
describe('SEC-3.5 (#198) — CSRF-immune token-based sessions', () => {
  it('a state-changing request without a valid Bearer token is rejected (401) — no ambient credential', async () => {
    // logoutAll revokes sessions (a state change). With no Bearer there is no
    // ambient credential to ride on, so it 401s — a cross-site attacker cannot
    // forge this request.
    const res = await handler(req({ action: 'logoutAll' }, { token: '' }))
    expect(res.status).toBe(401)
  })

  it('a forged foreign Origin with no Bearer is still rejected (Origin is not the trust boundary)', async () => {
    const res = await handler({
      method: 'POST',
      headers: {
        get: (k) => {
          const key = String(k).toLowerCase()
          if (key === 'origin') return 'https://evil.example'
          if (key === 'sec-fetch-site') return 'cross-site'
          return null
        },
      },
      json: async () => ({ action: 'logoutAll' }),
    })
    expect(res.status).toBe(401)
  })

  it('no response sets a cookie — the app never uses cookie sessions', async () => {
    // A successful state-changing call (logout) must not set Set-Cookie.
    const { createSession } = await import('./sessions')
    const { token } = await createSession({ userId: 'owner', role: 'admin' })
    const res = await handler(req({ action: 'logout' }, { token }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('a request with a valid Bearer succeeds regardless of a foreign Origin header', async () => {
    // Token-based: the Bearer is the sole credential; a spoofed Origin does
    // not weaken auth (the client never auto-attaches the Bearer).
    const { createSession } = await import('./sessions')
    const { token } = await createSession({ userId: 'owner', role: 'admin' })
    const res = await handler({
      method: 'POST',
      headers: {
        get: (k) => {
          const key = String(k).toLowerCase()
          if (key === 'authorization') return `Bearer ${token}`
          if (key === 'origin') return 'https://evil.example'
          return null
        },
      },
      json: async () => ({ action: 'logoutAll' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

// ---- Self-serve account deletion (SEC-7.2.x #381) --------------------------
//
// A member can delete their OWN account via the auth endpoint. The cascade is
// the same as admin handleDeleteUser: reviews, feedback, collection stores,
// user record, sessions. Gated by re-authentication (access code confirmation).
// Demo is denied. Cross-user deletion is non-enumerating (403).

const MEMBER_FIXTURE = {
  id: 'u-delete-me',
  name: 'Delete Me',
  email: 'delete@example.com',
  code: 'RU-DEL1-ETE2-ETE3',
  collections: { records: true, books: true },
  features: {},
  plan: 'free',
  role: 'member',
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
}

describe('deleteAccount — self-serve account deletion (SEC-7.2.x)', () => {
  beforeEach(async () => {
    await saveUser(MEMBER_FIXTURE)
  })

  it('deletes the member\'s own account with a valid re-auth code — cascade runs', async () => {
    const { token } = await createSession({ userId: MEMBER_FIXTURE.id, role: 'member' })

    const { status, body } = await call(
      { action: 'deleteAccount', code: MEMBER_FIXTURE.code },
      { token },
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    // The user record is gone.
    expect(await getUser(MEMBER_FIXTURE.id)).toBeNull()
    // The session is gone (deleted with the account).
    expect(await getSessionByToken(token)).toBeNull()
  })

  it('rejects a wrong access code with 403 REAUTH_FAILED — account is NOT deleted', async () => {
    const { token } = await createSession({ userId: MEMBER_FIXTURE.id, role: 'member' })

    const { status, body } = await call(
      { action: 'deleteAccount', code: 'RU-WRONG-WRONG-WRONG' },
      { token },
    )
    expect(status).toBe(403)
    expect(body.code).toBe('REAUTH_FAILED')

    // The user record is still there.
    expect(await getUser(MEMBER_FIXTURE.id)).toMatchObject({ id: MEMBER_FIXTURE.id })
  })

  it('rejects a missing access code with 400 REAUTH_REQUIRED', async () => {
    const { token } = await createSession({ userId: MEMBER_FIXTURE.id, role: 'member' })

    const { status, body } = await call({ action: 'deleteAccount' }, { token })
    expect(status).toBe(400)
    expect(body.code).toBe('REAUTH_REQUIRED')

    // The user record is still there.
    expect(await getUser(MEMBER_FIXTURE.id)).toMatchObject({ id: MEMBER_FIXTURE.id })
  })

  it('denies the demo identity (403 FORBIDDEN) — demo is a constant, read-only identity', async () => {
    const token = await demoSessionToken()

    const { status, body } = await call(
      { action: 'deleteAccount', code: 'RU-DEMO-DEMO-DEMO' },
      { token },
    )
    expect(status).toBe(403)
    expect(body.code).toBe('FORBIDDEN')
  })

  it('denies a member trying to delete another member\'s account (non-enumerating 403)', async () => {
    // Attacker: u-attacker has a valid session but tries to delete u-victim.
    const attacker = { id: 'u-attacker', name: 'Attacker', email: 'attacker@example.com', code: 'RU-ATTK-ATTK-ATTK', collections: { records: true, books: true }, features: {}, plan: 'free', role: 'member', status: 'active', createdAt: '2026-08-01T09:00:00.000Z' }
    const victim = { ...MEMBER_FIXTURE, id: 'u-victim', email: 'victim@example.com', code: 'RU-VICT-IM00-IM00' }
    await saveUser(attacker)
    await saveUser(victim)
    const { token } = await createSession({ userId: attacker.id, role: 'member' })

    // The attacker sends victim's code — but the session resolves to the
    // attacker, so the code lookup returns the victim (different user id).
    const { status, body } = await call(
      { action: 'deleteAccount', code: victim.code },
      { token },
    )
    // Non-enumerating: same 403 REAUTH_FAILED whether the code is wrong or
    // belongs to a different user.
    expect(status).toBe(403)
    expect(body.code).toBe('REAUTH_FAILED')

    // Both users still exist.
    expect(await getUser(attacker.id)).toMatchObject({ id: attacker.id })
    expect(await getUser(victim.id)).toMatchObject({ id: victim.id })
  })

  it('denies an unauthenticated request with 401', async () => {
    const { status, body } = await call(
      { action: 'deleteAccount', code: MEMBER_FIXTURE.code },
      { token: '' },
    )
    expect(status).toBe(401)
    expect(body.code).toBe('NOT_SIGNED_IN')
  })

  it('denies a forged bearer with 401', async () => {
    const { status, body } = await call(
      { action: 'deleteAccount', code: MEMBER_FIXTURE.code },
      { token: 'forged-token' },
    )
    expect(status).toBe(401)
    // A forged token is not found in the session store — resolveSession
    // returns 401 NOT_SIGNED_IN (the stable unauthenticated shape).
    expect(body.code).toBe('NOT_SIGNED_IN')
  })

  it('is idempotent — a second call on a deleted user returns 401 (sessions are gone)', async () => {
    const { token } = await createSession({ userId: MEMBER_FIXTURE.id, role: 'member' })

    // First call: succeeds.
    const first = await call({ action: 'deleteAccount', code: MEMBER_FIXTURE.code }, { token })
    expect(first.status).toBe(200)

    // Second call: the session was deleted, so the request is unauthenticated.
    const second = await call({ action: 'deleteAccount', code: MEMBER_FIXTURE.code }, { token })
    expect(second.status).toBe(401)
    // The session is gone — resolveSession returns 401 NOT_SIGNED_IN (the
    // session record was deleted, so getSessionByToken returns null).
    expect(second.body.code).toBe('NOT_SIGNED_IN')
  })
})
