// @vitest-environment node
//
// Unit tests for the shared auth helpers (netlify/functions/_shared/auth.js).
// Focused on publicUser (ADR-0003 §2.5, S2): it must NEVER leak the access
// code, its hash, or any of the three Stripe billing ids to the client — while
// keeping the client-facing fields the UI needs (plan, planExpiresAt,
// features, collections).

import { describe, expect, it } from 'vitest'
import { publicUser } from './auth'

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  code_hash: 'deadbeef'.repeat(8),
  collections: { records: true, books: true },
  features: { lending: true, games: false },
  plan: 'premium',
  planExpiresAt: '2027-08-14T00:00:00.000Z',
  planChangedAt: '2026-08-14T00:00:00.000Z',
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  stripeCheckoutSessionId: 'cs_test_123',
  role: 'member',
  status: 'active',
}

describe('publicUser — strips secrets, keeps client-facing fields', () => {
  it('never returns the access code or its hash', () => {
    const out = publicUser(MEMBER)
    expect(out).not.toHaveProperty('code')
    expect(out).not.toHaveProperty('code_hash')
  })

  it('never returns any of the three Stripe billing ids (S2)', () => {
    const out = publicUser(MEMBER)
    expect(out).not.toHaveProperty('stripeCustomerId')
    expect(out).not.toHaveProperty('stripeSubscriptionId')
    expect(out).not.toHaveProperty('stripeCheckoutSessionId')
  })

  it('keeps plan, planExpiresAt, features and collections for the client', () => {
    const out = publicUser(MEMBER)
    expect(out.plan).toBe('premium')
    expect(out.planExpiresAt).toBe('2027-08-14T00:00:00.000Z')
    expect(out.features).toEqual({ lending: true, games: false })
    expect(out.collections).toEqual({ records: true, books: true })
  })

  it('keeps every other identity field untouched', () => {
    const out = publicUser(MEMBER)
    expect(out).toMatchObject({ id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'member', status: 'active' })
    // planChangedAt is a plan-metadata field, not a secret — it stays.
    expect(out.planChangedAt).toBe('2026-08-14T00:00:00.000Z')
  })

  it('returns null for a null/undefined user', () => {
    expect(publicUser(null)).toBeNull()
    expect(publicUser(undefined)).toBeNull()
  })

  it('strips only the secret fields when they are absent', () => {
    const out = publicUser({ id: 'u2', name: 'Bob', plan: 'free' })
    expect(out).toEqual({ id: 'u2', name: 'Bob', plan: 'free' })
  })
})
