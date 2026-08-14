// @vitest-environment node
//
// Unit tests for the plan model (netlify/functions/_shared/plans.js,
// ADR-0001 free tier + ADR-0003 §2.3 S2 entitlement model). Proves:
//   - PLAN_LIMITS caps ONLY the free plan; every paid plan (premium /
//     lifetime / unlimited) is uncapped (null),
//   - the free cap is config-driven via RUNOUT_FREE_LIMIT (default 10),
//   - planLimitFor only ever bites a known free plan: paid plans, the
//     admin/owner, unknown/missing plans, and null users are all uncapped.
//
// PLAN_LIMITS is a module-load-time const, so each test re-imports the module
// through vi.resetModules() + a dynamic import — letting a test stub
// RUNOUT_FREE_LIMIT before the module is evaluated.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PLAN_LIMITS — only the free plan is capped', () => {
  it('caps only free; every paid plan is uncapped (null)', async () => {
    const { PLAN_LIMITS } = await import('./plans')
    expect(PLAN_LIMITS.free).toBeGreaterThan(0)
    expect(PLAN_LIMITS.premium).toBeNull()
    expect(PLAN_LIMITS.lifetime).toBeNull()
    expect(PLAN_LIMITS.unlimited).toBeNull()
  })

  it('reads the free cap from RUNOUT_FREE_LIMIT (config-driven, default 10)', async () => {
    vi.stubEnv('RUNOUT_FREE_LIMIT', '3')
    const { PLAN_LIMITS } = await import('./plans')
    expect(PLAN_LIMITS.free).toBe(3)
  })

  it('a paid plan is never capped even when the free cap is raised', async () => {
    vi.stubEnv('RUNOUT_FREE_LIMIT', '999')
    const { PLAN_LIMITS, planLimitFor } = await import('./plans')
    expect(PLAN_LIMITS.free).toBe(999)
    expect(planLimitFor({ id: 'u1', role: 'member', plan: 'lifetime' })).toBeNull()
  })
})

describe('planLimitFor — the cap only ever bites a known free plan', () => {
  async function fresh() {
    return import('./plans')
  }

  it('returns the free cap for a plain free member', async () => {
    const { PLAN_LIMITS, planLimitFor } = await fresh()
    expect(planLimitFor({ id: 'u1', role: 'member', plan: 'free' })).toBe(PLAN_LIMITS.free)
  })

  it('returns null for every paid plan', async () => {
    const { planLimitFor } = await fresh()
    for (const plan of ['premium', 'lifetime', 'unlimited']) {
      expect(planLimitFor({ id: 'u1', role: 'member', plan })).toBeNull()
    }
  })

  it('never caps the admin/owner, whatever their plan', async () => {
    const { planLimitFor } = await fresh()
    expect(planLimitFor({ id: 'owner', role: 'admin', plan: 'free' })).toBeNull()
    expect(planLimitFor({ id: 'u1', role: 'admin', plan: 'free' })).toBeNull()
  })

  it('is defensive: unknown/missing plans and null users are uncapped', async () => {
    const { planLimitFor } = await fresh()
    expect(planLimitFor({ id: 'u1', role: 'member', plan: 'bogus' })).toBeNull()
    expect(planLimitFor({ id: 'u1', role: 'member', plan: undefined })).toBeNull()
    expect(planLimitFor({ id: 'u1', role: 'member' })).toBeNull()
    expect(planLimitFor({})).toBeNull()
    expect(planLimitFor(null)).toBeNull()
    expect(planLimitFor(undefined)).toBeNull()
  })
})
