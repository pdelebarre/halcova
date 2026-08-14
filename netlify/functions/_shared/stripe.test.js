// @vitest-environment node
//
// Tests for the server-only Stripe helpers (_shared/stripe.js, ADR-0003 S3).
// Proves:
//   - verifyWebhookSignature accepts a correctly-signed raw body (HMAC-SHA256
//     over `${t}.${payload}` with STRIPE_WEBHOOK_SECRET, constant-time compare)
//     and rejects a wrong secret / tampered body / stale timestamp / malformed
//     header / missing secret,
//   - priceIdForPlan maps the two env price ids to premium/lifetime and
//     nothing else (the client never sends an amount),
//   - the REST helpers (createCheckoutSession / retrieveSession /
//     createPortalSession) hit the Stripe API with Basic auth + form bodies
//     and surface STRIPE_NOT_CONFIGURED / STRIPE_API_ERROR. All fetch is mocked.

import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCheckoutSession,
  createPortalSession,
  priceIdForPlan,
  retrieveSession,
  verifyWebhookSignature,
} from './stripe'

const WEBHOOK_SECRET = 'whsec_test_123'
const API_KEY = 'sk_test_123'

function sign(rawBody, { secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return `t=${t},v1=${v1}`
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.STRIPE_SECRET_KEY = API_KEY
})

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_PRICE_PREMIUM
  delete process.env.STRIPE_PRICE_LIFETIME
  vi.restoreAllMocks()
})

describe('verifyWebhookSignature — raw-body HMAC over `t.payload`', () => {
  const rawBody = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } })

  it('accepts a correctly signed body', () => {
    expect(verifyWebhookSignature({ rawBody, signature: sign(rawBody) })).toBe(true)
  })

  it('rejects a body signed with a different secret', () => {
    expect(verifyWebhookSignature({ rawBody, signature: sign(rawBody, { secret: 'wrong-secret' }) })).toBe(false)
  })

  it('rejects a body whose payload was tampered with after signing', () => {
    const signature = sign(rawBody)
    // Same signature, different body — the HMAC no longer matches.
    expect(verifyWebhookSignature({ rawBody: `${rawBody} `, signature })).toBe(false)
  })

  it('rejects a signature outside the replay-window tolerance (stale)', () => {
    const now = Date.now()
    const t = Math.floor(now / 1000) - 400 // just inside the 300s default? no — outside
    const signature = sign(rawBody, { t })
    expect(verifyWebhookSignature({ rawBody, signature, now })).toBe(false)
    // Inside the tolerance it is accepted (clock skew).
    const tInside = Math.floor(now / 1000) - 200
    expect(verifyWebhookSignature({ rawBody, signature: sign(rawBody, { t: tInside }), now })).toBe(true)
  })

  it('rejects a malformed or missing signature header', () => {
    expect(verifyWebhookSignature({ rawBody, signature: '' })).toBe(false)
    expect(verifyWebhookSignature({ rawBody, signature: 'v1=abc' })).toBe(false)
    expect(verifyWebhookSignature({ rawBody, signature: 't=123' })).toBe(false)
    expect(verifyWebhookSignature({ rawBody, signature: 'not-a-signature' })).toBe(false)
    expect(verifyWebhookSignature({ rawBody, signature: null })).toBe(false)
  })

  it('rejects when STRIPE_WEBHOOK_SECRET is absent', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    expect(verifyWebhookSignature({ rawBody, signature: sign(rawBody) })).toBe(false)
  })

  it('honors an injectable tolerance (tests can shrink the window)', () => {
    const now = Date.now()
    const t = Math.floor(now / 1000) - 10
    const signature = sign(rawBody, { t })
    expect(verifyWebhookSignature({ rawBody, signature, now, toleranceSeconds: 5 })).toBe(false)
    expect(verifyWebhookSignature({ rawBody, signature, now, toleranceSeconds: 60 })).toBe(true)
  })
})

describe('priceIdForPlan — server-side price mapping', () => {
  it('maps the env price ids to the two purchasable plans', () => {
    process.env.STRIPE_PRICE_PREMIUM = 'price_premium_1'
    process.env.STRIPE_PRICE_LIFETIME = 'price_lifetime_1'
    expect(priceIdForPlan('premium')).toBe('price_premium_1')
    expect(priceIdForPlan('lifetime')).toBe('price_lifetime_1')
  })

  it('returns undefined for plans with no configured price / unknown plans', () => {
    expect(priceIdForPlan('premium')).toBeUndefined() // env unset
    expect(priceIdForPlan('lifetime')).toBeUndefined()
    expect(priceIdForPlan('free')).toBeUndefined()
    expect(priceIdForPlan('unlimited')).toBeUndefined()
    expect(priceIdForPlan('bogus')).toBeUndefined()
    expect(priceIdForPlan(null)).toBeUndefined()
    expect(priceIdForPlan(undefined)).toBeUndefined()
  })
})

describe('REST helpers — dependency-free Stripe client (fetch mocked)', () => {
  function okJson(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data }
  }
  function errorJson(message, status) {
    return { ok: false, status, json: async () => ({ error: { message } }) }
  }

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('createCheckoutSession POSTs a form body with Basic auth and returns { id, url }', async () => {
    global.fetch.mockResolvedValue(okJson({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }))
    const out = await createCheckoutSession({
      plan: 'lifetime',
      priceId: 'price_lifetime_1',
      requestId: 'request:req-1',
      email: 'ada@example.com',
      kind: 'prospect',
      successUrl: 'https://halcova.app/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://halcova.app/?checkout=cancelled',
    })
    expect(out).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('https://api.stripe.com/v1/checkout/sessions')
    expect(init.method).toBe('POST')
    const basicAuth = 'Basic ' + Buffer.from(`${API_KEY}:`).toString('base64')
    expect(init.headers.Authorization).toBe(basicAuth)
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(init.body)
    expect(params.get('mode')).toBe('payment') // lifetime -> one-time payment
    expect(params.get('line_items[0][price]')).toBe('price_lifetime_1')
    expect(params.get('client_reference_id')).toBe('request:req-1')
    expect(params.get('customer_email')).toBe('ada@example.com')
    expect(params.get('metadata[kind]')).toBe('prospect')
    expect(params.get('success_url')).toContain('{CHECKOUT_SESSION_ID}')
  })

  it('maps premium to a subscription-mode session', async () => {
    global.fetch.mockResolvedValue(okJson({ id: 'cs_test_2', url: 'https://checkout.stripe.com/c/pay/cs_test_2' }))
    await createCheckoutSession({ plan: 'premium', priceId: 'price_premium_1' })
    const [, init] = global.fetch.mock.calls[0]
    expect(new URLSearchParams(init.body).get('mode')).toBe('subscription')
  })

  it('retrieveSession GETs the session and returns the parsed body', async () => {
    global.fetch.mockResolvedValue(okJson({ id: 'cs_test_1', payment_status: 'paid' }))
    const session = await retrieveSession('cs_test_1')
    expect(session).toEqual({ id: 'cs_test_1', payment_status: 'paid' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toMatch(/https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/cs_test_1\?$/)
    expect(init.method).toBe('GET')
  })

  it('createPortalSession POSTs the customer and returns { url }', async () => {
    global.fetch.mockResolvedValue(okJson({ url: 'https://billing.stripe.com/session/xyz' }))
    const out = await createPortalSession({ customerId: 'cus_123', returnUrl: 'https://halcova.app/?settings=plan' })
    expect(out).toEqual({ url: 'https://billing.stripe.com/session/xyz' })
    const [, init] = global.fetch.mock.calls[0]
    const params = new URLSearchParams(init.body)
    expect(params.get('customer')).toBe('cus_123')
    expect(params.get('return_url')).toBe('https://halcova.app/?settings=plan')
  })

  it('throws STRIPE_NOT_CONFIGURED when the secret key is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY
    await expect(createCheckoutSession({ plan: 'lifetime', priceId: 'x' }))
      .rejects.toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' })
  })

  it('throws STRIPE_API_ERROR (with status) on a non-2xx response', async () => {
    global.fetch.mockResolvedValue(errorJson('No such checkout session', 404))
    await expect(retrieveSession('cs_nope')).rejects.toMatchObject({ code: 'STRIPE_API_ERROR', status: 404 })
  })
})
