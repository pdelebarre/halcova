// #162 / ADR-0015 Dec 4 — the trusted-device / offline-authorization record.
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
})

describe('offlineAccessAllowed — fail closed unless trusted within the window', () => {
  it('denies when there is no trust record at all', () => {
    expect(offlineAccessAllowed(USER, { now: NOW, token: TOKEN })).toBe(false)
  })

  it('allows within the bounded window for a matching user', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(true)
  })

  it('denies when the offline window has expired', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    // Just past the TTL since establishment.
    expect(offlineAccessAllowed(USER, { now: NOW + OFFLINE_TRUST_TTL_MS + 1, token: TOKEN })).toBe(false)
  })

  it('denies a different user on the same device (no cross-tenant/account leak)', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(offlineAccessAllowed(OTHER, { now: NOW + 1000, token: TOKEN })).toBe(false)
  })

  it('denies when the session token binding does not match (rotated session)', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp(TOKEN) })
    // A different (rotated) session token must not inherit stale offline trust.
    expect(offlineAccessAllowed(USER, { now: NOW + 1000, token: 'tok-rotated-xyz456' })).toBe(false)
    // The exact token still matches (the session did not change).
    expect(offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(true)
  })

  it('denies a scope not granted on the record', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    // M1 only grants 'shell'; anything else (e.g. an M2 sync scope) is denied.
    expect(offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN, scope: 'collection' })).toBe(false)
  })

  it('fails closed on a corrupted record', () => {
    localStorage.setItem('runout.offlineTrust', '{not valid json')
    expect(getOfflineTrust()).toBeNull()
    expect(offlineAccessAllowed(USER, { now: NOW, token: TOKEN })).toBe(false)
  })
})

describe('revalidateOfflineTrust — only online revalidation extends the window', () => {
  it('extends the offline window on a successful online revalidation', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    const mid = NOW + 1000
    revalidateOfflineTrust(USER, { now: mid, sessionFp: fp() })
    // After revalidation the window is now relative to `mid`, so far past the
    // ORIGINAL establishment TTL is still allowed.
    expect(offlineAccessAllowed(USER, { now: NOW + OFFLINE_TRUST_TTL_MS + 1000, token: TOKEN })).toBe(true)
  })

  it('does not mint trust when none exists (offline-only event never establishes)', () => {
    revalidateOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(getOfflineTrust()).toBeNull()
    expect(offlineAccessAllowed(USER, { now: NOW, token: TOKEN })).toBe(false)
  })

  it('invalidates a stale record when a different user revalidates (fail closed)', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    revalidateOfflineTrust(OTHER, { now: NOW + 1000, sessionFp: fp() })
    expect(getOfflineTrust()).toBeNull()
    expect(offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(false)
  })
})

describe('revokeOfflineTrust — sign-out / switch / confirmed revocation clears it', () => {
  it('removes the record so offline access is denied', () => {
    establishOfflineTrust(USER, { now: NOW, sessionFp: fp() })
    expect(getOfflineTrust()).not.toBeNull()
    revokeOfflineTrust({ reason: 'sign_out' })
    expect(getOfflineTrust()).toBeNull()
    expect(offlineAccessAllowed(USER, { now: NOW + 1000, token: TOKEN })).toBe(false)
  })

  it('is idempotent (revoking when nothing exists is a safe no-op)', () => {
    expect(() => revokeOfflineTrust({ reason: 'sign_out' })).not.toThrow()
    expect(getOfflineTrust()).toBeNull()
  })
})
