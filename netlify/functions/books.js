// Books lookups are centralized server-side so identical requests from
// different users are served from a SHARED cache instead of hitting the
// Google Books API repeatedly (and to protect the shared quota).
//
// This function only proxies + caches. It returns the RAW Google Books JSON
// payload; normalization into the app's item shape stays in src/api/books.js.
//
// Actions (query params, not arbitrary path forwarding):
//   GET ?action=searchBarcode&isbn=<digits> -> /volumes?q=isbn:<digits>&country=US
//   GET ?action=searchText&q=<query>        -> /volumes?q=<query>&country=US&maxResults=20
//   GET ?action=detail&id=<volumeId>        -> /volumes/<volumeId>?country=US
// Unknown/missing action -> 400 { error: 'Unknown action.' }

import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ADMIN_KEY, OWNER_ID, bearer } from './_shared/auth'
import { findUserByCode } from './_shared/users'

const GOOGLE_BASE = 'https://www.googleapis.com/books/v1'

// One shared store for ALL users: user A's lookup serves user B. Keys are
// namespaced per action and hold { ts, data } so we can enforce a TTL (Netlify
// Blobs has no native expiry).
const CACHE_STORE = 'books-cache'

const DAY_MS = 24 * 60 * 60 * 1000
const TTL_MS = {
  searchBarcode: 30 * DAY_MS, // ISBN lookups rarely change
  searchText: DAY_MS, // text results churn more
  detail: 30 * DAY_MS,
}

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

// Blob keys are character/length restricted, and free-text user input can't be
// trusted to stay inside them — hash `q` and `detail` into a fixed-size hex
// digest so a weird value can never poison the store or crash a lookup.
// Digit-only codes (isbn) stay readable and are left unhashed.
const cacheKey = (prefix, input) => `${prefix}:${createHash('sha256').update(String(input)).digest('hex')}`

// Every request must carry the caller's access code — same contract as
// collection.js: the admin key counts as the owner, members are resolved by
// their code (unknown -> 401, disabled -> 403). The code itself is never
// logged or echoed.
async function authorize(req) {
  const code = bearer(req)
  if (!code) return { error: json(401, { error: 'Sign in with your access code.' }) }

  let user
  if (code === ADMIN_KEY) {
    user = { id: OWNER_ID, role: 'admin', status: 'active' }
  } else {
    user = await findUserByCode(code)
  }
  if (!user) return { error: json(401, { error: "That access code isn't recognized." }) }
  if (user.status !== 'active') return { error: json(403, { error: 'This account is disabled.' }) }
  return { user }
}

function googleUrl(path, params = {}) {
  const url = new URL(GOOGLE_BASE + path)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  return url.toString()
}

// Map an app-level action to the Google Books request it stands for. Returns
// null for unknown actions (or a valid action missing its parameter).
function buildLookup(action, searchParams) {
  if (action === 'searchBarcode') {
    const isbn = (searchParams.get('isbn') || '').replace(/[^0-9Xx]/g, '')
    if (!isbn) return null
    return {
      endpoint: googleUrl('/volumes', { q: `isbn:${isbn}`, country: 'US' }),
      cacheKey: `isbn:${isbn}`,
    }
  }
  if (action === 'searchText') {
    const q = (searchParams.get('q') || '').trim().slice(0, 200)
    if (!q) return null
    return {
      endpoint: googleUrl('/volumes', { q, country: 'US', maxResults: 20 }),
      cacheKey: cacheKey('q', q.toLowerCase()),
    }
  }
  if (action === 'detail') {
    const id = (searchParams.get('id') || '').trim().slice(0, 200)
    if (!id) return null
    return {
      endpoint: googleUrl(`/volumes/${encodeURIComponent(id)}`, { country: 'US' }),
      cacheKey: cacheKey('detail', id),
    }
  }
  return null
}

// Serve from the shared cache when fresh; otherwise hit Google and cache the
// response. Only successful responses are cached — never errors.
async function lookup(store, lookupSpec, ttlMs) {
  // A failed cache read is a cache miss — never fail a valid lookup.
  let cached
  try {
    cached = await store.get(lookupSpec.cacheKey, { type: 'json' })
  } catch {
    cached = null
  }
  if (cached?.data && cached?.ts && Date.now() - cached.ts < ttlMs) {
    return { data: cached.data }
  }

  const res = await fetch(lookupSpec.endpoint, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    if (res.status === 429) {
      return { error: json(429, { error: 'Google Books rate limit hit.', code: 'RATE_LIMIT' }) }
    }
    return { error: json(502, { error: 'Google Books request failed.', code: 'HTTP_ERROR' }) }
  }

  const data = await res.json()
  try {
    await store.setJSON(lookupSpec.cacheKey, { ts: Date.now(), data })
  } catch {
    // Caching is best-effort — a failed write must not fail a successful lookup.
  }
  return { data }
}

export default async (req) => {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  const { error } = await authorize(req)
  if (error) return error

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  const lookupSpec = buildLookup(action, url.searchParams)
  if (!lookupSpec) return json(400, { error: 'Unknown action.' })

  const store = getStore(CACHE_STORE)
  const result = await lookup(store, lookupSpec, TTL_MS[action])
  if (result.error) return result.error
  return json(200, result.data)
}
