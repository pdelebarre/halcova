// asset-sign.js — stateless HMAC signed-URL helper for private asset access
// (SEC-7.3, #340). Mirrors magic-link.js in shape (base64url payload `."
// `base64url(HMAC)`), but the scope is a SINGLE read-only asset object, so
// there is no single-use consumption step:
//
//   signed = base64url(payload) "." base64url(HMAC-SHA256(ASSET_SIGN_SECRET, payload))
//   payload = { aid: assetId, tid: tenantId, a: 'read', x: expiresAtMs }
//
// Security properties (mirroring magic-link.js):
//   - HMAC-SHA256 with a server-only secret from ASSET_SIGN_SECRET (Netlify
//     env). FAILS CLOSED (CWE-287/346, #184): when the env is unset,
//     assetSignSecret() returns '' and isAssetSignConfigured() is false, so
//     issuance and verification refuse — never a default-open empty-key HMAC.
//   - Bounded expiry: default ASSET_SIGN_TTL = 10 minutes, hard-capped at 15
//     minutes server-side (env-tunable below the cap).
//   - Verified with a constant-time compare (timingSafeEqual over the raw
//     32-byte digest) + canonical-base64url rejection (CWE-347).
//   - Scope binding: verification binds to { assetId, tenantId, action,
//     expiresAt } — tampering with any field breaks the HMAC.
//   - Single-object, read-only semantics: action is always 'read' and a token
//     addresses exactly one asset id in one tenant.

import { createHmac, timingSafeEqual } from 'node:crypto'

// ASSET_SIGN_SECRET must come from the Netlify env. Fail-closed (CWE-287/346):
// when unset the result is '' — never a dev fallback — so no URL can ever be
// signed or verified in that state.
export function assetSignSecret() {
  return process.env.ASSET_SIGN_SECRET || ''
}

// True when a signing/verification secret is configured. Mirrors
// isMagicLinkConfigured() — callers (asset.js) must fail closed when false.
export function isAssetSignConfigured() {
  return !!assetSignSecret()
}

// Bounded TTL. Default 10 min; hard-capped at 15 min no matter what the env
// says. A tighter env value (ASSET_SIGN_TTL_MINUTES) is honored within the cap.
export const ASSET_SIGN_TTL_MS = 10 * 60 * 1000
export const ASSET_SIGN_HARD_CAP_MS = 15 * 60 * 1000

export function assetSignTtlMs() {
  const minutes = Number(process.env.ASSET_SIGN_TTL_MINUTES)
  const ms = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes * 60_000) : ASSET_SIGN_TTL_MS
  return Math.min(ms, ASSET_SIGN_HARD_CAP_MS)
}

// Accepted content types for a signed asset. The upload endpoint (deferred)
// MUST validate against this allowlist before anything is stored; today it
// doubles as the documented content policy for signed reads.
export const ACCEPTED_ASSET_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

// Single-binary size ceiling for an asset (5 MiB default, env-tunable). The
// deferred upload endpoint enforces this server-side; it is exported so the
// contract is a single source of truth.
export const RUNOUT_ASSET_MAX_BYTES = Number(process.env.RUNOUT_ASSET_MAX_BYTES) || 5 * 1024 * 1024

export const READ_ACTION = 'read'

const b64url = (value) => Buffer.from(value).toString('base64url')

// Pure: build a signed value from explicit inputs (unit-testable with a fixed
// secret). `expiresAt` is an epoch-ms bound. The payload is:
//   { aid, tid, a: 'read', x }
export function signAssetToken({ assetId, tenantId, expiresAt, secret }) {
  const payload = b64url(JSON.stringify({
    aid: String(assetId || ''),
    tid: String(tenantId || ''),
    a: READ_ACTION,
    x: Number(expiresAt),
  }))
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${payload}.${b64url(sig)}`
}

// Pure: verify a signed value's signature + expiry + scope binding.
// Returns { ok: true, assetId, tenantId, expiresAt } or { ok: false, code }
// where code is TOKEN_INVALID | TOKEN_EXPIRED.
export function verifyAssetToken(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== 'string') return { ok: false, code: 'TOKEN_INVALID' }
  // Fail closed on an empty secret (CWE-287/346): a token verified with no
  // secret is NEVER valid — defense in depth behind the isAssetSignConfigured
  // gate in asset.js.
  if (!secret) return { ok: false, code: 'TOKEN_INVALID' }
  const sep = token.indexOf('.')
  if (sep <= 0) return { ok: false, code: 'TOKEN_INVALID' }
  const payload = token.slice(0, sep)
  const sig = token.slice(sep + 1)

  const expected = createHmac('sha256', secret).update(payload).digest()
  let provided
  try {
    provided = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, code: 'TOKEN_INVALID' }
  }
  // CWE-347: reject non-canonical base64url encodings (see magic-link.js for
  // the padding-bit subtlety). Re-encode and require exact string equality.
  if (Buffer.from(provided).toString('base64url') !== sig) {
    return { ok: false, code: 'TOKEN_INVALID' }
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, code: 'TOKEN_INVALID' }
  }

  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, code: 'TOKEN_INVALID' }
  }
  if (!data || typeof data.aid !== 'string' || !data.aid || typeof data.tid !== 'string' || !data.tid) {
    return { ok: false, code: 'TOKEN_INVALID' }
  }
  if (data.a !== READ_ACTION) return { ok: false, code: 'TOKEN_INVALID' }
  if (!Number.isFinite(data.x)) return { ok: false, code: 'TOKEN_INVALID' }
  // Stricter expiry (fails closed at/after the bound): `now >= expiresAt` is
  // expired. This is the conservative reading of "at/after expiresAt fails
  // verification", so a URL is never usable the instant its TTL elapses.
  if (data.x <= now) return { ok: false, code: 'TOKEN_EXPIRED' }
  return { ok: true, assetId: data.aid, tenantId: data.tid, expiresAt: data.x }
}

// Mint a signed URL value for a single asset read. Returns the signed value
// (the part after `?s=`), the expiresAt bound, and a struct the caller can
// expose as { url, expiresAt, mimeType }.
export function issueAssetToken({ assetId, tenantId, secret, now = Date.now() }) {
  const expiresAt = now + assetSignTtlMs()
  const signed = signAssetToken({ assetId, tenantId, expiresAt, secret })
  return { signed, expiresAt }
}
