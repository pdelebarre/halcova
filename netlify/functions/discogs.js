// Server-side Discogs proxy. Owns the single RUNOUT_DISCOGS_TOKEN (never
// shipped to the browser) and caches responses in a SHARED blob store so one
// user's lookup serves the next user. Normalization stays in src/api/discogs.js
// — this function only authenticates the caller and forwards raw Discogs JSON.

import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ADMIN_KEY, DEMO_USER, OWNER_ID, bearer, isDemoCode } from './_shared/auth'
import { findUserByCode } from './_shared/users'
import { createRateLimiter, rateLimitIdentity } from './_shared/rate-limit'
import { handleCover } from './_shared/cover'
import { readCache, writeCache } from './_shared/lookup-cache'

const DISCOGS_BASE = 'https://api.discogs.com'
// Discogs policy requires a User-Agent header on every request.
const USER_AGENT = 'RunoutRecordCollector/1.0 (records & books catalog)'

// One shared store for every user — that's the whole point: user A's lookup
// serves user B, so a second request never hits Discogs again. Part B: reads go
// DB-first (lookup_cache) when Postgres is configured and fall back to this
// Blob store; writes go to both (see _shared/lookup-cache.js). Covers stay
// Blobs-only. This constant still names the store for the cover action.
const CACHE_STORE = 'discogs-cache'

// Rate limiting (T5) guards the cache-MISS path only — the shared token's
// quota is protected whether or not the response cache has an entry.
const RATE_LIMITS_STORE = 'runout-rate-limits'
// Discogs' documented limit is ~60 requests/min per token, so the overall cap
// matches it; the per-user cap stops one account from exhausting it.
const DISCOGS_USER_LIMIT = Number(process.env.RUNOUT_DISCOGS_RATE_LIMIT) || 30
const DISCOGS_OVERALL_LIMIT = Number(process.env.RUNOUT_DISCOGS_OVERALL_RATE_LIMIT) || 60

const DAY = 24 * 60 * 60 * 1000
const TTL = {
  barcode: 30 * DAY, // scanned barcodes barely change
  q: 1 * DAY,        // text search drifts as new releases appear
  release: 30 * DAY, // release details are stable
}

const json = (statusCode, body, headers = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
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
  } else if (isDemoCode(code)) {
    // Lookups must keep working for the demo identity (T6) — never gate them.
    user = DEMO_USER
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
// `identity` is the caller's rate-limit identity (user id, or client IP for the
// demo); it's only used to throttle cache misses against the shared token.
async function fetchDiscogs(path, params, key, ttl, identity) {
  // No hardcoded fallback — a missing env is a server misconfiguration.
  const token = process.env.RUNOUT_DISCOGS_TOKEN
  if (!token) return json(500, { error: 'Discogs token not configured.', code: 'SERVER_NO_TOKEN' })

  // DB-first read-through (Part B): lookup_cache when Postgres is configured,
  // the legacy Blobs cache otherwise / on miss / on error. A failed read is a
  // miss — never fail a valid lookup.
  const cached = await readCache('discogs', key, ttl)
  if (cached) return json(200, cached)

  // Rate-limit the cache-MISS (provider) path (T5): per user and overall. The
  // overall cap protects the shared token/quota even across different users.
  if (identity) {
    const userRl = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'discogs:user', limit: DISCOGS_USER_LIMIT })(identity)
    if (userRl.limited) {
      return json(429, { error: 'Discogs rate limit hit — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(userRl.retryAfter) })
    }
  }
  const overallRl = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'discogs:overall', limit: DISCOGS_OVERALL_LIMIT })('all')
  if (overallRl.limited) {
    return json(429, { error: 'Discogs rate limit hit — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(overallRl.retryAfter) })
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
  // Writes through to both the DB and the legacy Blob store.
  await writeCache('discogs', key, data, ttl)
  return json(200, data)
}

export default async (req) => {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  // Cover images are loaded by <img> tags, which cannot send the access-code
  // Authorization header — so this action is deliberately PUBLIC (T6). It is
  // safe because handleCover only ever fetches small images from an explicit
  // host allowlist (https-only, size-capped). Every other action stays
  // authenticated below.
  if (action === 'cover') {
    return handleCover(url.searchParams, getStore(CACHE_STORE))
  }

  const { user, error } = await authorize(req)
  if (error) return error

  // Members/owner key provider limits by user id; the shared demo identity is
  // keyed by client IP so one demo visitor can't throttle every other.
  const identity = rateLimitIdentity(user, req)

  if (action === 'searchBarcode') {
    const barcode = cleanDigits(url.searchParams.get('barcode'))
    if (!barcode) return json(400, { error: 'Missing barcode.' })
    return fetchDiscogs('/database/search', { barcode, type: 'release' }, `barcode:${barcode}`, TTL.barcode, identity)
  }

  if (action === 'searchText') {
    // Cap the query so one huge string can't bloat the cache key/store or the
    // outbound request.
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 200)
    if (!q) return json(400, { error: 'Missing q.' })
    return fetchDiscogs('/database/search', { q, type: 'release' }, cacheKey('q', q.toLowerCase()), TTL.q, identity)
  }

  if (action === 'release') {
    const id = cleanDigits(url.searchParams.get('id'))
    if (!id) return json(400, { error: 'Missing id.' })
    return fetchDiscogs(`/releases/${id}`, {}, `release:${id}`, TTL.release, identity)
  }

  return json(400, { error: 'Unknown action.' })
}
