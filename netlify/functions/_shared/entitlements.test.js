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

import { describe, expect, it } from 'vitest'
import { PAID_PLANS, effectiveFeatures, isPaidPlan } from './entitlements'

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
