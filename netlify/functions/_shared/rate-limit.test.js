// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  RATE_LIMIT_WINDOW_MS,
  rateLimitKey,
  windowIndex,
  retryAfterSeconds,
  nextCounter,
  consume,
  consumeDistinct,
  createRateLimiter,
  clientIp,
  rateLimitIdentity,
  rateLimitGuard,
  RL_EXHAUST_ANOMALY_THRESHOLD,
} from './rate-limit'

describe('rateLimitKey', () => {
  it('keys by scope and identity with a stable prefix', () => {
    expect(rateLimitKey('collection:records', 'u1')).toBe('rl:collection:records:u1')
  })
})

describe('windowIndex', () => {
  it('maps a timestamp to its fixed window', () => {
    expect(windowIndex(0, RATE_LIMIT_WINDOW_MS)).toBe(0)
    expect(windowIndex(RATE_LIMIT_WINDOW_MS - 1, RATE_LIMIT_WINDOW_MS)).toBe(0)
    expect(windowIndex(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_WINDOW_MS)).toBe(1)
  })
})

describe('retryAfterSeconds', () => {
  it('is at least 1 second and counts down to the next window boundary', () => {
    expect(retryAfterSeconds(0, 60_000)).toBe(60)
    expect(retryAfterSeconds(30_000, 60_000)).toBe(30)
    expect(retryAfterSeconds(59_999, 60_000)).toBe(1)
  })
})

describe('nextCounter', () => {
  it('increments within the same window', () => {
    expect(nextCounter({ w: 0, count: 4 }, 10_000)).toEqual({ w: 0, count: 5 })
  })

  it('resets when the window rolls over, so limits self-heal each window', () => {
    expect(nextCounter({ w: 0, count: 4 }, RATE_LIMIT_WINDOW_MS + 1_000)).toEqual({ w: 1, count: 1 })
  })

  it('starts at one when there is no prior entry', () => {
    expect(nextCounter(null, 10_000)).toEqual({ w: 0, count: 1 })
  })
})

describe('consume', () => {
  const memStore = (data = {}) => ({
    data,
    async get(k) { return this.data[k] },
    async setJSON(k, v) { this.data[k] = v },
  })

  it('allows requests up to the limit and rejects beyond it', async () => {
    const store = memStore()
    const key = rateLimitKey('collection:records', 'u1')
    expect(await consume(store, key, 2, 10_000)).toEqual({ limited: false })
    expect(await consume(store, key, 2, 10_000)).toEqual({ limited: false })
    const third = await consume(store, key, 2, 10_000)
    expect(third.limited).toBe(true)
    expect(third.retryAfter).toBeGreaterThanOrEqual(1)
  })

  it('never throws when the store read or write fails — degrades to allowing the request', async () => {
    const broken = {
      async get() { throw new Error('boom') },
      async setJSON() { throw new Error('boom') },
    }
    await expect(consume(broken, 'k', 5)).resolves.toEqual({ limited: false })
  })
})

describe('consumeDistinct', () => {
  const memStore = (data = {}) => ({
    data,
    async get(k) { return this.data[k] },
    async setJSON(k, v) { this.data[k] = v },
  })

  it('counts DISTINCT items and never advances on a repeat within the window', async () => {
    const store = memStore()
    const key = rateLimitKey('reviews-distinct:records', 'u1')
    expect(await consumeDistinct(store, key, 'a', 2, 10_000)).toEqual({ limited: false })
    expect(await consumeDistinct(store, key, 'a', 2, 10_000)).toEqual({ limited: false }) // repeat — no advance
    expect(await consumeDistinct(store, key, 'b', 2, 10_000)).toEqual({ limited: false })
    const third = await consumeDistinct(store, key, 'c', 2, 10_000)
    expect(third.limited).toBe(true)
    expect(third.retryAfter).toBeGreaterThanOrEqual(1)
  })

  it('resets when the window rolls over, so the distinct cap self-heals each window', async () => {
    const store = memStore({ [rateLimitKey('s', 'u1')]: { w: 0, items: ['a', 'b'] } })
    const next = await consumeDistinct(store, rateLimitKey('s', 'u1'), 'c', 2, RATE_LIMIT_WINDOW_MS + 1_000)
    expect(next).toEqual({ limited: false }) // stale window resets to just ['c']
  })

  it('never throws when the store read or write fails — degrades to allowing the request', async () => {
    const broken = {
      async get() { throw new Error('boom') },
      async setJSON() { throw new Error('boom') },
    }
    await expect(consumeDistinct(broken, 'k', 'a', 5)).resolves.toEqual({ limited: false })
  })
})

describe('createRateLimiter', () => {
  it('rejects after the limit within a window, without throttling other identities', async () => {
    const store = {
      data: {},
      async get(k) { return this.data[k] },
      async setJSON(k, v) { this.data[k] = v },
    }
    const limiter = createRateLimiter({ store, scope: 'collection:records', limit: 1, windowMs: 60_000 })
    expect((await limiter('u1', 10_000)).limited).toBe(false)
    expect((await limiter('u1', 10_000)).limited).toBe(true)
    expect((await limiter('u2', 10_000)).limited).toBe(false)
  })
})

describe('clientIp', () => {
  const headers = (obj) => ({ get: (k) => obj[k] || null })

  it('prefers the Netlify-specific client-IP header', () => {
    const req = { headers: headers({ 'x-nf-client-connection-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.9' }) }
    expect(clientIp(req)).toBe('203.0.113.5')
  })

  it('keys on x-nf-client-connection-ip ONLY and never trusts a client-spoofable x-forwarded-for (SEC-7.4.x F-2)', () => {
    // With no x-nf-client-connection-ip, an x-forwarded-for must NOT be used as
    // the abuse-limit key — XFF can be spoofed by a client, so it is dropped.
    const req = { headers: headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }) }
    expect(clientIp(req)).toBe('')
  })

  it('returns an empty string when no IP header is present', () => {
    expect(clientIp({ headers: headers({}) })).toBe('')
  })
})

describe('rateLimitIdentity', () => {
  const req = { headers: { get: () => '203.0.113.5' } }

  it('uses the user id for members and the owner', () => {
    expect(rateLimitIdentity({ id: 'u1', role: 'member' }, req)).toBe('u1')
    expect(rateLimitIdentity({ id: 'owner', role: 'admin' }, req)).toBe('owner')
  })

  it('keys the shared demo identity by client IP so one demo visitor cannot throttle the whole demo', () => {
    expect(rateLimitIdentity({ id: 'demo', role: 'demo' }, req)).toBe('203.0.113.5')
  })

  it('returns an empty string when the demo has no IP to key on', () => {
    expect(rateLimitIdentity({ id: 'demo', role: 'demo' }, { headers: { get: () => null } })).toBe('')
  })
})

describe('rateLimitGuard', () => {
  const memStore = (data = {}) => ({
    data,
    async get(k, { type } = {}) {
      const v = this.data[k]
      return v === undefined ? null : (type === 'json' ? JSON.parse(JSON.stringify(v)) : v)
    },
    async setJSON(k, v) { this.data[k] = JSON.parse(JSON.stringify(v)) },
  })

  it('allows up to the limit and returns a uniform 429 RATE_LIMIT + Retry-After beyond it', async () => {
    const store = memStore()
    for (let i = 0; i < 2; i += 1) {
      expect(await rateLimitGuard({ store, scope: 'lending', identity: 'u1', limit: 2, anomalyStore: store, now: 10_000 })).toBeNull()
    }
    const limited = await rateLimitGuard({ store, scope: 'lending', identity: 'u1', limit: 2, anomalyStore: store, now: 10_000 })
    expect(limited.status).toBe(429)
    const body = await limited.json()
    expect(body.code).toBe('RATE_LIMIT')
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('skips the limit when there is no identity (degrades open)', async () => {
    const store = memStore()
    expect(await rateLimitGuard({ store, scope: 's', identity: '', limit: 1, anomalyStore: store })).toBeNull()
  })

  it('never throws when the store read/write fails — degrades to allowing', async () => {
    const broken = {
      get: async () => { throw new Error('boom') },
      setJSON: async () => { throw new Error('boom') },
    }
    await expect(rateLimitGuard({ store: broken, scope: 's', identity: 'u1', limit: 1, anomalyStore: broken })).resolves.toBeNull()
  })

  it('emits a rate_limit_exhaustion_burst anomaly once per window after N 429s (no raw identity)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const store = memStore()
      const limit = 1
      // Fire the limiter `threshold + 1` times with limit=1: the first call is
      // allowed (no 429), so the remaining `threshold` calls are all 429s — the
      // last one crosses the exhaustion-anomaly threshold exactly once.
      let limited = null
      for (let i = 0; i < RL_EXHAUST_ANOMALY_THRESHOLD + 1; i += 1) {
        limited = await rateLimitGuard({ store, scope: 'collection:records:write', identity: 'u1', limit, anomalyStore: store, burstScope: 'rlx:collection:records:write', now: 10_000 })
      }
      expect(limited.status).toBe(429)
      // The threshold of 429s produced exactly ONE anomaly audit line.
      const anomalyLines = spy.mock.calls.map(([line]) => String(line)).filter((l) => l.includes('rate_limit_exhaustion_burst'))
      expect(anomalyLines).toHaveLength(1)
      expect(anomalyLines[0]).not.toContain('u1')
      expect(anomalyLines[0]).toContain('rlx:collection:records:write')
      // Each 429 also emitted a cardinality-free rate_limit.served audit.
      const served = spy.mock.calls.map(([line]) => String(line)).filter((l) => l.includes('rate_limit.served'))
      expect(served).toHaveLength(RL_EXHAUST_ANOMALY_THRESHOLD)
    } finally {
      spy.mockRestore()
    }
  })
})
