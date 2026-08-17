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
import { resolveSession } from './_shared/session-auth'
import { createRateLimiter, rateLimitIdentity } from './_shared/rate-limit'
import { handleCover } from './_shared/cover'
import { readCache, writeCache } from './_shared/lookup-cache'

const GOOGLE_BASE = 'https://www.googleapis.com/books/v1'

// Optional server-side API key. When set, it's appended to every outbound
// Google Books request so quota is attributed to the key (a per-project quota)
// instead of Netlify's shared egress IP — keyless requests are quota'd per-IP
// and get 429'd constantly because that per-IP quota is shared across tenants.
// The key NEVER reaches the browser: it only ever appears in this function's
// outbound fetch and is never logged.
const GOOGLE_API_KEY = process.env.GOOGLE_BOOKS_API_KEY
// Warn once per warm instance about keyless mode — deliberately degrade (books
// previously had no key), don't hard-error like Discogs' SERVER_NO_TOKEN.
let warnedKeyless = false

// One shared store for ALL users: user A's lookup serves user B. Keys are
// namespaced per action and hold { ts, data } so we can enforce a TTL (Netlify
// Blobs has no native expiry). Part B: reads go DB-first (lookup_cache) when
// Postgres is configured and fall back to this Blob store; writes go to both
// (see _shared/lookup-cache.js). Covers stay Blobs-only.
const CACHE_STORE = 'books-cache'

const DAY_MS = 24 * 60 * 60 * 1000
const TTL_MS = {
  searchBarcode: 30 * DAY_MS, // ISBN lookups rarely change
  searchText: DAY_MS, // text results churn more
  detail: 30 * DAY_MS,
}

// Rate limiting (T5) guards the cache-MISS path only — the shared quota is
// protected whether or not the response cache has an entry.
const RATE_LIMITS_STORE = 'runout-rate-limits'
const BOOKS_USER_LIMIT = Number(process.env.RUNOUT_BOOKS_RATE_LIMIT) || 60
const BOOKS_OVERALL_LIMIT = Number(process.env.RUNOUT_BOOKS_OVERALL_RATE_LIMIT) || 300

const json = (statusCode, body, headers = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
})

// Blob keys are character/length restricted, and free-text user input can't be
// trusted to stay inside them — hash `q` and `detail` into a fixed-size hex
// digest so a weird value can never poison the store or crash a lookup.
// Digit-only codes (isbn) stay readable and are left unhashed.
const cacheKey = (prefix, input) => `${prefix}:${createHash('sha256').update(String(input)).digest('hex')}`

// Every request must carry a live server-managed session token — same contract
// as collection.js (SEC-EPIC-1, #176): resolveSession validates it and resolves
// the owner / demo / member identity (the demo stays ungated for lookups, T6).
// Unknown/expired/revoked tokens 401, disabled accounts 403. Never logged.
async function authorize(req) {
  return resolveSession(req)
}

function googleUrl(path, params = {}) {
  const url = new URL(GOOGLE_BASE + path)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  if (GOOGLE_API_KEY) {
    url.searchParams.set('key', GOOGLE_API_KEY)
  } else if (!warnedKeyless) {
    warnedKeyless = true
    console.warn('GOOGLE_BOOKS_API_KEY not set — keyless Google Books requests are subject to per-IP rate limits (429). Set the key in Netlify env to fix rate limiting.')
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

// Transient failures (HTTP 429/5xx, or a network error) are retried a couple of
// times with a short delay before RATE_LIMIT/HTTP_ERROR is surfaced. The loop
// stays small (default: one retry ≈ 2 attempts total) so it fits comfortably
// inside the Netlify function timeout (default 10s). This helper only fetches —
// the caller decides what gets cached (successful bodies only).
export async function fetchGoogleWithRetry(url, { retries = 1, delayMs = 800 } = {}) {
  const isTransient = (status) => status === 429 || status >= 500
  let lastResponse
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      lastResponse = res
      lastError = null
      // Success or a non-transient failure is final; 429/5xx gets retried.
      if (res.ok || !isTransient(res.status)) return res
    } catch (err) {
      lastError = err
      // Network error — retry if attempts remain, otherwise rethrow below.
    }
  }

  if (lastError) throw lastError
  return lastResponse
}

// Serve from the shared cache when fresh; otherwise hit Google and cache the
// response. Only successful responses are cached — never errors. `identity` is
// the caller's rate-limit identity (user id, or client IP for the demo).
async function lookup(lookupSpec, ttlMs, identity) {
  // DB-first read-through (Part B): lookup_cache when Postgres is configured,
  // the legacy Blobs cache otherwise / on miss / on error. A failed read is a
  // miss — never fail a valid lookup.
  const cached = await readCache('books', lookupSpec.cacheKey, ttlMs)
  if (cached) return { data: cached }

  // Rate-limit the cache-MISS (provider) path (T5): per user and overall. The
  // overall cap protects the shared quota even across different users.
  if (identity) {
    const userRl = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'books:user', limit: BOOKS_USER_LIMIT })(identity)
    if (userRl.limited) {
      return { error: json(429, { error: 'Google Books rate limit hit.', code: 'RATE_LIMIT' }, { 'Retry-After': String(userRl.retryAfter) }) }
    }
  }
  const overallRl = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'books:overall', limit: BOOKS_OVERALL_LIMIT })('all')
  if (overallRl.limited) {
    return { error: json(429, { error: 'Google Books rate limit hit.', code: 'RATE_LIMIT' }, { 'Retry-After': String(overallRl.retryAfter) }) }
  }

  let res
  try {
    res = await fetchGoogleWithRetry(lookupSpec.endpoint)
  } catch {
    // A network error survived the retries — surface HTTP_ERROR.
    return { error: json(502, { error: 'Google Books request failed.', code: 'HTTP_ERROR' }) }
  }
  if (!res.ok) {
    if (res.status === 429) {
      return { error: json(429, { error: 'Google Books rate limit hit.', code: 'RATE_LIMIT' }) }
    }
    return { error: json(502, { error: 'Google Books request failed.', code: 'HTTP_ERROR' }) }
  }

  const data = await res.json()
  // Caching is best-effort — a failed write must not fail a successful lookup.
  // Writes through to both the DB and the legacy Blob store.
  await writeCache('books', lookupSpec.cacheKey, data, ttlMs)
  return { data }
}

export default async (req) => {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  // Cover images are loaded by <img> tags, which cannot send the access-code
  // Authorization header — so this action is deliberately PUBLIC (T6). It is
  // safe because handleCover only ever fetches small images from an explicit
  // host allowlist (https-only, size-capped). Every other action stays
  // authenticated below.
  if (action === 'cover') {
    if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })
    return handleCover(url.searchParams, getStore(CACHE_STORE))
  }

  const { user, error } = await authorize(req)
  if (error) return error

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  const lookupSpec = buildLookup(action, url.searchParams)
  if (!lookupSpec) return json(400, { error: 'Unknown action.' })

  // Members/owner key provider limits by user id; the shared demo identity is
  // keyed by client IP so one demo visitor can't throttle every other.
  const identity = rateLimitIdentity(user, req)

  const result = await lookup(lookupSpec, TTL_MS[action], identity)
  if (result.error) return result.error
  return json(200, result.data)
}
