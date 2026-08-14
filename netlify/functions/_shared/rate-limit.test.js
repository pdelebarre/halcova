// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  RATE_LIMIT_WINDOW_MS,
  rateLimitKey,
  windowIndex,
  retryAfterSeconds,
  nextCounter,
  consume,
  createRateLimiter,
  clientIp,
  rateLimitIdentity,
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

  it('falls back to the first x-forwarded-for entry', () => {
    const req = { headers: headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }) }
    expect(clientIp(req)).toBe('198.51.100.9')
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
