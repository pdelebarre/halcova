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
import handler from '../auth'
import { signMagicLink } from './magic-link'
import { getUser, listRequests, listUsers, saveUser } from './users'

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

function req(body, { method = 'POST' } = {}) {
  return {
    method,
    // No origin/host → siteUrl falls back to http://localhost:8888; no IP
    // headers → the per-IP rate limiter is skipped (the per-email limiter
    // still runs, at its default 5/window — each test stays well under).
    headers: { get: () => null },
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
    expect(body.code).toMatch(/^RU-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
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
    // The code lives ONLY at the top level, exactly once — never inside the
    // public user object.
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('stripeCustomerId')

    // The issued code matches the stored member, and the request flipped.
    const users = await listUsers()
    expect(users).toHaveLength(1)
    expect(users[0].code).toBe(body.code)
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
    expect(body.code).toMatch(/^RU-/)
    expect(body.code).not.toBe(RETURNING.code)
    // Plan + collections + billing fields survive the rotation.
    expect(body.user.plan).toBe('premium')
    expect(body.user.collections).toEqual({ records: true, books: false })
    expect(body.user.planExpiresAt).toBe('2027-08-14T00:00:00.000Z')

    // Exactly one account — no duplicate.
    const users = await listUsers()
    expect(users).toHaveLength(1)
    expect(users[0].code).toBe(body.code)
    // The OLD code stops working; the NEW one signs in (rotation semantics).
    const oldLogin = await call({ action: 'login', code: 'RU-OLD-OLD-OLD' })
    expect(oldLogin.status).toBe(401)
    const newLogin = await call({ action: 'login', code: body.code })
    expect(newLogin.status).toBe(200)
    expect(newLogin.body.user.id).toBe('u-member')
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
    expect(body.code).toMatch(/^RU-/)
    // The request used for the checkout identity is now approved.
    expect((await listRequests())[0].status).toBe('approved')
  })
})
