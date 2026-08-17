import { getSessionToken } from '../utils/session'

// Client for the feedback Netlify function (in-app suggestions + bug reports,
// epic #74, T4 — issue #77). Mirrors src/api/collection.js / src/api/reviews.js
// conventions: `Authorization: Bearer <sessionToken>` from the session, and the
// server's `{ error, code }` unwrapped into a thrown Error on non-200.
//
// Members submit (POST); the owner's admin session — also carried by the
// session token — drives the inbox (GET / PATCH / DELETE).
//
// Graceful-failure contract (no dark screen): every call fails fast with a
// NO_TOKEN-coded Error when there is no signed-in session token (never a raw
// network 401), and non-JSON / empty / non-200 responses degrade to a coded
// Error (or `undefined` for a bodyless 204) instead of an uncaught throw.

const FN_BASE = '/.netlify/functions/feedback'

function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function fnUrl(extra = {}) {
  const url = new URL(FN_BASE, window.location.origin)
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v)
  })
  return url.pathname + url.search
}

// Not-signed-in guard: throw a coded Error BEFORE any network call so the UI
// can show a friendly "sign in" state instead of a thrown 401 or a dark screen.
function noTokenError() {
  const err = new Error('Sign in to send feedback.')
  err.code = 'NO_TOKEN'
  return err
}

// Mirror the collection/reviews/lookup clients: surface the server's error
// message AND its machine-readable `code` (e.g. RATE_LIMITED, INVALID_TYPE,
// DEMO_READONLY, MESSAGE_TOO_LONG) so callers can branch on the failure.
// Every thrown Error carries a `code` — `HTTP_ERROR` when the server didn't
// provide one. A bodyless 204 (DELETE) resolves to `undefined` rather than
// throwing on `res.json()`.
async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    let code
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
      if (body?.code) code = body.code
    } catch { /* non-JSON error body — keep the generic message */ }
    const err = new Error(msg)
    err.code = code || 'HTTP_ERROR'
    throw err
  }
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

// POST — a member submits a suggestion or bug report. The author is derived
// server-side from the session; this body only carries the submission fields.
// Session token required. -> 201 { id, … }
export async function submitFeedback({ type, category, message, url, appVersion } = {}) {
  if (!getSessionToken()) throw noTokenError()
  const res = await fetch(fnUrl(), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, category, message, url, appVersion }),
  })
  return handle(res)
}

// GET — the admin inbox, newest first, with optional status/type filters.
// Admin session required. -> { items } (mapped to [] when absent).
export async function listFeedback({ status, type } = {}) {
  if (!getSessionToken()) throw noTokenError()
  const res = await fetch(fnUrl({ status, type }), { headers: authHeaders() })
  const data = await handle(res)
  return Array.isArray(data?.items) ? data.items : []
}

// PATCH — admin triage: update `status` and/or `adminNote`. Only the fields
// the caller provides are sent. Admin session required. -> the updated item.
export async function updateFeedback({ id, status, adminNote } = {}) {
  if (!getSessionToken()) throw noTokenError()
  const body = { id }
  if (status !== undefined) body.status = status
  if (adminNote !== undefined) body.adminNote = adminNote
  const res = await fetch(fnUrl(), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

// DELETE — admin removes a feedback entry. Admin session required. -> 204
// (resolves to `undefined`; unknown id rejects with the server's 404).
export async function deleteFeedback(id) {
  if (!getSessionToken()) throw noTokenError()
  const res = await fetch(fnUrl({ id }), { method: 'DELETE', headers: authHeaders() })
  return handle(res)
}
