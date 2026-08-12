// Server-side Discogs proxy. Owns the single RUNOUT_DISCOGS_TOKEN (never
// shipped to the browser) and caches responses in a SHARED blob store so one
// user's lookup serves the next user. Normalization stays in src/api/discogs.js
// — this function only authenticates the caller and forwards raw Discogs JSON.

import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ADMIN_KEY, OWNER_ID, bearer } from './_shared/auth'
import { findUserByCode } from './_shared/users'

const DISCOGS_BASE = 'https://api.discogs.com'
// Discogs policy requires a User-Agent header on every request.
const USER_AGENT = 'RunoutRecordCollector/1.0 (records & books catalog)'

// One shared store for every user — that's the whole point: user A's lookup
// serves user B, so a second request never hits Discogs again.
const CACHE_STORE = 'discogs-cache'

const DAY = 24 * 60 * 60 * 1000
const TTL = {
  barcode: 30 * DAY, // scanned barcodes barely change
  q: 1 * DAY,        // text search drifts as new releases appear
  release: 30 * DAY, // release details are stable
}

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

// Same shape as collection.js: every request carries the caller's access code.
// The owner uses the admin key; members use the code the admin generated.
// Unknown codes 401, disabled accounts 403.
async function authorize(req) {
  const code = bearer(req)
  if (!code) return { error: json(401, { error: 'Sign in with your access code.' }) }

  let user
  if (code === ADMIN_KEY) {
    user = { id: OWNER_ID, role: 'admin', status: 'active', collections: { records: true, books: true } }
  } else {
    user = await findUserByCode(code)
  }
  if (!user) return { error: json(401, { error: "That access code isn't recognized." }) }
  if (user.status !== 'active') return { error: json(403, { error: 'This account is disabled.' }) }
  return { user }
}

// Barcodes/ids are digits (keep X/x for UPC check digits) — also keeps blob
// keys clean and avoids path weirdness in the release id.
const cleanDigits = (value) => String(value || '').replace(/[^0-9Xx]/g, '')

// Blob keys are character/length restricted, and free-text user input can't be
// trusted to stay inside them — hash `q` into a fixed-size hex digest. Digit-only
// codes (barcode/release) are already sanitized by cleanDigits and stay readable.
const cacheKey = (prefix, input) => `${prefix}:${createHash('sha256').update(String(input)).digest('hex')}`

// Forward one action to Discogs with a cache read on top. The token is sent in
// an Authorization header (`Discogs token=…`) rather than a ?token= query param
// — query strings can be captured by egress telemetry. It never leaves the server.
async function fetchDiscogs(path, params, key, ttl) {
  // No hardcoded fallback — a missing env is a server misconfiguration.
  const token = process.env.RUNOUT_DISCOGS_TOKEN
  if (!token) return json(500, { error: 'Discogs token not configured.', code: 'SERVER_NO_TOKEN' })

  const store = getStore(CACHE_STORE)

  // A failed cache read is a cache miss — never fail a valid lookup.
  let cached
  try {
    cached = await store.get(key, { type: 'json' })
  } catch {
    cached = null
  }
  if (cached && cached.data !== undefined && Date.now() - cached.ts < ttl) {
    return json(200, cached.data)
  }

  const url = new URL(DISCOGS_BASE + path)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })

  let data
  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Discogs token=${token}`,
      },
    })
    // Only successful responses get cached — never error bodies.
    if (!res.ok) {
      if (res.status === 401) return json(502, { error: 'Discogs token rejected.', code: 'BAD_TOKEN' })
      if (res.status === 429) return json(429, { error: 'Discogs rate limit hit — try again shortly.', code: 'RATE_LIMIT' })
      return json(502, { error: 'Discogs request failed.', code: 'HTTP_ERROR' })
    }
    data = await res.json()
  } catch {
    return json(502, { error: 'Discogs request failed.', code: 'HTTP_ERROR' })
  }

  // Caching is best-effort — a failed write must not fail a successful lookup.
  try {
    await store.setJSON(key, { ts: Date.now(), data })
  } catch {
    // ignore
  }
  return json(200, data)
}

export default async (req) => {
  const { error } = await authorize(req)
  if (error) return error

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'searchBarcode') {
    const barcode = cleanDigits(url.searchParams.get('barcode'))
    if (!barcode) return json(400, { error: 'Missing barcode.' })
    return fetchDiscogs('/database/search', { barcode, type: 'release' }, `barcode:${barcode}`, TTL.barcode)
  }

  if (action === 'searchText') {
    // Cap the query so one huge string can't bloat the cache key/store or the
    // outbound request.
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 200)
    if (!q) return json(400, { error: 'Missing q.' })
    return fetchDiscogs('/database/search', { q, type: 'release' }, cacheKey('q', q.toLowerCase()), TTL.q)
  }

  if (action === 'release') {
    const id = cleanDigits(url.searchParams.get('id'))
    if (!id) return json(400, { error: 'Missing id.' })
    return fetchDiscogs(`/releases/${id}`, {}, `release:${id}`, TTL.release)
  }

  return json(400, { error: 'Unknown action.' })
}
