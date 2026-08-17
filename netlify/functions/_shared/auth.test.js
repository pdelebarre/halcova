// @vitest-environment node
//
// Unit tests for the shared auth helpers (netlify/functions/_shared/auth.js).
// Focused on publicUser (ADR-0003 §2.5, S2): it must NEVER leak the access
// code, its hash, or any of the three Stripe billing ids to the client — while
// keeping the client-facing fields the UI needs (plan, planExpiresAt,
// features, collections).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bearer, publicUser } from './auth'

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

// FINDING-2 — the Authorization auth-scheme is case-insensitive per RFC 7235,
// but the token's own case is preserved (session tokens are case-sensitive).
describe('bearer — case-insensitive auth scheme (RFC 7235)', () => {
  const authHeader = (value) => ({ headers: { get: () => value } })

  it('extracts the token for Bearer / bearer / BEARER alike', () => {
    const token = 'AbC123_xYz'
    for (const scheme of ['Bearer ', 'bearer ', 'BEARER ']) {
      expect(bearer(authHeader(`${scheme}${token}`))).toBe(token)
    }
  })

  it('preserves the credential case and trims surrounding whitespace', () => {
    expect(bearer(authHeader('Bearer  AbC_xYz  '))).toBe('AbC_xYz')
  })

  it('returns "" for a missing or non-bearer header', () => {
    expect(bearer(authHeader(null))).toBe('')
    expect(bearer(authHeader('Basic abc'))).toBe('')
  })
})

// SEC-1.5 (#180) — ADMIN_KEY must FAIL CLOSED in production-like environments.
// ADMIN_KEY is a module-level constant, so each case re-imports the module with
// the desired env (vi.resetModules + dynamic import).
describe('ADMIN_KEY — fail closed in production (#180)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    delete process.env.RUNOUT_ADMIN_KEY
    delete process.env.RUNOUT_DEV_MODE
    delete process.env.NETLIFY
    delete process.env.NETLIFY_LOCAL
    delete process.env.NETLIFY_DEV
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  async function loadAdminKey() {
    const mod = await import('./auth')
    return mod.ADMIN_KEY
  }

  it('is EMPTY (never the dev default) when NODE_ENV=production and no key is set', async () => {
    process.env.NODE_ENV = 'production'
    expect(await loadAdminKey()).toBe('')
  })

  it('is EMPTY when running under the Netlify CLI (deployed context) with no key', async () => {
    process.env.NETLIFY = 'true'
    expect(await loadAdminKey()).toBe('')
  })

  it('is EMPTY when NETLIFY_LOCAL is set with no key', async () => {
    process.env.NETLIFY_LOCAL = 'true'
    expect(await loadAdminKey()).toBe('')
  })

  it('is EMPTY when NETLIFY_DEV is set with no key', async () => {
    process.env.NETLIFY_DEV = 'true'
    expect(await loadAdminKey()).toBe('')
  })

  it('uses the dev fallback only in a plain local (non-production, non-Netlify) context', async () => {
    delete process.env.NODE_ENV
    delete process.env.NETLIFY
    expect(await loadAdminKey()).toBe('runout-dev-admin-key')
  })

  it('honors an explicit RUNOUT_DEV_MODE=1 opt-in even under NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_DEV_MODE = '1'
    expect(await loadAdminKey()).toBe('runout-dev-admin-key')
  })

  it('always uses the configured RUNOUT_ADMIN_KEY when present (dev or prod)', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_ADMIN_KEY = 'a-real-long-random-prod-key'
    expect(await loadAdminKey()).toBe('a-real-long-random-prod-key')
  })

  it('in production without a key, an admin login refuses (no silent dev default)', async () => {
    // Fail-closed end-to-end: login with the (now-empty) admin key cannot
    // resolve the owner — there is no fallback credential to accept.
    process.env.NODE_ENV = 'production'
    const { ADMIN_KEY: key } = await import('./auth')
    expect(key).toBe('')
  })
})
