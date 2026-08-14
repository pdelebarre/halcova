// Client for the auth + admin Netlify functions. Every call carries the
// access code as `Authorization: Bearer <code>` (members) or the admin key
// (the owner), which the functions validate server-side.

import { getAccessCode, saveSession } from '../utils/session'

const AUTH_URL = '/.netlify/functions/auth'
const ADMIN_URL = '/.netlify/functions/admin'

// The public demo space code (ADR-0001). Intentionally NOT secret: it ships in
// the client so the "Try the free demo" button can sign visitors in. It is
// safe only because the demo store is read-only server-side (DEMO_READONLY).
export const DEMO_CODE = 'RUNOUT-DEMO-0000'

function authHeaders(code) {
  return {
    'Content-Type': 'application/json',
    ...(code ? { Authorization: `Bearer ${code}` } : {}),
  }
}

async function postJson(url, body, code) {
  const res = await fetch(url, { method: 'POST', headers: authHeaders(code), body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.code = data.code
    throw err
  }
  return data
}

async function getJson(url, code) {
  const res = await fetch(url, { headers: code ? { Authorization: `Bearer ${code}` } : {} })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// ---- Member / visitor endpoints ----


// Self-serve signup (ADR-0003 S1): request a one-time sign-in link by email.
// No auth header — a visitor can't sign in yet.
export async function requestMagicLink({ email }) {
  return postJson(AUTH_URL, { action: 'requestMagicLink', email })
}

// Exchange a magic-link token for a session. The backend auto-issues (or, for
// a returning member, rotates) the RU- access code and returns { user, code }
// — the same shape as login(), so the session persists identically. On a
// rejected link the thrown Error carries `code` (LINK_EXPIRED | LINK_USED |
// LINK_INVALID) for the UI to branch on.
export async function verifyMagicLink({ token }) {
  const data = await postJson(AUTH_URL, { action: 'verifyMagicLink', token })
  saveSession({ user: data.user, code: data.code })
  return data.user
}
// Ask to join: creates a pending request the admin approves from the panel.
export async function requestAccess({ name, email }) {
  return postJson(AUTH_URL, { action: 'request', name, email })
}

// Exchange an access code (member or admin key) for a session. Persists it
// with the canonical code returned by the server so later API calls work
// regardless of how the code was typed.
// Logging in is pre-auth: the code travels in the body, not as a header.
export async function login(code) {
  const data = await postJson(AUTH_URL, { action: 'login', code })
  saveSession({ user: data.user, code: data.code || code })
  return data.user
}

// Revalidate the cached session on app start. Returns the user, or null when
// the code is no longer valid (account disabled / code revoked).
export async function me() {
  const code = getAccessCode()
  if (!code) return null
  const res = await fetch(`${AUTH_URL}?me=1`, { headers: { Authorization: `Bearer ${code}` } })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 || res.status === 403) {
    saveSession(null)
    return null
  }
  if (!res.ok) throw new Error(data.error || 'Could not refresh session')
  saveSession({ user: data.user, code: data.code || code })
  return data.user
}

export function logout() {
  saveSession(null)
}

// ---- Admin endpoints (Authorization must be the admin key) ----

export async function adminList() {
  return getJson(ADMIN_URL, getAccessCode())
}

export async function adminApprove({ requestId, collections, features, plan }) {
  return postJson(ADMIN_URL, { action: 'approve', requestId, collections, features, plan }, getAccessCode())
}

export async function adminReject({ requestId }) {
  return postJson(ADMIN_URL, { action: 'reject', requestId }, getAccessCode())
}

export async function adminUpdateUser({ userId, collections, status, features, plan }) {
  return postJson(ADMIN_URL, { action: 'updateUser', userId, collections, status, features, plan }, getAccessCode())
}

export async function adminDeleteUser({ userId }) {
  return postJson(ADMIN_URL, { action: 'deleteUser', userId }, getAccessCode())
}

// Rotate a member's code (Scaling Phase 1): the backend only keeps a sha256
// hash, so it mints a NEW code, stores its hash, and returns the new plaintext
// exactly once ({ user, code } — same shape as approve). The old code stops
// working immediately.
export async function adminRotate({ userId }) {
  return postJson(ADMIN_URL, { action: 'rotate', userId }, getAccessCode())
}
