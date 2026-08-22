// Client for the auth + admin Netlify functions.
//
// SEC-EPIC-1 (#176/#177): every call carries the SERVER-MANAGED session token
// as `Authorization: Bearer <sessionToken>`. The access code / admin key is
// only ever an EXCHANGE credential sent once at login — it is never persisted
// and never sent again. The persisted session (localStorage.runout.session) is
// `{ user, session }`: the opaque token + display data only.

import { getSessionToken, saveSession } from '../utils/session'

const AUTH_URL = '/.netlify/functions/auth'
const ADMIN_URL = '/.netlify/functions/admin'

// The public demo space code (ADR-0001). Intentionally NOT secret: it ships in
// the client so the "Try the free demo" button can sign visitors in. It is
// safe only because the demo store is read-only server-side (DEMO_READONLY),
// and login() only ever exchanges it for a revocable demo session token.
export const DEMO_CODE = 'RUNOUT-DEMO-0000'

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function postJson(url, body, token) {
  const res = await fetch(url, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.code = data.code
    throw err
  }
  return data
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
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
// a returning member, rotates) the RU- access code, exchanges it for a fresh
// session token, and returns { user, session } — the same shape as login().
// The access code is never persisted client-side. On a rejected link the
// thrown Error carries `code` (LINK_EXPIRED | LINK_USED | LINK_INVALID).
export async function verifyMagicLink({ token }) {
  const data = await postJson(AUTH_URL, { action: 'verifyMagicLink', token })
  saveSession({ user: data.user, session: data.session })
  return data.user
}
// Ask to join: creates a pending request the admin approves from the panel.
export async function requestAccess({ name, email }) {
  return postJson(AUTH_URL, { action: 'request', name, email })
}

// Exchange an access code (member, admin key, or demo code) for a session.
// Logging in is pre-auth: the code travels in the body, not as a header, and
// the server returns an opaque session token — never the code — to persist.
export async function login(code) {
  const data = await postJson(AUTH_URL, { action: 'login', code })
  saveSession({ user: data.user, session: data.session })
  return data.user
}

// Revalidate the cached session on app start. Returns the user, or null when
// the session token is no longer valid (account disabled / session revoked).
export async function me() {
  const token = getSessionToken()
  if (!token) return null
  const res = await fetch(`${AUTH_URL}?me=1`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 || res.status === 403) {
    saveSession(null)
    return null
  }
  if (!res.ok) throw new Error(data.error || 'Could not refresh session')
  saveSession({ user: data.user, session: data.session || token })
  return data.user
}

// Sign out: revoke the session token server-side (SEC-1.9, #184) so it is dead
// even if a copy was cached elsewhere, then clear the local session. The local
// clear always happens — revocation is best-effort against the network.
export async function logout() {
  const token = getSessionToken()
  if (token) {
    try {
      await postJson(AUTH_URL, { action: 'logout' }, token)
    } catch { /* ignore network/revocation failures */ }
  }
  saveSession(null)
}

// SEC-1.4 (#179) — "sign out all devices": revoke EVERY session for the signed
// in user (the current one included) server-side, then clear the local session.
// After this, every prior token for this account returns 401. The local clear
// always happens — revocation is best-effort against the network.
export async function logoutAll() {
  const token = getSessionToken()
  if (token) {
    try {
      await postJson(AUTH_URL, { action: 'logoutAll' }, token)
    } catch { /* ignore network/revocation failures */ }
  }
  saveSession(null)
}

// ---- Admin endpoints (Authorization must be the owner's admin session) ----

export async function adminList() {
  return getJson(ADMIN_URL, getSessionToken())
}

// Admin Dashboard aggregates (ADMIN-EPIC-1, #260): GET /admin?dashboard=1 is
// the same requireAdmin-gated endpoint as adminList(), with an opt-in `counts`
// block appended (T1 backend). Returns the full payload
// `{ requests, users, counts }` — aggregates only, never identities. The
// counts block is the cheap call the App-level pending badge also uses (T3
// #263), which is why it's separate from adminList().
export async function adminDashboard() {
  return getJson(`${ADMIN_URL}?dashboard=1`, getSessionToken())
}

// Admin counts-only (ADMIN-EPIC-1, #264): GET /admin?counts=1 returns ONLY
// `{ counts }` — the CWE-200 counts-only mode the App-level pending badge
// polls every 60s. The requests/users lists (names + emails) are never
// serialized into the body, so no PII leaves the function. Same
// requireAdmin gate, response shape and error handling as adminDashboard(),
// minus the PII lists.
export async function adminCounts() {
  return getJson(`${ADMIN_URL}?counts=1`, getSessionToken())
}

export async function adminApprove({ requestId, collections, features, plan }) {
  return postJson(ADMIN_URL, { action: 'approve', requestId, collections, features, plan }, getSessionToken())
}

export async function adminReject({ requestId }) {
  return postJson(ADMIN_URL, { action: 'reject', requestId }, getSessionToken())
}

export async function adminUpdateUser({ userId, collections, status, features, plan }) {
  return postJson(ADMIN_URL, { action: 'updateUser', userId, collections, status, features, plan }, getSessionToken())
}

export async function adminDeleteUser({ userId }) {
  return postJson(ADMIN_URL, { action: 'deleteUser', userId }, getSessionToken())
}

// Rotate a member's code (Scaling Phase 1): the backend only keeps a sha256
// hash, so it mints a NEW code, stores its hash, and returns the new plaintext
// exactly once ({ user, code } — same shape as approve). The old code stops
// working immediately (and its sessions are revoked).
export async function adminRotate({ userId }) {
  return postJson(ADMIN_URL, { action: 'rotate', userId }, getSessionToken())
}

// ---- Admin AI settings (ADMIN-3.2, #304) ----
// Secure LLM provider-profile administration. Secrets are never returned by
// the backend — the list carries only a `secretMasked` tail + `secretSet`
// boolean, so the client can show "a secret is set" without ever receiving it.
export async function adminAiList() {
  return getJson(`${ADMIN_URL}?providers=1`, getSessionToken())
}

export async function adminAiCreate({ name, providerType, baseUrl, model, capabilities, apiKey }) {
  return postJson(ADMIN_URL, { action: 'aiCreate', name, providerType, baseUrl, model, capabilities, apiKey }, getSessionToken())
}

export async function adminAiUpdate({ profileId, name, providerType, baseUrl, model, capabilities, apiKey, fallbackProviderId }) {
  return postJson(ADMIN_URL, { action: 'aiUpdate', profileId, name, providerType, baseUrl, model, capabilities, apiKey, fallbackProviderId }, getSessionToken())
}

export async function adminAiDelete({ profileId }) {
  return postJson(ADMIN_URL, { action: 'aiDelete', profileId }, getSessionToken())
}

export async function adminAiTest({ profileId }) {
  return postJson(ADMIN_URL, { action: 'aiTest', profileId }, getSessionToken())
}

export async function adminAiActivate({ profileId }) {
  return postJson(ADMIN_URL, { action: 'aiActivate', profileId }, getSessionToken())
}

// ---- Admin AI dashboard (ADMIN-3.8, #310) ----
// AI provider health, cost tracking, fallback status and dry-run capability.

// Get the AI dashboard aggregates (7-day and 30-day usage stats, provider
// profiles, cooldown state).
export async function adminAiDashboard() {
  return getJson(`${ADMIN_URL}?aiDashboard=1`, getSessionToken())
}

// Run a dry-run evaluation of feedback items through the active provider.
// `limit` is the number of items to evaluate (1-50, default 10).
// `offset` is the pagination offset (default 0).
// Never mutates feedback state or creates GitHub issues.
export async function adminAiDryRun({ limit, offset } = {}) {
  return postJson(ADMIN_URL, { action: 'aiDryRun', limit, offset }, getSessionToken())
}

// ---- Collection insights (FEAT-9.4, #335) ----
// Generate AI-powered collection insights: completion suggestions,
// recommendations, and gap analysis. Data-minimization: only canonical
// metadata is sent to the model. "AI suggests; app decides" — output is
// advisory only. Results are cached server-side for 5 minutes.

// Generate collection insights for a given collection type and items.
// `collectionType` is the collection kind (e.g. 'records', 'books').
// `items` is an array of item objects with canonical fields (title, artist,
// genre, year, format, label).
// Returns { insights, cached } where insights contains completionSuggestions,
// recommendations, and gaps.
export async function adminAiInsights({ collectionType, items }) {
  return postJson(ADMIN_URL, { action: 'aiInsights', collectionType, items }, getSessionToken())
}
