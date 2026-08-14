// @vitest-environment node
//
// Tests for the one-time magic-link token module (netlify/functions/_shared/
// magic-link.js, ADR-0003 S1). Proves:
//   - issue → verify round-trips and returns the normalized email,
//   - tampering (payload / signature) and a wrong secret are LINK_INVALID,
//   - an expired token is LINK_EXPIRED (TTL ≤ 30 min enforced),
//   - the single-use marker makes a second consume return false (replay-safe),
//   - the TTL is hard-capped at 30 minutes regardless of env.
//
// @netlify/blobs is mocked in-memory (same pattern as lookup-cache.test.js) so
// consumeMagicLink's used-marker store is exercised without a real backend.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TTL_MS,
  consumeMagicLink,
  issueMagicLink,
  magicLinkSecret,
  magicLinkTtlMs,
  signMagicLink,
  verifyMagicLinkToken,
} from './magic-link'

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

const SECRET = 'test-secret-123'

describe('signMagicLink + verifyMagicLinkToken', () => {
  it('round-trips and returns the trimmed, lowercased email', () => {
    const now = Date.now()
    const token = signMagicLink({ email: '  Ada@Example.COM ', expiresAt: now + DEFAULT_TTL_MS, jti: 'j1', secret: SECRET })
    const result = verifyMagicLinkToken(token, { secret: SECRET, now })
    expect(result.ok).toBe(true)
    expect(result.email).toBe('ada@example.com')
    expect(result.jti).toBe('j1')
  })

  it('rejects a token signed with a different secret', () => {
    const token = signMagicLink({ email: 'ada@example.com', expiresAt: Date.now() + DEFAULT_TTL_MS, jti: 'j1', secret: SECRET })
    const result = verifyMagicLinkToken(token, { secret: 'wrong-secret' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LINK_INVALID')
  })

  it('rejects a token whose signature was altered (constant-time compare path)', () => {
    const token = signMagicLink({ email: 'ada@example.com', expiresAt: Date.now() + DEFAULT_TTL_MS, jti: 'j1', secret: SECRET })
    const sep = token.indexOf('.')
    const payload = token.slice(0, sep)
    const sig = token.slice(sep + 1)
    const flipped = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`
    const result = verifyMagicLinkToken(`${payload}.${flipped}`, { secret: SECRET })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LINK_INVALID')
  })

  it('rejects malformed tokens', () => {
    expect(verifyMagicLinkToken('not-a-token', { secret: SECRET }).code).toBe('LINK_INVALID')
    expect(verifyMagicLinkToken('', { secret: SECRET }).code).toBe('LINK_INVALID')
    expect(verifyMagicLinkToken('abc.def', { secret: SECRET }).code).toBe('LINK_INVALID')
    expect(verifyMagicLinkToken(null, { secret: SECRET }).code).toBe('LINK_INVALID')
  })

  it('rejects an expired token with LINK_EXPIRED (boundary is exclusive)', () => {
    const issuedAt = Date.now()
    const token = signMagicLink({ email: 'ada@example.com', expiresAt: issuedAt + DEFAULT_TTL_MS, jti: 'j1', secret: SECRET })
    // Exactly at expiry it is still valid…
    expect(verifyMagicLinkToken(token, { secret: SECRET, now: issuedAt + DEFAULT_TTL_MS }).ok).toBe(true)
    // …one millisecond later it is expired.
    const result = verifyMagicLinkToken(token, { secret: SECRET, now: issuedAt + DEFAULT_TTL_MS + 1 })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LINK_EXPIRED')
  })
})

describe('consumeMagicLink — single-use (replay-safe)', () => {
  beforeEach(() => {
    for (const key of Object.keys(stores)) delete stores[key]
  })

  it('consumes a token exactly once', async () => {
    expect(await consumeMagicLink('tok-123')).toBe(true)
    expect(await consumeMagicLink('tok-123')).toBe(false)
  })

  it('keys the marker on the token digest, so distinct tokens are independent', async () => {
    expect(await consumeMagicLink('tok-a')).toBe(true)
    expect(await consumeMagicLink('tok-b')).toBe(true)
  })
})

describe('issueMagicLink', () => {
  it('mints a token that verifies for the email and expires within the TTL', () => {
    const { token, expiresAt } = issueMagicLink('ada@example.com')
    const result = verifyMagicLinkToken(token, { secret: magicLinkSecret() })
    expect(result.ok).toBe(true)
    expect(result.email).toBe('ada@example.com')
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(DEFAULT_TTL_MS)
  })
})

describe('magicLinkTtlMs', () => {
  const original = process.env.RUNOUT_MAGIC_LINK_TTL_MINUTES
  afterEach(() => {
    if (original === undefined) delete process.env.RUNOUT_MAGIC_LINK_TTL_MINUTES
    else process.env.RUNOUT_MAGIC_LINK_TTL_MINUTES = original
  })

  it('hard-caps the TTL at 30 minutes no matter the env', () => {
    process.env.RUNOUT_MAGIC_LINK_TTL_MINUTES = '120'
    expect(magicLinkTtlMs()).toBe(DEFAULT_TTL_MS)
  })

  it('honors a shorter configured TTL', () => {
    process.env.RUNOUT_MAGIC_LINK_TTL_MINUTES = '10'
    expect(magicLinkTtlMs()).toBe(10 * 60_000)
  })
})
