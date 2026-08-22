import { getSessionToken } from '../utils/session'

// Client for the profiles Netlify function (FEAT-8.1, #326).
// Mirrors src/api/reviews.js conventions — same `Authorization: Bearer <token>`
// header, `{ error, code }` unwrap into a thrown Error on non-200.

const FN_BASE = '/.netlify/functions/profiles'

function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    let code
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
      if (body?.code) code = body.code
    } catch { /* ignore */ }
    const err = new Error(msg)
    if (code) err.code = code
    throw err
  }
  return res.json()
}

// GET /profiles/public/:shareId — public profile page
export async function getPublicProfile(shareId) {
  const res = await fetch(`${FN_BASE}/public/${encodeURIComponent(shareId)}`)
  const data = await handle(res)
  return data.profile || null
}

// GET /profiles/public/:shareId/collections?kind=<kind> — public collection items
export async function getPublicCollection(shareId, kind) {
  const params = kind ? `?kind=${encodeURIComponent(kind)}` : ''
  const res = await fetch(`${FN_BASE}/public/${encodeURIComponent(shareId)}/collections${params}`)
  const data = await handle(res)
  return Array.isArray(data.items) ? data.items : []
}

// GET /profiles/me — own profile
export async function getMyProfile() {
  const res = await fetch(`${FN_BASE}/me`, { headers: authHeaders() })
  const data = await handle(res)
  return data.profile || null
}

// PUT /profiles/me — upsert own profile
export async function upsertProfile(profile) {
  const res = await fetch(`${FN_BASE}/me`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  const data = await handle(res)
  return data.profile
}

// DELETE /profiles/me — revoke public access
export async function deleteProfile() {
  const res = await fetch(`${FN_BASE}/me`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return true
}