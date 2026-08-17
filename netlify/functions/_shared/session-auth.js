// Session-token request authorization (SEC-EPIC-1, #176 + #181).
//
// The single place a request's `Authorization: Bearer <token>` resolves to a
// LIVE server-side session and then to an identity:
//   - admin session (role 'admin', userId 'owner')   -> the constant owner
//   - demo session  (role 'demo')                    -> the constant demo user
//   - member session (any other role/userId)         -> getUser(userId)
//
// The session record's `role` is captured server-side at login (SEC-1.6, #181)
// and NEVER derived from the client or the bearer string, so a member can never
// self-promote to admin. The access code is NOT resolved here anymore — the
// code → user lookup now lives only in the login exchange (auth.js).

import { DEMO_USER, OWNER_ID, bearer } from './auth'
import { getSessionByToken, isSessionLive } from './sessions'
import { getUser } from './users'

const json = (statusCode, body, headers = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
})

// The owner's constant profile, reconstructed from an admin session. Mirrors
// profileForCode() in auth.js — every feature flag on, so the client can read
// session.user.features.lending === true for the owner too.
function ownerProfile() {
  return {
    id: OWNER_ID,
    name: 'Admin',
    email: '',
    collections: { records: true, books: true },
    features: { lending: true, games: true },
    role: 'admin',
    status: 'active',
  }
}

// Resolve a request to a live session + identity. Returns
//   { user, session, token }   on success, or
//   { error: <Response> }      on failure (401 missing/invalid/expired/revoked,
//                              403 disabled account).
export async function resolveSession(req) {
  const token = bearer(req)
  if (!token) return { error: json(401, { error: 'Not signed in.' }) }

  const session = await getSessionByToken(token)
  if (!session || !isSessionLive(session)) {
    return { error: json(401, { error: 'Your session has expired or was signed out. Sign in again.', code: 'SESSION_INVALID' }) }
  }

  let user
  if (session.role === 'admin' && session.userId === OWNER_ID) {
    user = ownerProfile()
  } else if (session.role === 'demo') {
    user = DEMO_USER
  } else {
    user = await getUser(session.userId)
  }

  if (!user) return { error: json(401, { error: 'Not signed in.' }) }
  // A disabled member's session is rejected on revalidation / every call
  // (SEC-1.9, #184) — sessions do not outlive the account status.
  if (user.status !== 'active') {
    return { error: json(403, { error: 'This account is disabled.' }) }
  }
  return { user, session, token }
}

// Admin-gate a request: resolve the session AND require the resolved user's
// role to be 'admin' (SEC-1.6, #181). Returns the same shape as resolveSession
// — { error: <Response> } on failure. Members (and forged/absent keys) are
// 403 — the global ADMIN_KEY is never re-checked here, it only ever minted the
// admin session at login.
//
// IMPORTANT: on a failed resolveSession the RESPONSE is wrapped as
// { error: <Response> } — returning the raw Response here would make
// `if (admin.error)` falsy and let the caller fall through the guard (an
// authorization bypass).
export async function requireAdmin(req) {
  const resolved = await resolveSession(req)
  if (resolved.error) return { error: resolved.error }
  if (resolved.user.role !== 'admin') {
    return { error: json(403, { error: 'Admin access required.' }) }
  }
  return resolved
}
