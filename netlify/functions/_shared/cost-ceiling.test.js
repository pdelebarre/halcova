// @vitest-environment node
//
// Tests for the AI cost-ceiling primitive (_shared/cost-ceiling.js, SEC-7.4
// #341). This is the generic, deterministic hard-stop primitive only — no AI
// provider integration. Proof:
//   - per-request token ceiling -> 413 AI_TOKENS_EXCEEDED
//   - per-request USD ceiling   -> 429 AI_COST_LIMIT
//   - per-identity daily requests/tokens + monthly USD -> 429 AI_COST_LIMIT
//   - global daily tokens + monthly USD -> 429 AI_COST_LIMIT
//   - window rollover self-heals (day/month)
//   - best-effort degrade-open on store failure
//   - no PII in the audit (email only as emailHash; userId allowed)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeCeiling,
  DAY_WINDOW_MS,
  MONTH_WINDOW_MS,
} from './cost-ceiling'
import { windowIndex } from './rate-limit'

const makeStore = () => {
  const data = new Map()
  return {
    data,
    async get(key, { type } = {}) {
      const v = data.get(String(key))
      return v === undefined ? null : (type === 'json' ? JSON.parse(JSON.stringify(v)) : v)
    },
    async setJSON(key, value) { data.set(String(key), JSON.parse(JSON.stringify(value))) },
  }
}

let store
let auditSpy

beforeEach(() => {
  store = makeStore()
  auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('per-request ceilings', () => {
  it('413s AI_TOKENS_EXCEEDED when tokens exceed the per-request ceiling', async () => {
    const r = await consumeCeiling(store, 'books:ai', 'u1', { tokens: 999_999, usd: 0.001 })
    expect(r).toMatchObject({ allowed: false, status: 413, code: 'AI_TOKENS_EXCEEDED' })
  })

  it('429s AI_COST_LIMIT when usd exceeds the per-request ceiling', async () => {
    const r = await consumeCeiling(store, 'books:ai', 'u1', { tokens: 10, usd: 10 })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
    expect(r.retryAfter).toBeGreaterThan(0)
  })
})

describe('per-identity daily/monthly ceilings', () => {
  it('allows requests under every ceiling and advances the counters', async () => {
    const r = await consumeCeiling(store, 'books:ai', 'u1', { tokens: 1000, usd: 0.01 })
    expect(r.allowed).toBe(true)
    const dayKey = 'ccl:books:ai:day:u1'
    expect(store.data.get(dayKey)).toMatchObject({ count: 1, tokens: 1000, usd: 0.01 })
  })

  it('429s AI_COST_LIMIT when the daily request count ceiling is reached', async () => {
    const limits = { dailyUserRequests: 2 }
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits })).allowed).toBe(true)
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits })).allowed).toBe(true)
    const r = await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
  })

  it('429s AI_COST_LIMIT when the daily user token ceiling would be exceeded', async () => {
    const limits = { dailyUserTokens: 1000 }
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 600, usd: 0, limits })).allowed).toBe(true)
    const r = await consumeCeiling(store, 's', 'u1', { tokens: 600, usd: 0, limits })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
  })

  it('429s AI_COST_LIMIT when the monthly user USD ceiling would be exceeded', async () => {
    // A high perRequestUsd keeps the per-request ceiling out of the way so only
    // the monthly USD ceiling is exercised (usd:0.6 would otherwise trip the
    // default $0.05 per-request ceiling first).
    const limits = { monthlyUserUsd: 1, perRequestUsd: 100 }
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0.6, limits })).allowed).toBe(true)
    const r = await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0.6, limits })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
  })

  it('per-identity counters are isolated between identities', async () => {
    const limits = { dailyUserRequests: 1 }
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits })).allowed).toBe(true)
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits })).allowed).toBe(false)
    // A different identity has its own fresh budget.
    expect((await consumeCeiling(store, 's', 'u2', { tokens: 1, usd: 0, limits })).allowed).toBe(true)
  })
})

describe('global ceilings', () => {
  it('429s AI_COST_LIMIT when the global daily token ceiling would be exceeded', async () => {
    const limits = { globalDailyTokens: 1000 }
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 600, usd: 0, limits })).allowed).toBe(true)
    const r = await consumeCeiling(store, 's', 'u2', { tokens: 600, usd: 0, limits })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
  })

  it('429s AI_COST_LIMIT when the global monthly USD ceiling would be exceeded', async () => {
    const limits = { globalMonthlyUsd: 1, perRequestUsd: 100 }
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0.6, limits })).allowed).toBe(true)
    const r = await consumeCeiling(store, 's', 'u2', { tokens: 1, usd: 0.6, limits })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
  })

  it('global caps apply even when no identity is provided', async () => {
    const limits = { globalDailyTokens: 100, dailyUserTokens: 10_000 }
    expect((await consumeCeiling(store, 's', null, { tokens: 60, usd: 0, limits })).allowed).toBe(true)
    const r = await consumeCeiling(store, 's', null, { tokens: 60, usd: 0, limits })
    expect(r).toMatchObject({ allowed: false, status: 429, code: 'AI_COST_LIMIT' })
  })
})

describe('window rollover', () => {
  it('day counters roll over at the next day boundary (self-heal)', async () => {
    const limits = { dailyUserRequests: 1 }
    const t0 = 1_000_000_000_000
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits, now: t0 })).allowed).toBe(true)
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits, now: t0 })).allowed).toBe(false)
    // Advance past the day boundary — the counter resets.
    const t1 = (windowIndex(t0, DAY_WINDOW_MS) + 1) * DAY_WINDOW_MS
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0, limits, now: t1 })).allowed).toBe(true)
  })

  it('month counters roll over at the next month boundary', async () => {
    const limits = { monthlyUserUsd: 1, perRequestUsd: 100 }
    const t0 = 1_000_000_000_000
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0.6, limits, now: t0 })).allowed).toBe(true)
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0.6, limits, now: t0 })).allowed).toBe(false)
    const t1 = (windowIndex(t0, MONTH_WINDOW_MS) + 1) * MONTH_WINDOW_MS
    expect((await consumeCeiling(store, 's', 'u1', { tokens: 1, usd: 0.6, limits, now: t1 })).allowed).toBe(true)
  })
})

describe('degrade-open + audit safety', () => {
  it('degrades to allowed (no throw) when the store read/write fails', async () => {
    const broken = {
      get: async () => { throw new Error('down') },
      setJSON: async () => { throw new Error('down') },
    }
    await expect(consumeCeiling(broken, 's', 'u1', { tokens: 10, usd: 0.01 })).resolves.toMatchObject({ allowed: true })
  })

  it('audits every hard stop with NO PII — email only as emailHash, never prompted', async () => {
    await consumeCeiling(store, 's', 'u1', { tokens: 999_999, usd: 0.001, userId: 'u1', emailHash: 'abc123' })
    const line = String(auditSpy.mock.calls[0][0])
    expect(line).toContain('ai.cost_limit')
    expect(line).toContain('u1') // userId is allowed
    expect(line).toContain('abc123') // emailHash is allowed
    expect(line).not.toContain('ada@example.com') // never the raw email
    expect(line).not.toContain('prompt') // never prompts
  })
})
