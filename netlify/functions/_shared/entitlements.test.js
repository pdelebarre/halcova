// @vitest-environment node
//
// Unit tests for the entitlement resolver (netlify/functions/_shared/
// entitlements.js, ADR-0003 §2.3 — S2). Proves:
//   - any paid plan (premium / lifetime / unlimited) derives lending: true,
//   - the free plan does NOT (unless the admin granted features.lending),
//   - the admin/owner role is always entitled regardless of plan/features,
//   - the raw features map (incl. `games`) is never rebuilt here, so the
//     games-entitlement integration stays untouched,
//   - a null/unknown user is defensively handled (lending: false).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PAID_PLANS,
  applyEntitlement,
  effectiveFeatures,
  isPaidPlan,
  materializeCheckoutSession,
} from './entitlements'

// The free tier is the only capped plan; every paid plan must be uncapped (the
// cap is enforced via planLimitFor in _shared/plans.js — see that module).
const PAID_USER = (plan) => ({ id: 'u1', role: 'member', plan, features: {}, status: 'active' })
const FREE_USER = { id: 'u1', role: 'member', plan: 'free', features: {}, status: 'active' }

describe('isPaidPlan', () => {
  it('treats premium, lifetime and unlimited as paid', () => {
    expect(PAID_PLANS).toEqual(['premium', 'lifetime', 'unlimited'])
    for (const plan of PAID_PLANS) expect(isPaidPlan(PAID_USER(plan))).toBe(true)
  })

  it('treats free and unknown/missing plans as not paid', () => {
    expect(isPaidPlan(FREE_USER)).toBe(false)
    expect(isPaidPlan({ ...FREE_USER, plan: 'bogus' })).toBe(false)
    expect(isPaidPlan({ ...FREE_USER, plan: undefined })).toBe(false)
    expect(isPaidPlan(null)).toBe(false)
  })
})

describe('effectiveFeatures — lending is derived from the plan', () => {
  it('includes lending for every paid plan', () => {
    for (const plan of PAID_PLANS) {
      expect(effectiveFeatures(PAID_USER(plan))).toEqual({ lending: true })
    }
  })

  it('excludes lending on the free plan unless the admin granted features.lending', () => {
    expect(effectiveFeatures(FREE_USER)).toEqual({ lending: false })
    // Admin's manual per-account override wins even on the free plan.
    expect(effectiveFeatures({ ...FREE_USER, features: { lending: true } })).toEqual({ lending: true })
  })

  it('always includes lending for the admin/owner role, regardless of plan', () => {
    // Owner-style identity from authorize()/profileForCode: role admin.
    expect(effectiveFeatures({ id: 'owner', role: 'admin', plan: undefined, features: {} })).toEqual({ lending: true })
    // A member on the free plan who is role admin is still entitled.
    expect(effectiveFeatures({ ...FREE_USER, role: 'admin' })).toEqual({ lending: true })
  })

  it('excludes lending for the demo identity (no flags, not paid, not admin)', () => {
    expect(effectiveFeatures({ id: 'demo', role: 'demo', features: {}, status: 'active' })).toEqual({ lending: false })
  })

  it('does not derive games — the raw features map is left untouched', () => {
    // A games-only free member gets no lending, and the returned map only has
    // `lending` — the games entitlement lives on user.features.games, not here.
    const result = effectiveFeatures({ ...FREE_USER, features: { games: true } })
    expect(result).toEqual({ lending: false })
    expect(result).not.toHaveProperty('games')
    // A paid member with no manual flags still gets lending, but no games.
    expect(effectiveFeatures(PAID_USER('lifetime'))).toEqual({ lending: true })
  })

  it('is defensive for a missing/null user', () => {
    expect(effectiveFeatures(null)).toEqual({ lending: false })
    expect(effectiveFeatures(undefined)).toEqual({ lending: false })
    expect(effectiveFeatures({})).toEqual({ lending: false })
  })
})

// ---- S3: applyEntitlement (ADR-0003 §2.3, payment-webhook materialization) --

const BASE_USER = { id: 'u1', role: 'member', plan: 'free', features: {}, status: 'active' }

// A Stripe event shaped either as a webhook event ({ type, data: { object } })
// or the normalized reconcile shape ({ type, object }).
const toIso = (epochSeconds) => new Date(Number(epochSeconds) * 1000).toISOString()

describe('applyEntitlement — idempotently materialize a Stripe event', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_PREMIUM = 'price_premium_1'
    process.env.STRIPE_PRICE_LIFETIME = 'price_lifetime_1'
  })
  afterEach(() => {
    delete process.env.STRIPE_PRICE_PREMIUM
    delete process.env.STRIPE_PRICE_LIFETIME
  })

  it('checkout.session.completed (one-time) grants lifetime + the billing ids', () => {
    const out = applyEntitlement(BASE_USER, {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1', mode: 'payment', payment_status: 'paid',
          customer: 'cus_123', current_period_end: 1900000000,
        },
      },
    })
    expect(out.plan).toBe('lifetime')
    expect(out.stripeCheckoutSessionId).toBe('cs_test_1')
    expect(out.stripeCustomerId).toBe('cus_123')
    expect(out.planExpiresAt).toBe(toIso(1900000000))
    expect(out.planChangedAt).toBeTruthy()
    // The input user is never mutated.
    expect(BASE_USER.plan).toBe('free')
  })

  it('checkout.session.completed (subscription mode) grants premium', () => {
    const out = applyEntitlement(BASE_USER, {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', mode: 'subscription', payment_status: 'paid', customer: 'cus_123', subscription: 'sub_1' } },
    })
    expect(out.plan).toBe('premium')
    expect(out.stripeSubscriptionId).toBe('sub_1')
  })

  it('does NOT materialize an unpaid checkout (async payment not cleared)', () => {
    const out = applyEntitlement(BASE_USER, {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', mode: 'payment', payment_status: 'unpaid' } },
    })
    expect(out.plan).toBe('free')
    expect(out.stripeCheckoutSessionId).toBeUndefined()
  })

  it('customer.subscription.updated syncs plan + planExpiresAt from the price / period', () => {
    const out = applyEntitlement(BASE_USER, {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1', customer: 'cus_123', current_period_end: 1950000000,
          items: { data: [{ price: { id: 'price_premium_1' } }] },
        },
      },
    })
    expect(out.plan).toBe('premium')
    expect(out.stripeSubscriptionId).toBe('sub_1')
    expect(out.planExpiresAt).toBe(toIso(1950000000))
  })

  it('subscription sync with an unknown price keeps the existing plan', () => {
    const paid = { ...BASE_USER, plan: 'premium' }
    const out = applyEntitlement(paid, {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', items: { data: [{ price: { id: 'price_unknown' } }] } } },
    })
    expect(out.plan).toBe('premium')
  })

  it('customer.subscription.deleted downgrades to free (billing ids kept)', () => {
    const paid = { ...BASE_USER, plan: 'premium', planExpiresAt: toIso(1950000000), stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_123' }
    const out = applyEntitlement(paid, {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_123' } },
    })
    expect(out.plan).toBe('free')
    expect(out.planExpiresAt).toBeNull()
    expect(out.stripeSubscriptionId).toBe('sub_1')
    expect(out.stripeCustomerId).toBe('cus_123')
  })

  it('invoice.payment_failed keeps entitlements (no mutation)', () => {
    const paid = { ...BASE_USER, plan: 'premium', planExpiresAt: toIso(1950000000) }
    const out = applyEntitlement(paid, {
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', subscription: 'sub_1', customer: 'cus_123' } },
    })
    expect(out).toEqual(paid)
  })

  it('accepts the normalized reconcile shape ({ type, object }) — status-poll path', () => {
    const out = applyEntitlement(BASE_USER, {
      type: 'checkout.session.completed',
      object: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', customer: 'cus_123' },
    })
    expect(out.plan).toBe('lifetime')
  })

  it('is defensive: null user and events without a type/object return the user unchanged', () => {
    expect(applyEntitlement(null, {})).toBeNull()
    expect(applyEntitlement(BASE_USER, null)).toEqual(BASE_USER)
    expect(applyEntitlement(BASE_USER, { type: 'ping' })).toEqual(BASE_USER)
  })
})

// ---- S3: materializeCheckoutSession (the shared webhook/reconcile path) -----

describe('materializeCheckoutSession — shared, idempotent materializer', () => {
  const saved = { users: [], requests: [] }
  // The fake repo mirrors the real saveUser/saveRequest UPSERT semantics (the
  // real repository replaces by id) so a duplicate materialization cannot add
  // a second record.
  const upsert = (list) => (record) => {
    const i = list.findIndex((x) => x.id === record.id)
    if (i >= 0) list[i] = record; else list.push(record)
    return record
  }
  const deps = () => ({
    saveUser: upsert(saved.users),
    saveRequest: upsert(saved.requests),
    findUserByEmail: async (email) => saved.users.find((u) => u.email === email) || null,
    getRequest: async (id) => saved.requests.find((r) => r.id === id) || null,
    generateAccessCode: () => 'RU-TEST-TEST-TEST',
    randomUUID: () => 'gen-uuid',
  })

  beforeEach(() => {
    saved.users.length = 0
    saved.requests.length = 0
    process.env.STRIPE_PRICE_LIFETIME = 'price_lifetime_1'
  })
  afterEach(() => {
    delete process.env.STRIPE_PRICE_LIFETIME
  })

  const session = (overrides = {}) => ({
    id: 'cs_test_1',
    client_reference_id: 'request:req-1',
    customer_email: 'ada@example.com',
    customer: 'cus_123',
    mode: 'payment',
    payment_status: 'paid',
    ...overrides,
  })

  it('creates a member with an issued RU- code for a brand-new prospect', async () => {
    saved.requests.push({ id: 'req-1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' })
    const { user, code } = await materializeCheckoutSession(session(), deps())

    expect(code).toBe('RU-TEST-TEST-TEST')
    expect(user).toMatchObject({ id: 'gen-uuid', email: 'ada@example.com', role: 'member', plan: 'lifetime', stripeCheckoutSessionId: 'cs_test_1' })
    expect(saved.users).toHaveLength(1)
    expect(saved.users[0].code).toBe('RU-TEST-TEST-TEST')
    // The pending request was flipped to approved.
    expect(saved.requests[0].status).toBe('approved')
  })

  it('upgrades an existing member, preserving their code (code returned is null)', async () => {
    saved.users.push({ id: 'u-member', name: 'Ada', email: 'ada@example.com', code: 'RU-KEEP-KEEP-KEEP', plan: 'free', role: 'member', status: 'active', collections: { records: true, books: true }, features: {} })
    const { user, code } = await materializeCheckoutSession(session({ mode: 'subscription' }), deps())

    expect(code).toBeNull() // existing member keeps their code
    expect(user.plan).toBe('premium')
    expect(user.code).toBe('RU-KEEP-KEEP-KEEP')
    expect(saved.users).toHaveLength(1) // no duplicate account
  })

  it('throws when the session has no email to attribute', async () => {
    await expect(materializeCheckoutSession({ id: 'cs_test_1', mode: 'payment' }, deps()))
      .rejects.toThrow(/no email/i)
  })
})
