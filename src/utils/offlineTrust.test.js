// #162 / ADR-0019 Dec 4 — the trusted-device / offline-authorization record.
//
// Verifies the bounded offline-trust lifecycle: established only after a
// successful ONLINE authentication, extended only on online revalidation,
// revocable on sign-out / account switch / confirmed revocation / expiry, and
// — critically — that the record NEVER contains the session token or access
// code (no reusable credential in local storage beyond the server-revocable
// session token, which itself is never in this record). Offline access fails
// closed when the record is missing, expired, user-mismatched, scope-denied,
// or bound to a different session.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  OFFLINE_TRUST_TTL_MS,
  establishOfflineTrust,
  getOfflineTrust,
  offlineAccessAllowed,
  revalidateOfflineTrust,
  revokeOfflineTrust,
  sessionFingerprint,
  sessionFingerprintAsync,
} from './offlineTrust'

const USER = { id: 'u1', name: 'Ada', role: 'member' }
const OTHER = { id: 'u2', name: 'Bob', role: 'member' }
const TOKEN = 'tok-session-abc123'

// A fixed clock so expiry tests are deterministic.
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

beforeEach(() => {
  localStorage.clear()
})

function fp(token = TOKEN) {
  return sessionFingerprint(token)
}

describe('the trust record never stores a credential (#162)', () => {
  it('stores only userId/role/timestamps/scopes — never the token or access code', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    const raw = localStorage.getItem('runout.offlineTrust')
    // The token itself is never persisted.
    expect(raw).not.toContain(TOKEN)
    // No access-code / bearer-like value either.
    expect(raw).not.toContain('RU-')
    // The field that binds to the session is a bounded NON-SECRET fingerprint,
    // not the raw credential.
    expect(raw).toContain(`"sessionFp":"fp:`)
    const record = getOfflineTrust()
    expect(record.userId).toBe('u1')
    expect(record.role).toBe('member')
    expect(record.scopes).toContain('shell')
    expect(record).not.toHaveProperty('token')
    expect(record).not.toHaveProperty('code')
    expect(record).not.toHaveProperty('session')
  })

  it('session fingerprint is a deterministic non-secret binding, distinct from the token', async () => {
    // Same token → same fingerprint (stable across calls).
    expect(sessionFingerprint(TOKEN)).toBe(sessionFingerprint(TOKEN))
    // Different token → different fingerprint.
    expect(sessionFingerprint(TOKEN)).not.toBe(sessionFingerprint('tok-other'))
    // A different token is never conflated.
    expect(sessionFingerprint(TOKEN)).not.toBe(sessionFingerprint('tok-other'))
    // The async variant (WebCrypto sha256 when available, bounded fallback
    // otherwise) is deterministic for the same token and never returns the raw
    // token — a one-way binding.
    const fpA = await sessionFingerprintAsync(TOKEN)
    const fpB = await sessionFingerprintAsync(TOKEN)
    expect(fpA).toBe(fpB)
    expect(`${fpA}`).not.toContain(TOKEN)
    expect(`${fpA}`).not.toContain('tok-')
    expect(`${fpA}`).not.toMatch(/\btok-session\b/)
  })

  it('sessionFingerprintAsync prefers the WebCrypto SHA-256 digest over FNV (SEC-5.2 #376)', async () => {
    // The project test runner runs on Node with WebCrypto available, so the
    // async fingerprint resolves to the SHA-256 binding form (the same branch a
    // browser/PWA prefers) — never the FNV fallback.
    const sha = await sessionFingerprintAsync(TOKEN)
    expect(sha).toMatch(/^sha256:/)
    expect(sha).not.toMatch(/^fp:/)
    expect(sha).not.toContain(TOKEN)
    // And it differs from the documented FNV-1a sync fallback.
    expect(sha).not.toBe(sessionFingerprint(TOKEN))
  })

  it('keeps the FNV-1a sync fallback as a documented, still-honored binding scheme', async () => {
    // The FNV-1a sync digest remains the documented fallback for non-WebCrypto
    // environments (jsdom/sync). It produces the fp: binding form and is still
    // validated by offlineAccessAllowed — a legacy/FNV-bound record is not
    // orphaned by the SHA-256 preference.
    const fnv = sessionFingerprint(TOKEN)
    expect(fnv).toMatch(/^fp:/)
    establishOfflineTrust(USER, { now: NOW, sessionFp: fnv })
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(true)
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: 'tok-rotated-xyz456' })).toBe(false)
  })

  it('honors a trust record bound with the async SHA-256 fingerprint and rejects a rotated token (SEC-5.2 #376)', async () => {
    const shaFp = await sessionFingerprintAsync(TOKEN)
    expect(shaFp).toMatch(/^sha256:/)
    establishOfflineTrust(USER, { now: NOW, sessionFp: shaFp })
    // The record never stores the raw token; the stored binding is sha256-form.
    expect(localStorage.getItem('runout.offlineTrust')).not.toContain(TOKEN)
    // Same token → async binding matches; rotated token → denied (fail closed).
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(true)
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: 'tok-rotated-xyz456' })).toBe(false)
  })
})

describe('offlineAccessAllowed — fail closed unless trusted within the window', () => {
  it('denies when there is no trust record at all', async () => {
    expect(await offlineAccessAllowed(USER, { now: NOW, token: TOKEN })).toBe(false)
  })

  it('allows within the bounded window for a matching user', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(true)
  })

  it('denies when the offline window has expired', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    // Just past the TTL since establishment.
    expect(await offlineAccessAllowed(USER, { now: NOW + OFFLINE_TRUST_TTL_MS + 1, token: TOKEN })).toBe(false)
  })

  it('denies a different user on the same device (no cross-tenant/account leak)', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(await offlineAccessAllowed(OTHER, { now: NOW + 1000, token: TOKEN })).toBe(false)
  })

  it('denies when the session token binding does not match (rotated session)', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp(TOKEN) })
    // A different (rotated) session token must not inherit stale offline trust.
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: 'tok-rotated-xyz456' })).toBe(false)
    // The exact token still matches (the session did not change).
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(true)
  })

  it('denies a scope not granted on the record', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    // M1 grants 'shell' and M2 grants 'collection' (the offline mirror read
    // scope, #289); anything else (e.g. a future sync/mutation scope) is denied
    // until it is explicitly granted.
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN, scope: 'sync' })).toBe(false)
  })

  it('fails closed on a corrupted record', async () => {
    localStorage.setItem('runout.offlineTrust', '{not valid json')
    expect(getOfflineTrust()).toBeNull()
    expect(await offlineAccessAllowed(USER, { now: NOW, token: TOKEN })).toBe(false)
  })
})

describe('revalidateOfflineTrust — only online revalidation extends the window', () => {
  it('extends the offline window on a successful online revalidation', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    const mid = NOW + 1000
    revalidateOfflineTrust(USER, { now: mid, sessionFp: fp() })
    // After revalidation the window is now relative to `mid`, so far past the
    // ORIGINAL establishment TTL is still allowed.
    expect(await offlineAccessAllowed(USER, { now: NOW + OFFLINE_TRUST_TTL_MS + 1000, token: TOKEN })).toBe(true)
  })

  it('does not mint trust when none exists (offline-only event never establishes)', async () => {
    revalidateOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(getOfflineTrust()).toBeNull()
    expect(await offlineAccessAllowed(USER, { now: NOW, token: TOKEN })).toBe(false)
  })

  it('invalidates a stale record when a different user revalidates (fail closed)', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    revalidateOfflineTrust(OTHER, { now: NOW + 1000, sessionFp: fp() })
    expect(getOfflineTrust()).toBeNull()
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(false)
  })
})

describe('revokeOfflineTrust — sign-out / switch / confirmed revocation clears it', () => {
  it('removes the record so offline access is denied', async () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(getOfflineTrust()).not.toBeNull()
    revokeOfflineTrust({ reason: 'sign_out' })
    expect(getOfflineTrust()).toBeNull()
    expect(await offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(false)
  })

  it('is idempotent (revoking when nothing exists is a safe no-op)', () => {
    expect(() => revokeOfflineTrust({ reason: 'sign_out' })).not.toThrow()
    expect(getOfflineTrust()).toBeNull()
  })
})
