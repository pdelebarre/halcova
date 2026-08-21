// export-sign.js — stateless HMAC signed-URL helper for GDPR data-portability
// downloads (SEC-7.2.x, #380). Mirrors asset-sign.js and magic-link.js in shape
// (base64url payload `.` base64url(HMAC)), but the scope is a single export
// data payload bound to a specific user id:
//
//   signed = base64url(payload) "." base64url(HMAC-SHA256(EXPORT_SIGN_SECRET, payload))
//   payload = { uid: userId, a: 'export', x: expiresAtMs }
//
// Security properties (mirroring asset-sign.js and magic-link.js):
//   - HMAC-SHA256 with a server-only secret from EXPORT_SIGN_SECRET (Netlify
//     env). FAILS CLOSED (CWE-287/346): when the env is unset,
//     exportSignSecret() returns '' and isExportSignConfigured() is false, so
//     issuance and verification refuse — never a default-open empty-key HMAC.
//   - Bounded expiry: default EXPORT_SIGN_TTL = 5 minutes, hard-capped at 10
//     minutes server-side (env-tunable below the cap). Short TTL because the
//     export data is assembled at request time and stored only long enough for
//     the download.
//   - Verified with a constant-time compare (timingSafeEqual over the raw
//     32-byte digest) + canonical-base64url rejection (CWE-347).
//   - Scope binding: verification binds to { userId, action, expiresAt } —
//     tampering with any field breaks the HMAC.
//   - Single-user, single-download semantics: one token addresses exactly one
//     user's export data.

import { createHmac, timingSafeEqual } from 'node:crypto'

// EXPORT_SIGN_SECRET must come from the Netlify env. Fail-closed (CWE-287/346):
// when unset the result is '' — never a dev fallback — so no URL can ever be
// signed or verified in that state.
export function exportSignSecret() {
  return process.env.EXPORT_SIGN_SECRET || ''
}

// True when a signing/verification secret is configured. Mirrors
// isAssetSignConfigured() — callers (export.js) must fail closed when false.
export function isExportSignConfigured() {
  return !!exportSignSecret()
}

// Bounded TTL. Default 5 min; hard-capped at 10 min no matter what the env
// says. A tighter env value (EXPORT_SIGN_TTL_MINUTES) is honored within the cap.
export const EXPORT_SIGN_TTL_MS = 5 * 60 * 1000
export const EXPORT_SIGN_HARD_CAP_MS = 10 * 60 * 1000

export function exportSignTtlMs() {
  const minutes = Number(process.env.EXPORT_SIGN_TTL_MINUTES)
  const ms = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes * 60_000) : EXPORT_SIGN_TTL_MS
  return Math.min(ms, EXPORT_SIGN_HARD_CAP_MS)
}

export const EXPORT_ACTION = 'export'

const b64url = (value) => Buffer.from(value).toString('base64url')

// Pure: build a signed value from explicit inputs (unit-testable with a fixed
// secret). `expiresAt` is an epoch-ms bound. The payload is:
//   { uid, a: 'export', x }
export function signExportToken({ userId, expiresAt, secret }) {
  const payload = b64url(JSON.stringify({
    uid: String(userId || ''),
    a: EXPORT_ACTION,
    x: Number(expiresAt),
  }))
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${payload}.${b64url(sig)}`
}

// Pure: verify a signed value's signature + expiry + scope binding.
// Returns { ok: true, userId, expiresAt } or { ok: false, code }
// where code is TOKEN_INVALID | TOKEN_EXPIRED.
export function verifyExportToken(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== 'string') return { ok: false, code: 'TOKEN_INVALID' }
  // Fail closed on an empty secret (CWE-287/346): a token verified with no
  // secret is NEVER valid.
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
  if (!data || typeof data.uid !== 'string' || !data.uid) {
    return { ok: false, code: 'TOKEN_INVALID' }
  }
  if (data.a !== EXPORT_ACTION) return { ok: false, code: 'TOKEN_INVALID' }
  if (!Number.isFinite(data.x)) return { ok: false, code: 'TOKEN_INVALID' }
  // Stricter expiry (fails closed at/after the bound): `now >= expiresAt` is
  // expired. This is the conservative reading of "at/after expiresAt fails
  // verification", so a URL is never usable the instant its TTL elapses.
  if (data.x <= now) return { ok: false, code: 'TOKEN_EXPIRED' }
  return { ok: true, userId: data.uid, expiresAt: data.x }
}

// Mint a signed URL value for a single export download. Returns the signed value
// (the part after `?s=`), the expiresAt bound, and a struct the caller can
// expose as { url, expiresAt }.
export function issueExportToken({ userId, secret, now = Date.now() }) {
  const expiresAt = now + exportSignTtlMs()
  const signed = signExportToken({ userId, expiresAt, secret })
  return { signed, expiresAt }
}