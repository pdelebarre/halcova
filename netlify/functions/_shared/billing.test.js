// @vitest-environment node
//
// Tests for the Stripe webhook handler (netlify/functions/billing.js, ADR-0003
// S3). The handler is signature-authenticated ONLY — no Bearer auth — and this
// suite exercises the REAL verifyWebhookSignature (HMAC over the raw body) and
// the REAL identity repository (blob repo via the in-memory @netlify/blobs
// mock), so idempotency is proven through the actual `stripe:session:<id>` /
// `stripe:subscription:<id>` indexes.
//
// Proves:
//   - a bad signature is rejected 400 before any JSON is interpreted,
//   - checkout.session.completed auto-issues an RU- code for a prospect (no
//     admin in the loop) and upgrades an existing member,
//   - replayed events are no-ops (idempotency),
//   - subscription.updated syncs planExpiresAt; subscription.deleted downgrades
//     to free; invoice.payment_failed keeps entitlements (no mutation),
//   - the response is a fast `{ received: true }` ack that never echoes a code.

import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../billing'
import { findUserByStripeSession, findUserByStripeSubscription, getUser, listUsers, saveRequest, saveUser } from './users'

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

const WEBHOOK_SECRET = 'whsec_billing_test'
const PREMIUM_PRICE = 'price_premium_test'
const LIFETIME_PRICE = 'price_lifetime_test'

function sign(rawBody, { secret = WEBHOOK_SECRET } = {}) {
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return `t=${t},v1=${v1}`
}

// A mock Netlify-function request carrying a raw text body + headers.
function req(rawBody, signature) {
  return {
    method: 'POST',
    headers: { get: (name) => (String(name).toLowerCase() === 'stripe-signature' ? signature : '') },
    text: async () => rawBody,
    json: async () => JSON.parse(rawBody),
  }
}

async function deliver(event, { secret = WEBHOOK_SECRET, method = 'POST' } = {}) {
  const rawBody = JSON.stringify(event)
  const signature = method === 'POST' ? sign(rawBody, { secret }) : undefined
  const res = await handler({ method, headers: { get: () => signature || '' }, text: async () => rawBody, json: async () => JSON.parse(rawBody) })
  return { status: res.status, body: await res.json() }
}

// The Stripe checkout.session.completed object for a one-time (lifetime) sale.
function lifetimeSession(overrides = {}) {
  return {
    id: 'cs_test_1',
    client_reference_id: 'request:req-1',
    customer_email: 'ada@example.com',
    customer: 'cus_123',
    mode: 'payment',
    payment_status: 'paid',
    status: 'complete',
    ...overrides,
  }
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.STRIPE_SECRET_KEY = 'sk_test_billing'
  process.env.STRIPE_PRICE_PREMIUM = PREMIUM_PRICE
  process.env.STRIPE_PRICE_LIFETIME = LIFETIME_PRICE
})

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_PRICE_PREMIUM
  delete process.env.STRIPE_PRICE_LIFETIME
  for (const key of Object.keys(stores)) delete stores[key]
})

async function seedRequest() {
  await saveRequest({ id: 'req-1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: new Date().toISOString() })
}

describe('webhook authentication', () => {
  it('rejects a bad signature with 400 before any JSON is interpreted', async () => {
    const rawBody = JSON.stringify({ type: 'checkout.session.completed' })
    const res = await handler(req(rawBody, 't=123,v1=deadbeef'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid signature.' })
    // Nothing was materialized.
    expect(await listUsers()).toHaveLength(0)
  })

  it('rejects a request signed with a different webhook secret', async () => {
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession() } }
    const { status } = await deliver(event, { secret: 'whsec_wrong' })
    expect(status).toBe(400)
    expect(await listUsers()).toHaveLength(0)
  })

  it('rejects a missing Stripe-Signature header', async () => {
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession() } }
    const rawBody = JSON.stringify(event)
    const res = await handler(req(rawBody, ''))
    expect(res.status).toBe(400)
  })

  it('only accepts POST', async () => {
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession() } }
    const { status } = await deliver(event, { method: 'GET' })
    expect(status).toBe(405)
  })
})

describe('checkout.session.completed — self-serve entitlement (no admin in the loop)', () => {
  it('creates a member, issues an RU- code, and flips the request to approved', async () => {
    await seedRequest()
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession({ current_period_end: 1900000000 }) } }
    const { status, body } = await deliver(event)

    expect(status).toBe(200)
    // Fast ack — the code is NEVER echoed to the webhook caller.
    expect(body).toEqual({ received: true })

    const users = await listUsers()
    expect(users).toHaveLength(1)
    const user = users[0]
    expect(user.email).toBe('ada@example.com')
    expect(user.plan).toBe('lifetime')
    expect(user.planExpiresAt).toBe(new Date(1900000000 * 1000).toISOString())
    expect(user.stripeCustomerId).toBe('cus_123')
    expect(user.stripeCheckoutSessionId).toBe('cs_test_1')
    expect(user.role).toBe('member')
    // A fresh RU- access code was issued and stored.
    expect(user.code).toMatch(/^RU-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    // The O(1) idempotency index resolves the materialized user.
    expect(await findUserByStripeSession('cs_test_1')).toMatchObject({ id: user.id })
  })

  it('is idempotent — a replayed checkout event is a no-op', async () => {
    await seedRequest()
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession() } }
    expect((await deliver(event)).status).toBe(200)
    expect(await listUsers()).toHaveLength(1)

    // Stripe redelivery of the SAME event: 200 ack, no second account.
    expect((await deliver(event)).status).toBe(200)
    expect(await listUsers()).toHaveLength(1)
    // Same user, same code — nothing re-created.
    expect((await findUserByStripeSession('cs_test_1')).code).toMatch(/^RU-/)
  })

  it('upgrades an existing member, preserving their code and collections', async () => {
    const existing = {
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
    await saveUser(existing)
    // A subscription-mode session (premium) for the same email.
    const session = lifetimeSession({
      id: 'cs_test_upgrade',
      client_reference_id: 'request:req-upgrade',
      mode: 'subscription',
      payment_status: 'paid',
      subscription: 'sub_premium_1',
      current_period_end: 1900000000,
    })
    const event = { type: 'checkout.session.completed', data: { object: session } }
    const { status } = await deliver(event)
    expect(status).toBe(200)

    // One member — no duplicate account created.
    expect(await listUsers()).toHaveLength(1)
    const upgraded = await findUserByStripeSession('cs_test_upgrade')
    expect(upgraded.plan).toBe('premium')
    expect(upgraded.stripeSubscriptionId).toBe('sub_premium_1')
    expect(upgraded.planExpiresAt).toBe(new Date(1900000000 * 1000).toISOString())
    // The member keeps their original code and collections.
    expect(upgraded.code).toBe('RU-AAAA-BBBB-CCCC')
    expect(upgraded.collections).toEqual({ records: true, books: true })
  })
})

describe('subscription lifecycle events', () => {
  async function seedPremiumMember(overrides = {}) {
    const user = {
      id: 'u-sub',
      name: 'Ada',
      email: 'ada@example.com',
      code: 'RU-AAAA-BBBB-CCCC',
      collections: { records: true, books: true },
      features: {},
      plan: 'premium',
      role: 'member',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_1',
      stripeCheckoutSessionId: 'cs_test_1',
      planExpiresAt: '2026-12-01T00:00:00.000Z',
      ...overrides,
    }
    await saveUser(user)
    return user
  }

  it('customer.subscription.updated syncs planExpiresAt from current_period_end', async () => {
    await seedPremiumMember()
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_123',
          current_period_end: 1950000000,
          items: { data: [{ price: { id: PREMIUM_PRICE } }] },
        },
      },
    }
    const { status, body } = await deliver(event)
    expect(status).toBe(200)
    expect(body).toEqual({ received: true })

    const user = await findUserByStripeSubscription('sub_1')
    expect(user.plan).toBe('premium')
    expect(user.planExpiresAt).toBe(new Date(1950000000 * 1000).toISOString())
  })

  it('customer.subscription.deleted downgrades to free (items kept — the cap only blocks adds)', async () => {
    await seedPremiumMember()
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_123' } },
    }
    const { status } = await deliver(event)
    expect(status).toBe(200)

    const user = await findUserByStripeSubscription('sub_1')
    expect(user.plan).toBe('free')
    expect(user.planExpiresAt).toBeNull()
    // Billing ids are kept for idempotency / the portal.
    expect(user.stripeSubscriptionId).toBe('sub_1')
    expect(user.stripeCustomerId).toBe('cus_123')
    // Collections stay — existing items remain browsable.
    expect(user.collections).toEqual({ records: true, books: true })
  })

  it('customer.subscription.updated for an unknown subscription is a no-op', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_nobody', customer: 'cus_999', current_period_end: 1950000000 } },
    }
    const { status } = await deliver(event)
    expect(status).toBe(200)
    expect(await listUsers()).toHaveLength(0)
  })

  it('invoice.payment_failed keeps entitlements and records only (no mutation)', async () => {
    await seedPremiumMember({ planExpiresAt: '2026-12-01T00:00:00.000Z' })
    const event = {
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', subscription: 'sub_1', customer: 'cus_123' } },
    }
    const { status } = await deliver(event)
    expect(status).toBe(200)

    // Entitlements unchanged — still premium, expiry untouched.
    const user = await findUserByStripeSubscription('sub_1')
    expect(user.plan).toBe('premium')
    expect(user.planExpiresAt).toBe('2026-12-01T00:00:00.000Z')
  })
})

describe('unhandled event types', () => {
  it('acks unknown events with 200 received (Stripe treats 2xx as delivered)', async () => {
    const event = { type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_other' } } }
    const { status, body } = await deliver(event)
    expect(status).toBe(200)
    expect(body).toEqual({ received: true })
    expect(await listUsers()).toHaveLength(0)
  })
})

describe('the webhook never leaks the access code', () => {
  it('the ack body contains only { received: true }', async () => {
    await seedRequest()
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession() } }
    const { body } = await deliver(event)
    expect(JSON.stringify(body)).not.toMatch(/RU-/)
    expect(body).toEqual({ received: true })
  })

  it('the code lives on the stored user record, retrievable via the session index', async () => {
    await seedRequest()
    const event = { type: 'checkout.session.completed', data: { object: lifetimeSession() } }
    await deliver(event)
    const user = await getUser((await listUsers())[0].id)
    expect(user.code).toMatch(/^RU-/)
  })
})
