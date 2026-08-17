// Server-managed session tokens (SEC-EPIC-1, #176). The access code / admin
// key is now ONLY an exchange credential at login; a successful login mints an
// opaque, random, expiring session token that the client holds and sends as
// `Authorization: Bearer <sessionToken>` on every call. The server stores only
// the sha256 hash of the token (mirroring users.code_hash) in a `sessions`
// repository behind the SAME Blobs↔Postgres seam as users/items:
//   - DATABASE_URL unset  -> the runout-sessions Blobs implementation.
//   - DATABASE_URL set    -> the Postgres `sessions` table (authoritative;
//     Blobs becomes the read-through fallback / dual-write mirror).
//
// Security properties:
//   - Opaque: 32 random bytes (256 bits), base64url — not derivable from any
//     user attribute and carrying no identity in the token itself.
//   - Revocable: logout / disable / rotate / delete flip the record to
//     'revoked' (or delete it), so a stolen token is killable.
//   - Expiring: TTL defaults to 30 days (RUNOUT_SESSION_TTL_DAYS, hard-capped
//     at 90) so a leaked token has a bounded window.
//   - Fixation-proof: a fresh random token is minted on EVERY login — the
//     client never supplies a token at login.

import { createHash, randomBytes } from 'node:crypto'
import { getRepository } from './repository'

// The absolute maximum lifetime of any session record — 90 days from CREATION,
// no matter what the env says (SEC-1.3, #178). `sessionTtlMs()` (the per-renewal
// TTL) is capped at this too, and sliding renewal never pushes a session's
// expiresAt past createdAt + SESSION_HARD_CAP_MS.
export const SESSION_HARD_CAP_MS = 90 * 24 * 60 * 60 * 1000

// Fixed session TTL, capped at 90 days no matter what the env says.
export function sessionTtlMs() {
  const days = Number(process.env.RUNOUT_SESSION_TTL_DAYS)
  const ms = Number.isFinite(days) && days > 0 ? Math.floor(days * 24 * 60 * 60 * 1000) : 30 * 24 * 60 * 60 * 1000
  return Math.min(ms, SESSION_HARD_CAP_MS)
}

// The canonical key for a session token: sha256 — the raw token is never
// stored server-side, so a leaked store exposes no reusable credential.
export function sessionTokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

// Opaque 256-bit session token. base64url stays URL/header-safe.
export function generateSessionToken() {
  return randomBytes(32).toString('base64url')
}

// Is this session record currently usable? Must be active, not revoked, and
// unexpired. The caller separately re-checks the USER's status (a disabled
// member's session is rejected even while the record is still active).
export function isSessionLive(session, { now = Date.now() } = {}) {
  if (!session) return false
  if (session.status !== 'active') return false
  if (session.revokedAt) return false
  if (session.expiresAt && new Date(session.expiresAt).getTime() < now) return false
  return true
}

// Mint a session for an identity and persist it server-side. Returns the
// plaintext token (handed to its owner exactly once) plus the stored record.
// `role` is captured on the record from the SERVER-resolved user at login —
// it is never supplied by the client — so admin authorization (SEC-1.6, #181)
// never trusts a bearer string.
export async function createSession({ userId, role, status = 'active', now = Date.now() } = {}) {
  const token = generateSessionToken()
  const record = {
    tokenHash: sessionTokenHash(token),
    userId,
    role,
    status,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionTtlMs()).toISOString(),
  }
  await getRepository().sessions.save(record)
  return { token, record }
}

// SEC-1.3 (#178) — SLIDING RENEWAL with replay safety.
//
// A live session whose remaining lifetime has dropped below half the TTL is
// extended server-side to `now + TTL`, re-saved under the SAME token hash —
// so the client keeps the same token (no churn, no session proliferation) and
// the token is never minted fresh on ordinary requests (replay-safe: it is
// still the same opaque credential, revocable and expiry-capped). Renewal
// NEVER pushes expiry past the absolute hard cap of 90 days from CREATION
// (SESSION_HARD_CAP_MS), so a stolen token can never be kept alive forever.
// Fixation protection is untouched: a fresh random token is still minted on
// every LOGIN, never by renewal.
//
// Renewal is invoked from resolveSession, so it is bounded — a write happens
// at most every ~half-TTL of active use (after an extension the remaining
// lifetime is again above the window, so the next request is a no-op read).
//
// Returns { renewed, session }: `session` is the (possibly extended) record.
// A revoked/expired session is never renewed — dead stays dead.
export async function renewSessionIfNeeded(session, { now = Date.now() } = {}) {
  if (!session || !session.expiresAt || !isSessionLive(session, { now })) {
    return { renewed: false, session }
  }
  const remaining = new Date(session.expiresAt).getTime() - now
  // Renew only once the remaining lifetime drops below half the TTL.
  if (remaining >= sessionTtlMs() / 2) return { renewed: false, session }
  const createdAt = new Date(session.createdAt).getTime()
  const next = Math.min(now + sessionTtlMs(), createdAt + SESSION_HARD_CAP_MS)
  const renewed = { ...session, expiresAt: new Date(next).toISOString() }
  await getRepository().sessions.save(renewed)
  return { renewed: true, session: renewed }
}

export async function getSessionByToken(token) {
  if (!token) return null
  return getRepository().sessions.getByTokenHash(sessionTokenHash(token))
}

// Revoke a single session (logout). Idempotent — revoking an already-dead
// token is a no-op success.
export async function revokeSession(token) {
  if (!token) return false
  return getRepository().sessions.revokeByTokenHash(sessionTokenHash(token))
}

// Revoke every live session for a user (disable / rotate). Best-effort bulk —
// the per-request user-status check in resolveSession is the authoritative
// gate regardless.
export async function revokeAllForUser(userId) {
  return getRepository().sessions.revokeAllForUser(userId)
}

// Delete every session record for a user (deleteUser — the sessions go with
// the account).
export async function deleteAllForUser(userId) {
  return getRepository().sessions.deleteAllForUser(userId)
}
