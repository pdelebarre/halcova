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
//     sessions.retrieve (both idempotent), returning the issued code once,
//   - portal opens the Billing Portal for a paying member only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../payment'
import * as stripe from './stripe'
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

function req(body, { method = 'POST', code } = {}) {
  return {
    method,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'authorization' && code ? `Bearer ${code}` : ''),
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

beforeEach(() => {
  process.env.STRIPE_PRICE_PREMIUM = PREMIUM_PRICE
  process.env.STRIPE_PRICE_LIFETIME = LIFETIME_PRICE
  process.env.STRIPE_SECRET_KEY = 'sk_test_pay'
  process.env.STRIPE_SITE_URL = 'https://halcova.app'
  stripe.createCheckoutSession.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  stripe.retrieveSession.mockResolvedValue({ id: 'cs_test_1', status: 'complete', payment_status: 'paid' })
  stripe.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/xyz' })
})

afterEach(() => {
  delete process.env.STRIPE_PRICE_PREMIUM
  delete process.env.STRIPE_PRICE_LIFETIME
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SITE_URL
  for (const key of Object.keys(stores)) delete stores[key]
  vi.clearAllMocks()
})

describe('checkout — create a Checkout session', () => {
  it('creates a session for a Bearer-authenticated member (kind=member)', async () => {
    await saveUser(MEMBER)
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime' }, { code: 'RU-AAAA-BBBB-CCCC' })
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

  it('rejects the owner (admin key) with 403 PAYMENT_REQUIRED', async () => {
    const { status, body } = await call({ action: 'checkout', plan: 'lifetime' }, { code: 'runout-dev-admin-key' })
    expect(status).toBe(403)
    expect(body.code).toBe('PAYMENT_REQUIRED')
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects the demo identity with 403 PAYMENT_REQUIRED', async () => {
    const { status } = await call({ action: 'checkout', plan: 'lifetime' }, { code: 'RUNOUT-DEMO-0000' })
    expect(status).toBe(403)
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized access code with 401', async () => {
    const { status } = await call({ action: 'checkout', plan: 'lifetime' }, { code: 'RU-NOPE-NOPE-NOPE' })
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
    // resolves through the index, not a duplicate account.
    const { body: second } = await call({ action: 'status', sessionId: 'cs_test_1' })
    expect(second.status).toBe('complete')
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

describe('portal — Stripe Billing Portal', () => {
  it('opens the portal for a paying member and returns { url }', async () => {
    await saveUser({ ...MEMBER, stripeCustomerId: 'cus_123' })
    const { status, body } = await call({ action: 'portal' }, { code: 'RU-AAAA-BBBB-CCCC' })
    expect(status).toBe(200)
    expect(body).toEqual({ url: 'https://billing.stripe.com/session/xyz' })
    expect(stripe.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_123', returnUrl: 'https://halcova.app/?settings=plan' }),
    )
  })

  it('returns PAYMENT_INCOMPLETE (409) for a member with no Stripe customer yet', async () => {
    await saveUser(MEMBER) // free member, no billing
    const { status, body } = await call({ action: 'portal' }, { code: 'RU-AAAA-BBBB-CCCC' })
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
    const { status } = await call({ action: 'portal' }, { code: 'runout-dev-admin-key' })
    expect(status).toBe(403)
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
