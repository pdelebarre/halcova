import { getSessionToken } from '../utils/session'

const FN_BASE = '/.netlify/functions/collection'

// The collection API is shared by records and books — the Netlify function
// uses this to pick which blob store to read/write. Every call authenticates
// with the signed-in user's session token (SEC-EPIC-1, #176).
function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function fnUrl(collection, extra = {}) {
  const url = new URL(FN_BASE, window.location.origin)
  url.searchParams.set('collection', collection || 'records')
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v)
  })
  return url.pathname + url.search
}

// Mirror the lookup clients (discogs.js / books.js): surface the server's
// error message AND its machine-readable `code` (e.g. PLAN_LIMIT,
// DEMO_READONLY) so callers can branch on the failure instead of string-
// matching. Code-less errors just carry the message.
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

export async function listItems(collection = 'records') {
  const res = await fetch(fnUrl(collection), { headers: authHeaders() })
  const data = await handle(res)
  return data.items || []
}

export async function addItem(item, collection = 'records') {
  const res = await fetch(fnUrl(collection), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })
  return handle(res)
}

export async function updateItem(id, patch, collection = 'records') {
  const res = await fetch(fnUrl(collection, { id }), {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return handle(res)
}

export async function deleteItem(id, collection = 'records') {
  const res = await fetch(fnUrl(collection, { id }), { method: 'DELETE', headers: authHeaders() })
  return handle(res)
}
