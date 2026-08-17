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
  isMagicLinkConfigured,
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

  it('rejects a NON-CANONICAL (malleable) signature encoding that decodes to the same bytes (CWE-347)', () => {
    const now = Date.now()
    const token = signMagicLink({ email: 'ada@example.com', expiresAt: now + DEFAULT_TTL_MS, jti: 'j1', secret: SECRET })
    const sep = token.indexOf('.')
    const payload = token.slice(0, sep)
    const sig = token.slice(sep + 1)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

    // A 32-byte digest base64url-encodes to 43 chars whose LAST char has only
    // 4 significant bits + 2 padding bits. Canonical encodings clear those low
    // padding bits, so an attacker can set one and the string still DECODES to
    // the exact same 32 bytes — previously passing timingSafeEqual. Flip the
    // lowest padding bit of the final sextet to build such a malleable sig.
    const last = sig[sig.length - 1]
    const lastIdx = alphabet.indexOf(last)
    const malleable = `${sig.slice(0, -1)}${alphabet[lastIdx | 1]}`
    // Sanity: the tampered string genuinely decodes to the SAME bytes, so only
    // the canonical re-encode check can catch it.
    expect(Buffer.from(malleable, 'base64url').equals(Buffer.from(sig, 'base64url'))).toBe(true)

    const result = verifyMagicLinkToken(`${payload}.${malleable}`, { secret: SECRET, now })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LINK_INVALID')
  })

  it('verifies a canonical token — the re-encode check causes no false rejections', () => {
    const now = Date.now()
    const token = signMagicLink({ email: 'ada@example.com', expiresAt: now + DEFAULT_TTL_MS, jti: 'j1', secret: SECRET })
    const result = verifyMagicLinkToken(token, { secret: SECRET, now })
    expect(result.ok).toBe(true)
    expect(result.email).toBe('ada@example.com')
    expect(result.jti).toBe('j1')
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

  it('never verifies with an empty secret — a link signed with "" is unusable (CWE-287/346)', () => {
    const now = Date.now()
    // The exact CWE-287 attack shape: a well-formed, unexpired token signed
    // with '' — what a misconfigured prod secret would be.
    const forged = signMagicLink({ email: 'victim@example.com', expiresAt: now + DEFAULT_TTL_MS, jti: 'j1', secret: '' })
    const result = verifyMagicLinkToken(forged, { secret: '', now })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LINK_INVALID')
    // Even a non-empty-signature token can never verify against ''.
    expect(verifyMagicLinkToken('Zm9v.YmFy', { secret: '', now }).code).toBe('LINK_INVALID')
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

  it('carries a HIGH-ENTROPY jti — a random UUID v4, unique per issue (SEC-1.7, #182)', () => {
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    const a = issueMagicLink('ada@example.com')
    const b = issueMagicLink('ada@example.com')
    const ja = verifyMagicLinkToken(a.token, { secret: magicLinkSecret() })
    const jb = verifyMagicLinkToken(b.token, { secret: magicLinkSecret() })
    // The HMAC is over a random 122-bit jti — two links for the SAME email are
    // unrelated, so guessing one gives an attacker nothing about another.
    expect(ja.jti).toMatch(UUID_V4)
    expect(jb.jti).toMatch(UUID_V4)
    expect(ja.jti).not.toBe(jb.jti)
    expect(a.token).not.toBe(b.token)
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

// CWE-287 (#184) — magicLinkSecret() must FAIL CLOSED (empty, never a dev
// fallback of its own) when no secret is configured, and isMagicLinkConfigured()
// must report false so callers refuse before signing/verifying. ADMIN_KEY is a
// module-level constant, so each case re-imports the module with the desired
// env (same pattern as auth.test.js).
describe('magicLinkSecret — fails closed when unconfigured (#184)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    delete process.env.RUNOUT_MAGIC_LINK_SECRET
    delete process.env.RUNOUT_ADMIN_KEY
    delete process.env.NODE_ENV
    delete process.env.RUNOUT_DEV_MODE
    delete process.env.NETLIFY
    delete process.env.NETLIFY_LOCAL
    delete process.env.NETLIFY_DEV
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  async function loadMagicLink() {
    return import('./magic-link')
  }

  it('returns "" (never a dev fallback) and reports not configured in production with no secret', async () => {
    process.env.NODE_ENV = 'production'
    const mod = await loadMagicLink()
    expect(mod.magicLinkSecret()).toBe('')
    expect(mod.isMagicLinkConfigured()).toBe(false)
  })

  it('uses RUNOUT_MAGIC_LINK_SECRET when set (configured)', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_MAGIC_LINK_SECRET = 'prod-magic-secret'
    const mod = await loadMagicLink()
    expect(mod.magicLinkSecret()).toBe('prod-magic-secret')
    expect(mod.isMagicLinkConfigured()).toBe(true)
  })

  it('falls back to the admin key when set (still configured)', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_ADMIN_KEY = 'prod-admin-key'
    const mod = await loadMagicLink()
    expect(mod.magicLinkSecret()).toBe('prod-admin-key')
    expect(mod.isMagicLinkConfigured()).toBe(true)
  })
})
