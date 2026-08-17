import { getSessionToken } from '../utils/session'

// Client for the community-reviews Netlify function. Mirrors
// src/api/collection.js conventions — same `Authorization: Bearer <token>`
// header, `{ error, code }` unwrap into a thrown Error on non-200, and a
// shared query-param helper. Reviews are public (the list + aggregate load
// without a session); writes (POST/DELETE) require a signed-in member.

const FN_BASE = '/.netlify/functions/reviews'

// The reviews API is shared by records and books — the function uses `kind` +
// `sourceId` (discogsId / googleBooksId) to pick which review thread to read
// or write. Every write authenticates with the signed-in user's session token.
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

// Mirror the collection/lookup clients: surface the server's error message
// AND its machine-readable `code` (e.g. PLAN_FORBIDDEN, RATE_LIMITED,
// NOT_FOUND, BAD_REQUEST) so callers can branch on the failure instead of
// string-matching. Code-less errors just carry the message.
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

// GET — a release's published reviews, its rating aggregate, and the caller's
// own review (null when not signed in or when the caller hasn't reviewed it).
// Missing fields map to safe defaults so views never have to defend against
// absent keys.
export async function listReviews(kind, sourceId) {
  const res = await fetch(fnUrl({ kind, sourceId }), { headers: authHeaders() })
  const data = await handle(res)
  return {
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
    aggregate: data.aggregate || { avg: 0, count: 0 },
    mine: data.mine || null,
  }
}

// POST — upsert the caller's review for a release (create or update). The
// server returns the saved review under `{ review }`. Bearer auth required.
export async function upsertReview({ kind, sourceId, rating, body }) {
  const res = await fetch(fnUrl(), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, sourceId, rating, body }),
  })
  return handle(res)
}

// DELETE — remove the caller's own review. Bearer auth required.
export async function deleteReview({ kind, sourceId, id }) {
  const res = await fetch(fnUrl({ kind, sourceId, id }), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handle(res)
}
