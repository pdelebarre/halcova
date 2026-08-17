// One-time magic-link tokens for self-serve signup (ADR-0003, S1). The token
// is a signed, expiring, single-use bearer proof of email ownership:
//
//   token = base64url(payload JSON) "." base64url(HMAC-SHA256(secret, payload))
//
//   payload = { e: email (trim + lowercase), x: expiresAtEpochMs, j: jti }
//
// Security properties:
//   - HMAC-SHA256 with a server-only secret (RUNOUT_MAGIC_LINK_SECRET, falling
//     back to the admin key — already server-only and never logged).
//   - FAILS CLOSED (CWE-287/346): when neither env provides a secret — e.g. a
//     production deploy with RUNOUT_ADMIN_KEY unset, where ADMIN_KEY is ''
//     (SEC-1.5, #180) — magicLinkSecret() returns '' and isMagicLinkConfigured()
//     is false, so verifyMagicLinkToken refuses every token and the auth.js
//     handlers return 503 instead of accepting a forgeable empty-key HMAC.
//   - Verified with a constant-time compare (timingSafeEqual over the raw
//     32-byte digest).
//   - TTL ≤ 30 minutes (RUNOUT_MAGIC_LINK_TTL_MINUTES, hard-capped at 30).
//   - Single-use / replay-safe: the first successful use writes a
//     sha256(token) "used" marker to the runout-magic-links blob store; a
//     second use is rejected (LINK_USED). The read-then-write is best-effort
//     (same trade-off as the rate limiter) — a human click can't race itself.

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ADMIN_KEY } from './auth'

export const MAGIC_LINKS_STORE = 'runout-magic-links'
export const DEFAULT_TTL_MS = 30 * 60 * 1000

// Server-only HMAC secret. A dedicated env keeps the token space independent
// of the admin key; the admin key is an acceptable fallback (dev + prod) since
// it is already env-only and never logged. FAILS CLOSED (CWE-287/346, #184):
// when neither env provides a secret the result is '' — never a dev fallback
// of its own — so no token can ever be signed or verified in that state.
export function magicLinkSecret() {
  return process.env.RUNOUT_MAGIC_LINK_SECRET || ADMIN_KEY || ''
}

// True when a magic-link signing/verification secret is configured. Mirrors
// isMailConfigured() in mailer.js — callers (auth.js handlers) must fail
// closed when this is false, before signing or verifying anything.
export function isMagicLinkConfigured() {
  return !!magicLinkSecret()
}

// The link TTL in ms, hard-capped at 30 minutes no matter what the env says.
export function magicLinkTtlMs() {
  const minutes = Number(process.env.RUNOUT_MAGIC_LINK_TTL_MINUTES)
  const ms = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes * 60_000) : DEFAULT_TTL_MS
  return Math.min(ms, DEFAULT_TTL_MS)
}

const b64url = (value) => Buffer.from(value).toString('base64url')

// Pure: build a token from explicit inputs (unit-testable with a fixed secret).
export function signMagicLink({ email, expiresAt, jti, secret }) {
  const payload = b64url(JSON.stringify({ e: String(email || '').trim().toLowerCase(), x: expiresAt, j: jti }))
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${payload}.${b64url(sig)}`
}

// Pure: verify a token's signature + expiry (constant-time HMAC compare).
// Returns { ok: true, email, jti, expiresAt } or { ok: false, code } where
// `code` is LINK_INVALID | LINK_EXPIRED. LINK_USED is decided separately by
// consumeMagicLink (it needs the blob store for the single-use marker).
export function verifyMagicLinkToken(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== 'string') return { ok: false, code: 'LINK_INVALID' }
  // Fail closed on an empty secret: HMAC-SHA256 with a '' key is forgeable, so
  // a token verified with no secret is NEVER valid (CWE-287/346, #184). This
  // is defense in depth behind the auth.js isMagicLinkConfigured() gate.
  if (!secret) return { ok: false, code: 'LINK_INVALID' }
  const sep = token.indexOf('.')
  if (sep <= 0) return { ok: false, code: 'LINK_INVALID' }
  const payload = token.slice(0, sep)
  const sig = token.slice(sep + 1)

  const expected = createHmac('sha256', secret).update(payload).digest()
  let provided
  try {
    provided = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, code: 'LINK_INVALID' }
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, code: 'LINK_INVALID' }
  }

  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, code: 'LINK_INVALID' }
  }
  if (!data || typeof data.e !== 'string' || !data.e || !Number.isFinite(data.x) || !data.j) {
    return { ok: false, code: 'LINK_INVALID' }
  }
  if (data.x < now) return { ok: false, code: 'LINK_EXPIRED' }
  return { ok: true, email: data.e, jti: data.j, expiresAt: data.x }
}

// Issue a fresh token for an email (env secret + a random jti).
export function issueMagicLink(email, { now = Date.now() } = {}) {
  const expiresAt = now + magicLinkTtlMs()
  const token = signMagicLink({ email, expiresAt, jti: randomUUID(), secret: magicLinkSecret() })
  return { token, expiresAt }
}

// The single-use marker key — a sha256 of the token, so the raw token is never
// stored (the store only ever holds a digest + timestamp).
function usedKey(token) {
  return `used:${createHash('sha256').update(token).digest('hex')}`
}

// Consume a token exactly once. Returns true when THIS call consumed it (first
// use), false when it was already used. Degrades open on a store failure (like
// the rate limiter): a lost marker must never lock a real user out.
export async function consumeMagicLink(token) {
  const store = getStore(MAGIC_LINKS_STORE)
  const key = usedKey(token)
  let existing = null
  try {
    existing = (await store.get(key, { type: 'json' })) || null
  } catch {
    existing = null
  }
  if (existing) return false
  try {
    await store.setJSON(key, { usedAt: new Date().toISOString() })
  } catch {
    // Best-effort marker write (see module comment).
  }
  return true
}
