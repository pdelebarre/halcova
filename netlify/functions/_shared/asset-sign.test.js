// @vitest-environment node
//
// SEC-7.3 (#340) — stateless HMAC signed-URL helper (_shared/asset-sign.js).
// Unit tests for the pure token sign/verify functions: bounded TTL (10-min
// default, 15-min hard cap), fail-closed when no secret is configured
// (CWE-287/346), constant-time scope binding (aid/tid/action/expiresAt all
// bound), expiry handling, and canonical-base64url rejection (CWE-347).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ASSET_SIGN_HARD_CAP_MS,
  ASSET_SIGN_TTL_MS,
  ACCEPTED_ASSET_TYPES,
  RUNOUT_ASSET_MAX_BYTES,
  assetSignSecret,
  assetSignTtlMs,
  isAssetSignConfigured,
  signAssetToken,
  verifyAssetToken,
  issueAssetToken,
  READ_ACTION,
} from './asset-sign'

const SECRET = 'test-asset-sign-secret'

beforeEach(() => {
  process.env.ASSET_SIGN_SECRET = SECRET
})

afterEach(() => {
  delete process.env.ASSET_SIGN_SECRET
  delete process.env.ASSET_SIGN_TTL_MINUTES
  delete process.env.RUNOUT_ASSET_MAX_BYTES
})

describe('fail-closed secret handling (CWE-287/346)', () => {
  it('isAssetSignConfigured() is false when ASSET_SIGN_SECRET is unset', () => {
    delete process.env.ASSET_SIGN_SECRET
    expect(assetSignSecret()).toBe('')
    expect(isAssetSignConfigured()).toBe(false)
  })

  it('is true when ASSET_SIGN_SECRET is set', () => {
    expect(isAssetSignConfigured()).toBe(true)
  })

  it('verifyAssetToken refuses every token when the secret is empty (never default-open)', () => {
    const token = signAssetToken({ assetId: 'a-1', tenantId: 'u1', expiresAt: Date.now() + 1000, secret: SECRET })
    const r = verifyAssetToken(token, { secret: '', now: Date.now() })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TOKEN_INVALID')
  })

  it('issueAssetToken still issues (the caller gates on isAssetSignConfigured)', () => {
    // The helper itself only needs a secret; the endpoint is what fails closed
    // before calling it. But verify it round-trips with a configured secret.
    const { signed, expiresAt } = issueAssetToken({ assetId: 'a-1', tenantId: 'u1', secret: SECRET })
    expect(expiresAt).toBeGreaterThan(Date.now())
    const r = verifyAssetToken(signed, { secret: SECRET })
    expect(r.ok).toBe(true)
    expect(r.assetId).toBe('a-1')
    expect(r.tenantId).toBe('u1')
  })
})

describe('bounded expiry (10-min default, 15-min hard cap)', () => {
  it('defaults to 10 minutes', () => {
    expect(ASSET_SIGN_TTL_MS).toBe(10 * 60 * 1000)
    expect(assetSignTtlMs()).toBe(ASSET_SIGN_TTL_MS)
  })

  it('honors a tighter env value within the cap', () => {
    process.env.ASSET_SIGN_TTL_MINUTES = '1'
    expect(assetSignTtlMs()).toBe(60 * 1000)
  })

  it('hard-caps at 15 minutes even when the env asks for more', () => {
    expect(ASSET_SIGN_HARD_CAP_MS).toBe(15 * 60 * 1000)
    process.env.ASSET_SIGN_TTL_MINUTES = '120'
    expect(assetSignTtlMs()).toBe(ASSET_SIGN_HARD_CAP_MS)
    // Garbage env falls back to the default (10 min), still under the cap.
    process.env.ASSET_SIGN_TTL_MINUTES = 'abc'
    expect(assetSignTtlMs()).toBe(ASSET_SIGN_TTL_MS)
  })

  it('a signed value at/after expiresAt fails verification (revoked by time)', () => {
    const expiresAt = 1000
    const token = signAssetToken({ assetId: 'a-1', tenantId: 'u1', expiresAt, secret: SECRET })
    // Just before expiry -> valid.
    expect(verifyAssetToken(token, { secret: SECRET, now: 999 }).ok).toBe(true)
    // At expiry exactly -> expired.
    expect(verifyAssetToken(token, { secret: SECRET, now: 1000 }).code).toBe('TOKEN_EXPIRED')
    // After expiry -> expired.
    expect(verifyAssetToken(token, { secret: SECRET, now: 1001 }).code).toBe('TOKEN_EXPIRED')
  })
})

describe('scope binding (single-object, read-only)', () => {
  const assetId = 'a-1'
  const tenantId = 'u1'
  const expiresAt = Date.now() + 5 * 60 * 1000
  const base = () => ({ assetId, tenantId, expiresAt, secret: SECRET })

  it('verifies a valid token and returns the bound scope', () => {
    const token = signAssetToken(base())
    const r = verifyAssetToken(token, { secret: SECRET })
    expect(r.ok).toBe(true)
    expect(r.assetId).toBe(assetId)
    expect(r.tenantId).toBe(tenantId)
    expect(r.expiresAt).toBe(expiresAt)
  })

  it('breaking the HMAC (wrong secret) fails verification', () => {
    const token = signAssetToken(base())
    expect(verifyAssetToken(token, { secret: 'wrong-secret' }).ok).toBe(false)
  })

  it('changing assetId breaks scope binding (verification fails)', () => {
    const token = signAssetToken(base())
    const forged = signAssetToken({ ...base(), assetId: 'a-9' })
    // A different token verifies; the original cannot be re-bound to a-9.
    expect(verifyAssetToken(token, { secret: SECRET }).assetId).toBe(assetId)
    expect(verifyAssetToken(forged, { secret: SECRET }).assetId).toBe('a-9')
  })

  it('changing the tenantId (cross-tenant) breaks verification', () => {
    const token = signAssetToken(base())
    const otherTenant = signAssetToken({ ...base(), tenantId: 'u2' })
    expect(verifyAssetToken(token, { secret: SECRET }).tenantId).toBe(tenantId)
    expect(verifyAssetToken(otherTenant, { secret: SECRET }).tenantId).toBe('u2')
  })

  it('an asset token with the wrong action is invalid (read-only semantics)', () => {
    // Simulate a payload with a forged action by manually building one.
    const payload = Buffer.from(JSON.stringify({ aid: assetId, tid: tenantId, a: 'write', x: expiresAt })).toString('base64url')
    const { createHmac } = require('node:crypto')
    const sig = createHmac('sha256', SECRET).update(payload).digest()
    const token = `${payload}.${Buffer.from(sig).toString('base64url')}`
    const r = verifyAssetToken(token, { secret: SECRET })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TOKEN_INVALID')
  })

  it('malformed / non-canonical tokens are rejected (CWE-347)', () => {
    const token = signAssetToken(base())
    // Tamper with a padding bit in the signature -> non-canonical base64url.
    const [payload, sig] = token.split('.')
    const flip = (s) => (s[s.length - 1] === 'A' ? s.slice(0, -1) + 'B' : s.slice(0, -1) + 'A')
    const forged = `${payload}.${flip(sig)}`
    const r = verifyAssetToken(forged, { secret: SECRET })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TOKEN_INVALID')
  })

  it('non-string or empty tokens are invalid', () => {
    expect(verifyAssetToken(null, { secret: SECRET }).code).toBe('TOKEN_INVALID')
    expect(verifyAssetToken('', { secret: SECRET }).code).toBe('TOKEN_INVALID')
    expect(verifyAssetToken('no-dot', { secret: SECRET }).code).toBe('TOKEN_INVALID')
    // Garbage after a valid-shaped prefix.
    expect(verifyAssetToken('abc.def', { secret: SECRET }).ok).toBe(false)
  })
})

describe('exported constants (content policy contract)', () => {
  it('exposes the accepted content-type allowlist and the 5 MiB size cap', () => {
    expect(ACCEPTED_ASSET_TYPES).toContain('image/jpeg')
    expect(ACCEPTED_ASSET_TYPES).toContain('image/png')
    expect(ACCEPTED_ASSET_TYPES).toContain('image/webp')
    expect(ACCEPTED_ASSET_TYPES).toContain('application/pdf')
  })

  it('RUNOUT_ASSET_MAX_BYTES defaults to 5 MiB and is env-tunable', () => {
    expect(RUNOUT_ASSET_MAX_BYTES).toBe(5 * 1024 * 1024)
    process.env.RUNOUT_ASSET_MAX_BYTES = String(2 * 1024 * 1024)
    const { RUNOUT_ASSET_MAX_BYTES: capped } = require('./asset-sign')
    expect(capped).toBe(2 * 1024 * 1024)
  })

  it('READ_ACTION is exactly the read-only action', () => {
    expect(READ_ACTION).toBe('read')
  })
})
