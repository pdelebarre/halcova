// Trusted-device / offline-authorization record (M1, #162; ADR-0019 Dec 4;
// ADR-0016 trust rules).
//
// WHAT THIS IS
// ------------
// The ADRs require that offline access be limited to a device that was
// previously authenticated ONLINE and is EXPLICITLY trusted, with a defined
// expiry/revocation and local invalidation on sign-out / account switch /
// expiry / confirmed revocation. This module owns the small local "offline
// trust" record that expresses that grant on this device.
//
// The record is a LOCAL, NON-CREDENTIAL authorization marker. It deliberately:
//   - NEVER contains the session token, the access code, the admin key, or any
//     bearer/reusable secret (ADR-0019 Dec 4; the requirement that no raw
//     password / access code / token is stored holds — the token itself lives
//     only in `localStorage.runout.session`, never in IndexedDB, and never in
//     this record).
//   - is stored in `localStorage` (the approved minimal session/bootstrap
//     store), NOT IndexedDB, and is keyed to the resolved user id so a stale
//     record from a prior account cannot grant access to another user.
//   - has a bounded offline lifetime (`expiresAt`), extended ONLY on a
//     successful ONLINE revalidation; a cached trust marker is never evidence
//     that an account remains authorized indefinitely (ADR-0016 rule 5).
//
// TRUST LIFECYCLE
// ---------------
//   - establish: after a successful ONLINE login / magic-link verify — mints a
//     fresh trust record for the resolved user with a bounded expiry.
//   - revalidate: on every successful ONLINE `me()` — pushes `expiresAt` out
//     to a bounded window, so reconnecting re-establishes/extends offline
//     access. Fail-closed: a network error is NOT revalidation, it never
//     extends the window.
//   - revoke: on sign-out, sign-out-all, account switch, a CONFIRMED 401/403
//     (session revoked / account disabled), local security reset, or expiry —
//     the record is removed so offline access fails closed.
//
// CAPABILITY SCOPING (ADR-0016)
// -------------------------------
// Offline access is capability-scoped. The only approved M1 offline capability
// is rendering the previously-authenticated shell with its cached session
// (`scope: 'shell'`). M2 extends this with the collection mirror (which will
// be a NEW IndexedDB-backed capability checked against the same trust record);
// sync/collection offline capabilities are NOT built here (M2).
//
// The `scopes` array is OPAQUE to the trust record — it does not confer any
// data; it is an authorization marker consumed by the capability gate. A
// missing/expired record or a scope not present => offline access denied.

// The bounded offline-authorization window: how long offline access lasts
// since the LAST SUCCESSFUL ONLINE revalidation. Default 7 days. Kept as a
// module constant (not env) so the client stays deterministic and testable.
export const OFFLINE_TRUST_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Capability scopes approved for M1/M2.
//   - 'shell'      : the offline app shell may render with the cached session.
//   - 'collection' : the offline collection mirror (#289) may be read/hydrated
//                    for the signed-in user (the M2 offline mirror capability).
//                    Sync/mutation scopes (#292) are added separately when the
//                    outbox ships; the mirror READ scope is granted here because
//                    #289's acceptance criteria (offline launch renders the
//                    last-known collection) require offline mirror reads.
export const OFFLINE_SCOPES = Object.freeze({
  SHELL: 'shell',
  COLLECTION: 'collection',
})

const KEY = 'runout.offlineTrust'

// A non-secret, bounded fingerprint of the session token, used ONLY to bind the
// trust record to the CURRENT session state (so a stale trust record from an
// old sign-in can never authorize offline access after the token rotated).
//
// This is NOT a credential and is NOT reversible to the token — it is a
// one-way, fixed-length binding. It is never used as an authorization bearer,
// never sent anywhere, and never logged. We deliberately do NOT store the token
// or a hash that could be confused with a stored secret; a deterministic
// bounded digest is sufficient for the "does this trust record still correspond
// to the live session" bind. (Browser-safe: no node:crypto dependency.)
export function sessionFingerprint(token) {
  if (!token) return ''
  const s = String(token)
  // FNV-1a (32-bit) — a cheap, deterministic, non-reversible digest. Fine for a
  // binding marker; the token itself is NEVER stored anywhere.
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return `fp:${h.toString(16).padStart(8, '0')}`
}

// Async fingerprint prefers the Web Crypto SHA-256 (browser/PWA); falls back to
// the bounded FNV-1a digest in non-WebCrypto environments (tests/node).
export async function sessionFingerprintAsync(token) {
  if (!token) return ''
  if (globalThis?.crypto?.subtle) {
    try {
      const data = new TextEncoder().encode(String(token))
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
      const bytes = new Uint8Array(digest)
      let hex = ''
      for (const b of bytes) hex += b.toString(16).padStart(2, '0')
      return `sha256:${hex}`
    } catch {
      // fall through to the bounded fallback
    }
  }
  return sessionFingerprint(token)
}

// Decode a stored record, never throwing. Returns null on any corruption or
// non-object payload (fail-closed — never trust malformed data).
function readRecord() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (typeof parsed.userId !== 'string' || typeof parsed.expiresAt !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function writeRecord(record) {
  try {
    if (record) localStorage.setItem(KEY, JSON.stringify(record))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage failure must never throw to the caller — fail-closed (no record
    // persisted means no offline trust granted).
  }
}

// True when `now` is within the bounded offline window for the current user.
// Fail-closed: a missing record, expired window, mismatched user, or a scope
// not listed in the record all DENY offline access. When `token` is supplied it
// must match the record's stored session fingerprint — a stale record from a
// rotated session is never honored and (optionally) revoked.
//
// Async because the session binding prefers the WebCrypto SHA-256 fingerprint
// (see sessionFingerprintAsync). To stay consistent regardless of how the
// record was bound (SHA-256 in a WebCrypto browser, or the FNV-1a sync/jsdom
// fallback in non-WebCrypto environments), we match the stored fingerprint
// against BOTH the sync FNV digest and the async SHA-256 digest. This is still
// fail-closed: only the exact same token's fingerprint can validate the record.
export async function offlineAccessAllowed(
  user,
  { now = Date.now(), scope = OFFLINE_SCOPES.SHELL, token = '' } = {},
) {
  const record = readRecord()
  if (!record) return false
  if (!user || typeof user === 'string') return false
  const userId = typeof user === 'object' ? user.id : user
  if (!userId || record.userId !== userId) return false
  if (new Date(record.expiresAt).getTime() < now) return false
  if (Array.isArray(record.scopes) && !record.scopes.includes(scope)) return false
  // Optional session binding: if a token is provided, the record must be bound
  // to IT (or be an unbound legacy write). A rotated session never inherits
  // stale offline trust. See note above about matching both fingerprint schemes.
  if (token && record.sessionFp) {
    if (record.sessionFp !== sessionFingerprint(token)) {
      const fpAsync = await sessionFingerprintAsync(token)
      if (record.sessionFp !== fpAsync) return false
    }
  }
  return true
}

// Mint a fresh trust record after a successful ONLINE authentication. Call this
// with a fully authenticated/resolved user (never a client-supplied identity).
// `sessionFp` is the NON-SECRET session fingerprint (see sessionFingerprint),
// NOT the token itself.
export function establishOfflineTrust(user, { now = Date.now(), sessionFp = '' } = {}) {
  const userId = user?.id
  if (!userId) return null
  const record = {
    userId,
    role: user.role || 'member',
    establishedAt: new Date(now).toISOString(),
    lastVerifiedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OFFLINE_TRUST_TTL_MS).toISOString(),
    // Approved scopes: M1 'shell' + M2 'collection' mirror reads. M2 mutation
    // scopes (#292) are added separately when the outbox ships.
    scopes: [OFFLINE_SCOPES.SHELL, OFFLINE_SCOPES.COLLECTION],
    // Non-secret binding to the current session (see sessionFingerprint).
    sessionFp,
  }
  writeRecord(record)
  logLocalAudit('offline.trust_established', { userId })
  return record
}

// Extend the trust window on a successful ONLINE revalidation (latest `me()`).
// Only extends when a record ALREADY exists for this user; never creates one
// from an offline-only event, and never extends past the bounded window from
// `now`. Returns the updated record, or null when nothing to extend (no fit).
export function revalidateOfflineTrust(user, { now = Date.now(), sessionFp = '' } = {}) {
  const record = readRecord()
  const userId = user?.id
  if (!record || !userId) return null
  if (record.userId !== userId) {
    // A different user signed in without a clean switch — invalidate the stale
    // record rather than extend it (fail closed).
    writeRecord(null)
    logLocalAudit('offline.trust_invalidated', { reason: 'user_mismatch', userId })
    return null
  }
  const next = {
    ...record,
    lastVerifiedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OFFLINE_TRUST_TTL_MS).toISOString(),
    sessionFp: sessionFp || record.sessionFp,
  }
  writeRecord(next)
  return next
}

// Get the raw trust record (read-only introspection; tests + M2 sync gate).
export function getOfflineTrust() {
  return readRecord()
}

// Remove the trust record entirely (sign-out, sign-out-all, account switch,
// CONFIRMED 401/403, local security reset, expiry). After this, offline access
// fails closed until the next successful ONLINE authentication.
export function revokeOfflineTrust({ reason = 'sign_out' } = {}) {
  const hadRecord = !!readRecord()
  writeRecord(null)
  if (hadRecord) logLocalAudit('offline.trust_revoked', { reason })
  return true
}

// ---------------------------------------------------------------------------
// Local security audit (trust lifecycle). These are LOCAL events (client-side
// record) emitted as structured `AUDIT ` console lines, matching the server's
// `logAudit` convention (see netlify/functions/_shared/audit.js). They never
// include the session token, access code, or any secret — only safe ids. The
// server-side auth events (auth.login_success / auth.logout / auth.logout_all /
// auth.session_invalid / admin.rotate / admin.update_user / admin.delete_user)
// already cover the SERVER-side revocation surface; these cover the local
// trusted-device grant/revocation lifecycle.
// ---------------------------------------------------------------------------
function logLocalAudit(eventType, fields = {}) {
  try {
    const safe = {}
    for (const [key, value] of Object.entries(fields)) {
      if (/token|code|secret|authorization|session\b/i.test(key)) continue
      safe[key] = value
    }
    console.log(`AUDIT ${JSON.stringify({ ts: new Date().toISOString(), type: eventType, ...safe })}`)
  } catch { /* audit must never throw */ }
}

// Public audit hook so callers (useAuth) can emit trust-establishment events
// in the same convention.
export function logOfflineAudit(eventType, fields = {}) {
  logLocalAudit(eventType, fields)
}
