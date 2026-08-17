// @vitest-environment node
//
// Tests for the client-facing payment function (netlify/functions/payment.js,
// ADR-0003 S3): checkout / status / portal. The Stripe REST calls are mocked
// (no real keys — the repo convention); the plan→price mapping (priceIdForPlan)
// and the identity repository (blob repo via the in-memory @netlify/blobs mock)
// are real.
//
// Proves:
//   - checkout returns { url, sessionId } for a member (Bearer) and a pre-auth
//     prospect, reusing the pending request (deduped by email) as the stable
//     client_reference_id,
//   - owner / demo identities are rejected 403 (never a checkout),
//   - the error codes: PRICE_UNKNOWN (400), CHECKOUT_FAILED (502),
//     PAYMENT_INCOMPLETE (409),
//   - status resolves a materialized session and reconciles via
//     sessions.retrieve (both idempotent), returning the issued code exactly
//     ONCE and never to a signed-in member (M2),
//   - checkout/status are rate-limited per-IP + per-email → 429 RATE_LIMIT (M1),
//   - portal opens the Billing Portal for a paying member only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../payment'
import * as stripe from './stripe'
import { RATE_LIMIT_WINDOW_MS, windowIndex } from './rate-limit'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'
import { findUserByStripeSession, listRequests, listUsers, saveRequest, saveUser } from './users'

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

vi.mock('./stripe', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual, // priceIdForPlan stays REAL (env-driven); only REST is mocked
    createCheckoutSession: vi.fn(),
    retrieveSession: vi.fn(),
    createPortalSession: vi.fn(),
  }
})

const PREMIUM_PRICE = 'price_premium_pay'
const LIFETIME_PRICE = 'price_lifetime_pay'

function req(body, { method = 'POST', token, ip } = {}) {
  return {
    method,
    headers: {
      get: (name) => {
        const key = String(name).toLowerCase()
        if (key === 'authorization' && token) return `Bearer ${token}`
        if (key === 'x-nf-client-connection-ip' && ip) return ip
        return ''
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

async function call(body, opts) {
  const res = await handler(req(body, opts))
  return { status: res.status, body: await res.json() }
}

const MEMBER = {
  id: 'u-member',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  collections: { records: true, books: true },
  features: {},
  plan: 'free',
  role: 'member',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
}

// Session tokens minted per-test (SEC-EPIC-1): the Bearer is a server-managed
// session token, not the access code / admin key / demo code.
let MEMBER_TOKEN = ''
let ADMIN_TOKEN = ''
let DEMO_TOKEN = ''

beforeEach(async () => {
  process.env.STRIPE_PRICE_PREMIUM = PREMIUM_PRICE
  process.env.STRIPE_PRICE_LIFETIME = LIFETIME_PRICE
  process.env.STRIPE_SECRET_KEY = 'sk_test_pay'
  process.env.STRIPE_SITE_URL = 'https://halcova.app'
  stripe.createCheckoutSession.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  stripe.retrieveSession.mockResolvedValue({ id: 'cs_test_1', status: 'complete', payment_status: 'paid' })
  stripe.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/xyz' })
  MEMBER_TOKEN = await sessionTokenFor({ userId: 'u-member', role: 'member' })
  ADMIN_TOKEN = await adminSessionToken()
  DEMO_TOKEN = await demoSessionToken()
})

afterEach(() => {
  delete process.env.STRIPE_PRICE_PREMIUM
  delete process.env.STRIPE_PRICE_LIFETIME
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SITE_URL
  delete process.env.NODE_ENV
  for (const key of Object.keys(stores)) delete stores[key]
  vi.clearAllMocks()
})

describe('checkout — create a Checkout session', () => {
  it('creates a session for a session-authenticated member (kind=member)', async () => {
    await saveUser(MEMBER)
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime' }, { token: MEMBER_TOKEN })
    expect(status).toBe(200)
    expect(body).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1', sessionId: 'cs_test_1' })

    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1)
    const arg = stripe.createCheckoutSession.mock.calls[0][0]
    expect(arg.plan).toBe('lifetime')
    expect(arg.priceId).toBe(LIFETIME_PRICE)
    expect(arg.email).toBe('ada@example.com')
    expect(arg.kind).toBe('member')
    expect(arg.client_reference_id ?? arg.requestId).toMatch(/^request:/)
    expect(arg.successUrl).toContain('https://halcova.app')
  })

  it('creates a session for a pre-auth prospect and reuses the pending request (dedupe by email)', async () => {
    await saveRequest({ id: 'req-existing', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: new Date().toISOString() })

    const { status, body } = await call({ action: 'checkout', plan: 'premium', name: 'Ada', email: 'Ada@Example.com' })
    expect(status).toBe(200)
    expect(body.sessionId).toBe('cs_test_1')

    // The pending request was reused (no duplicate), and the id became the
    // stable client_reference_id the webhook attaches the entitlement to.
    expect(await listRequests()).toHaveLength(1)
    const arg = stripe.createCheckoutSession.mock.calls[0][0]
    expect(arg.requestId).toBe('request:req-existing')
    expect(arg.kind).toBe('prospect')
    expect(arg.priceId).toBe(PREMIUM_PRICE) // premium -> subscription price
    expect(arg.email).toBe('ada@example.com') // normalized
  })

  it('creates a fresh pending request for a brand-new prospect email', async () => {
    const { status } = await call({ action: 'checkout', plan: 'lifetime', name: 'Bob', email: 'bob@example.com' })
    expect(status).toBe(200)
    const requests = await listRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0].email).toBe('bob@example.com')
    expect(requests[0].status).toBe('pending')
    expect(stripe.createCheckoutSession.mock.calls[0][0].requestId).toBe(`request:${requests[0].id}`)
  })

  it('rejects a bad email for a prospect', async () => {
    const { status } = await call({ action: 'checkout', plan: 'lifetime', name: 'Bob', email: 'not-an-email' })
    expect(status).toBe(400)
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects the owner (admin session) with 403 PAYMENT_REQUIRED', async () => {
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime' }, { token: ADMIN_TOKEN })
    expect(status).toBe(403)
    expect(body.code).toBe('PAYMENT_REQUIRED')
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects the demo identity with 403 PAYMENT_REQUIRED', async () => {
    const { status } = await call({ action: 'checkout', plan: 'lifetime' }, { token: DEMO_TOKEN })
    expect(status).toBe(403)
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized session token with 401', async () => {
    const { status } = await call({ action: 'checkout', plan: 'lifetime' }, { token: 'invalid-opaque-session-token' })
    expect(status).toBe(401)
  })

  it('rejects a plan that is not purchasable with PRICE_UNKNOWN', async () => {
    // As a prospect (no session) so plan validation is what runs — only
    // premium/lifetime are purchasable; free/unlimited/bogus are not.
    const { status, body } = await call({ action: 'checkout', plan: 'free', name: 'Bob', email: 'bob@example.com' })
    expect(status).toBe(400)
    expect(body.code).toBe('PRICE_UNKNOWN')
    const { status: s2 } = await call({ action: 'checkout', plan: 'unlimited', name: 'Bob', email: 'bob@example.com' })
    expect(s2).toBe(400)
    const { status: s3 } = await call({ action: 'checkout', plan: 'bogus', name: 'Bob', email: 'bob@example.com' })
    expect(s3).toBe(400)
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects a plan with no configured price with PRICE_UNKNOWN (server-side price only)', async () => {
    delete process.env.STRIPE_PRICE_LIFETIME
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime', name: 'Bob', email: 'bob@example.com' })
    expect(status).toBe(400)
    expect(body.code).toBe('PRICE_UNKNOWN')
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('surfaces CHECKOUT_FAILED (502) when Stripe is unreachable', async () => {
    stripe.createCheckoutSession.mockRejectedValue(Object.assign(new Error('boom'), { code: 'STRIPE_API_ERROR', status: 500 }))
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime', name: 'Bob', email: 'bob@example.com' })
    expect(status).toBe(502)
    expect(body.code).toBe('CHECKOUT_FAILED')
  })

  it('fails closed (503) in production when no site URL is configured (m2, #54)', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.STRIPE_SITE_URL
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime', name: 'Bob', email: 'bob@example.com' })
    expect(status).toBe(503)
    expect(body.code).toBe('CHECKOUT_FAILED')
    // Never falls back to the request Host/Origin header in production, and no
    // Checkout session is created.
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })
})

describe('status — poll completion (webhook-first + reconcile)', () => {
  it('returns complete for a session the webhook already materialized, with the code once', async () => {
    // Simulate the webhook having landed: a user is already keyed on the session.
    await saveUser({ ...MEMBER, id: 'u-paid', plan: 'lifetime', stripeCheckoutSessionId: 'cs_test_1', stripeCustomerId: 'cus_123' })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.user.plan).toBe('lifetime')
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('stripeCheckoutSessionId')
    // The plaintext code is handed back to the session owner exactly once.
    expect(body.code).toBe('RU-AAAA-BBBB-CCCC')
    // No Stripe call needed — the webhook already landed.
    expect(stripe.retrieveSession).not.toHaveBeenCalled()
  })

  it('reconciles webhook lag via sessions.retrieve and materializes idempotently', async () => {
    stripe.retrieveSession.mockResolvedValue({
      id: 'cs_test_1',
      client_reference_id: 'request:req-1',
      customer_email: 'ada@example.com',
      customer: 'cus_123',
      mode: 'payment',
      payment_status: 'paid',
      status: 'complete',
    })
    await saveRequest({ id: 'req-1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: new Date().toISOString() })

    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.user.plan).toBe('lifetime')
    expect(body.code).toMatch(/^RU-/)
    expect(stripe.retrieveSession).toHaveBeenCalledWith('cs_test_1')

    // Both the webhook and the reconcile path are idempotent — a second poll
    // resolves through the index, not a duplicate account. And (M2) the code
    // was already delivered on the first poll, so it is NOT returned again.
    const { body: second } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(second.status).toBe('complete')
    expect(second).not.toHaveProperty('code')
    expect(await listUsers()).toHaveLength(1)
    expect(await findUserByStripeSession('cs_test_1')).toMatchObject({ id: body.user.id })
  })

  it('returns pending while the session is still open (not paid)', async () => {
    stripe.retrieveSession.mockResolvedValue({ id: 'cs_test_1', status: 'open', payment_status: 'unpaid' })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'pending' })
    expect(await listUsers()).toHaveLength(0)
  })

  it('surfaces PAYMENT_INCOMPLETE (409) when checkout finished but the money has not cleared', async () => {
    stripe.retrieveSession.mockResolvedValue({ id: 'cs_test_1', status: 'complete', payment_status: 'unpaid' })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(status).toBe(409)
    expect(body.code).toBe('PAYMENT_INCOMPLETE')
  })

  it('surfaces PAYMENT_INCOMPLETE (400) for a session id Stripe does not know', async () => {
    stripe.retrieveSession.mockRejectedValue(Object.assign(new Error('no session'), { code: 'STRIPE_API_ERROR', status: 404 }))
    const { status, body } = await call({ action: 'status', sessionId: 'cs_nope' })
    expect(status).toBe(400)
    expect(body.code).toBe('PAYMENT_INCOMPLETE')
  })

  it('surfaces CHECKOUT_FAILED (502) when Stripe is transiently down', async () => {
    stripe.retrieveSession.mockRejectedValue(Object.assign(new Error('boom'), { code: 'STRIPE_API_ERROR', status: 500 }))
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(status).toBe(502)
    expect(body.code).toBe('CHECKOUT_FAILED')
  })

  it('requires a sessionId', async () => {
    const { status } = await call({ action: 'status' })
    expect(status).toBe(400)
  })
})

describe('status — one-time code delivery (M2, #54)', () => {
  // The sessionId is a capability token: whoever holds `?session_id=…` can poll
  // it. The code must go out exactly once so a leaked URL can't read the
  // member's current code forever.

  it('returns the code on the first reconcile poll, then suppresses it', async () => {
    stripe.retrieveSession.mockResolvedValue({
      id: 'cs_test_1',
      client_reference_id: 'request:req-1',
      customer_email: 'ada@example.com',
      customer: 'cus_123',
      mode: 'payment',
      payment_status: 'paid',
      status: 'complete',
    })
    await saveRequest({ id: 'req-1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: new Date().toISOString() })

    const first = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(first.status).toBe(200)
    expect(first.body.status).toBe('complete')
    expect(first.body.code).toMatch(/^RU-/)
    // SEC-EPIC-1 (#176/#177): the brand-new prospect is signed STRAIGHT IN with
    // a fresh session token — the client never has to persist the code.
    expect(first.body.session).toMatch(/^[A-Za-z0-9_-]{20,}$/)

    // The SAME sessionId can no longer read the code — the delivery marker is
    // persisted at materialization + on the first poll.
    const second = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(second.status).toBe(200)
    expect(second.body.status).toBe('complete')
    expect(second.body.user.id).toBe(first.body.user.id)
    expect(second.body).not.toHaveProperty('code')
    expect(stripe.retrieveSession).toHaveBeenCalledTimes(1)
  })

  it('returns the code once for a webhook-materialized session, then suppresses it', async () => {
    await saveUser({ ...MEMBER, id: 'u-paid', plan: 'lifetime', stripeCheckoutSessionId: 'cs_test_1', stripeCustomerId: 'cus_123' })

    const first = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(first.body.code).toBe('RU-AAAA-BBBB-CCCC')

    const second = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(second.status).toBe(200)
    expect(second.body.status).toBe('complete')
    expect(second.body).not.toHaveProperty('code')
    // No Stripe call needed — the webhook already landed, so the second poll
    // resolves through the index only.
    expect(stripe.retrieveSession).not.toHaveBeenCalled()
  })

  it('never returns the code to a signed-in member (they already hold a session)', async () => {
    await saveUser({ ...MEMBER, plan: 'lifetime', stripeCheckoutSessionId: 'cs_test_1', stripeCustomerId: 'cus_123' })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' }, { token: MEMBER_TOKEN })
    expect(status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.user.id).toBe(MEMBER.id)
    expect(body).not.toHaveProperty('code')
    expect(body).not.toHaveProperty('session')
  })

  it('requires a valid Bearer session when one is presented on status', async () => {
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' }, { token: 'invalid-opaque-session-token' })
    expect(status).toBe(401)
    expect(body.error).toBeTruthy()
  })

  it('rejects the owner / demo Bearer on status (nothing to collect)', async () => {
    const owner = await call({ action: 'status', sessionId: 'cs_test_1' }, { token: ADMIN_TOKEN })
    expect(owner.status).toBe(403)
    const demo = await call({ action: 'status', sessionId: 'cs_test_1' }, { token: DEMO_TOKEN })
    expect(demo.status).toBe(403)
  })
})

describe('rate limiting (M1, #54)', () => {
  // Both `checkout` (pre-auth, email-only) and `status` (unauthenticated) are
  // public surfaces — per-IP + per-email fixed-window limits, mirroring
  // auth.js. Pre-seed the counter at the limit (collection.test.js pattern).

  it('429s checkout with RATE_LIMIT once the per-email window is exhausted', async () => {
    const rlStore = createStore()
    stores['runout-rate-limits'] = rlStore
    rlStore.data.set('rl:payment:checkout:email:ada@example.com', { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 5 })

    const { status, body } = await call({ action: 'checkout', plan: 'lifetime', email: 'Ada@Example.com' })
    expect(status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT')
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('429s checkout with RATE_LIMIT once the per-IP window is exhausted', async () => {
    const rlStore = createStore()
    stores['runout-rate-limits'] = rlStore
    rlStore.data.set('rl:payment:checkout:ip:203.0.113.9', { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 20 })

    const { status, body } = await call({ action: 'checkout', plan: 'lifetime', email: 'bob@example.com' }, { ip: '203.0.113.9' })
    expect(status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT')
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('429s status with RATE_LIMIT once the per-IP window is exhausted', async () => {
    const rlStore = createStore()
    stores['runout-rate-limits'] = rlStore
    rlStore.data.set('rl:payment:status:ip:203.0.113.9', { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 60 })

    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' }, { ip: '203.0.113.9' })
    expect(status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT')
    expect(stripe.retrieveSession).not.toHaveBeenCalled()
  })

  it('includes a Retry-After header on the 429', async () => {
    const rlStore = createStore()
    stores['runout-rate-limits'] = rlStore
    rlStore.data.set('rl:payment:checkout:email:ada@example.com', { w: windowIndex(Date.now(), RATE_LIMIT_WINDOW_MS), count: 5 })
    const res = await handler(req({ action: 'checkout', plan: 'lifetime', email: 'ada@example.com' }))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
  })
})

describe('portal — Stripe Billing Portal', () => {
  it('opens the portal for a paying member and returns { url }', async () => {
    await saveUser({ ...MEMBER, stripeCustomerId: 'cus_123' })
    const { status, body } = await call({ action: 'portal' }, { token: MEMBER_TOKEN })
    expect(status).toBe(200)
    expect(body).toEqual({ url: 'https://billing.stripe.com/session/xyz' })
    expect(stripe.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_123', returnUrl: 'https://halcova.app/?settings=plan' }),
    )
  })

  it('returns PAYMENT_INCOMPLETE (409) for a member with no Stripe customer yet', async () => {
    await saveUser(MEMBER) // free member, no billing
    const { status, body } = await call({ action: 'portal' }, { token: MEMBER_TOKEN })
    expect(status).toBe(409)
    expect(body.code).toBe('PAYMENT_INCOMPLETE')
    expect(stripe.createPortalSession).not.toHaveBeenCalled()
  })

  it('requires a signed-in member (a prospect has nothing to manage)', async () => {
    const { status } = await call({ action: 'portal', name: 'Bob', email: 'bob@example.com' })
    expect(status).toBe(401)
    expect(stripe.createPortalSession).not.toHaveBeenCalled()
  })

  it('rejects the owner with 403', async () => {
    const { status } = await call({ action: 'portal' }, { token: ADMIN_TOKEN })
    expect(status).toBe(403)
  })
})

describe('SEC-6.2 (#216) — status bound to the authenticated context', () => {
  // A second, distinct member whose checkout session must be unreadable by Ada.
  const B = { ...MEMBER, id: 'u-b', email: 'bob@example.com', name: 'Bob' }
  let B_TOKEN = ''

  beforeEach(async () => {
    B_TOKEN = await sessionTokenFor({ userId: 'u-b', role: 'member' })
  })

  it('rejects a signed-in user polling ANOTHER user\u2019s already-materialized session (fast path) with 403', async () => {
    // Bob's checkout is materialized (webhook landed); Ada (a different member)
    // tries to read its status/code with her own session token.
    await saveUser(MEMBER) // Ada must resolve as a live member for her Bearer
    await saveUser({ ...B, plan: 'lifetime', stripeCheckoutSessionId: 'cs_test_b', stripeCustomerId: 'cus_b', codeDelivered: false, codeDeliverableUntil: new Date(Date.now() + 3600_000).toISOString() })

    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_b' }, { token: MEMBER_TOKEN })
    expect(status).toBe(403)
    expect(body.code).toBe('SESSION_MISMATCH')
    // No delivered access code and no session token are leaked.
    expect(JSON.stringify(body)).not.toMatch(/RU-[A-Z0-9]{4}-/)
    expect(body).not.toHaveProperty('session')
    // Bob's code was NOT delivered and Bob was NOT signed in by Ada's poll.
    expect(stripe.retrieveSession).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user polling ANOTHER user\u2019s session on the reconcile path with 403', async () => {
    await saveUser(MEMBER) // Ada must resolve as a live member for her Bearer
    stripe.retrieveSession.mockResolvedValue({
      id: 'cs_test_b',
      client_reference_id: 'request:req-b',
      customer_email: 'bob@example.com',
      customer: 'cus_b',
      mode: 'payment',
      payment_status: 'paid',
      status: 'complete',
    })
    await saveRequest({ id: 'req-b', name: 'Bob', email: 'bob@example.com', status: 'pending', createdAt: new Date().toISOString() })

    // Ada polls Bob's session id — must be 403 BEFORE materializing Bob.
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_b' }, { token: MEMBER_TOKEN })
    expect(status).toBe(403)
    expect(body.code).toBe('SESSION_MISMATCH')
    // Bob was never materialized by Ada's attempt.
    expect(await findUserByStripeSession('cs_test_b')).toBeNull()
  })

  it('allows a signed-in member to poll their OWN session (status complete, no code)', async () => {
    await saveUser({ ...MEMBER, plan: 'lifetime', stripeCheckoutSessionId: 'cs_test_1', stripeCustomerId: 'cus_123' })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_1' }, { token: MEMBER_TOKEN })
    expect(status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.user.id).toBe(MEMBER.id)
    expect(body).not.toHaveProperty('code')
  })

  it('never returns the code from a STALE session whose delivery window has passed', async () => {
    // A materialized prospect whose 24h code-delivery window has elapsed,
    // code never collected.
    await saveUser({
      ...MEMBER,
      id: 'u-stale',
      plan: 'lifetime',
      stripeCheckoutSessionId: 'cs_test_stale',
      stripeCustomerId: 'cus_stale',
      codeDelivered: false,
      codeDeliverableUntil: new Date(Date.now() - 1000).toISOString(), // expired 1s ago
    })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_stale' })
    expect(status).toBe(200)
    expect(body.status).toBe('complete')
    // The window has passed — no code, even though it was never delivered.
    expect(body).not.toHaveProperty('code')
    // The user is still signed straight in via a fresh session token.
    expect(body.session).toMatch(/^[A-Za-z0-9_-]{20,}$/)
  })

  it('delivers the code exactly once within the window, never after (already delivered = no code)', async () => {
    await saveUser({
      ...MEMBER,
      id: 'u-once',
      plan: 'lifetime',
      stripeCheckoutSessionId: 'cs_test_once',
      stripeCustomerId: 'cus_once',
      codeDelivered: true, // already delivered
      codeDeliverableUntil: new Date(Date.now() + 3600_000).toISOString(),
    })
    const { status, body } = await call({ action: 'status', sessionId: 'cs_test_once' })
    expect(status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body).not.toHaveProperty('code')
  })
})

describe('dispatch', () => {
  it('rejects an unknown action', async () => {
    const { status } = await call({ action: 'refund' })
    expect(status).toBe(400)
  })

  it('rejects non-POST methods', async () => {
    const res = await handler(req({ action: 'checkout' }, { method: 'GET' }))
    expect(res.status).toBe(405)
  })
})
