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
import { enforce } from './_shared/policy'
import { createRateLimiter, rateLimitIdentity, clientIp, retryAfterSeconds } from './_shared/rate-limit'
import { handleCover } from './_shared/cover'
import { readCache, writeCache } from './_shared/lookup-cache'
import { json, safeError } from './_shared/security'
import { anomalyScope, recordAnomaly } from './_shared/anomaly'

const GOOGLE_BASE = 'https://www.googleapis.com/books/v1'

// SEC-3.2 (#195): cap the provider response size before it's parsed or cached.
// A malicious/hostile provider response (or a degenerate result set) must not
// buffer unbounded bytes into the function or the shared cache. 1 MiB is well
// above any real Google Books response for this app's small queries.
const MAX_PROXY_BYTES = 1 * 1024 * 1024

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
// SEC-7.4 (#341): the cover action is PUBLIC (unauthenticated — loaded by
// <img> tags), so it gets its own per-IP limiter enforced BEFORE handleCover.
// Keyed on clientIp (Netlify x-nf-client-connection-ip, never spoofable XFF)
// so one source can't hammer the image proxy / upstream CDNs. A cover_burst
// per-IP anomaly fires when a single IP crosses a flood threshold.
const COVER_IP_LIMIT = Number(process.env.RUNOUT_COVER_IP_RATE_LIMIT) || 60
const COVER_BURST_THRESHOLD = Number(process.env.RUNOUT_COVER_BURST_THRESHOLD) || 20

// Blob keys are character/length restricted, and free-text user input can't be
// trusted to stay inside them — hash `q` and `detail` into a fixed-size hex
// digest so a weird value can never poison the store or crash a lookup.
// Digit-only codes (isbn) stay readable and are left unhashed.
const cacheKey = (prefix, input) => `${prefix}:${createHash('sha256').update(String(input)).digest('hex')}`

// Every request must carry a live server-managed session token — same contract
// as collection.js (SEC-EPIC-1, #176). SEC-7.1 (#338): authorization routes
// through the shared policy layer — `lookup:read` (any authenticated caller;
// the demo identity stays ungated for lookups, T6). Unknown/expired/revoked
// tokens 401, disabled accounts 403. Never logged.

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
      // SSRF guard (NIT M5, consistent with the cover proxy): never follow a
      // redirect. The upstream is the fixed GOOGLE_BASE; `redirect:'manual'`
      // makes a hostile 3xx surface as the raw response (isTransient is false
      // for 3xx, so it's returned as-is and rejected by the `!res.ok` check in
      // lookup()) — it can never be followed to an internal target.
      const res = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/json' } })
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
  } catch (err) {
    // A network error survived the retries — surface HTTP_ERROR.
    console.warn(`[books] lookup network error (key=${GOOGLE_API_KEY ? 'set' : 'MISSING'}): ${err?.message || err}`)
    return { error: json(502, { error: 'Google Books request failed.', code: 'HTTP_ERROR' }) }
  }
  if (!res.ok) {
    // Log the actual upstream status so a 403 (invalid/restricted key), a 3xx
    // (redirect not followed by the SSRF guard), or a 5xx is visible in the
    // function logs instead of surfacing as an opaque HTTP_ERROR.
    console.warn(`[books] Google responded ${res.status}${res.headers?.get('location') ? ` (location: ${res.headers.get('location')})` : ''} for ${lookupSpec.cacheKey} (key=${GOOGLE_API_KEY ? 'set' : 'MISSING'})`)
    if (res.status === 429) {
      // SEC-7.4 (#341): upstream provider 429 — surface a DISTINCT
      // `PROVIDER_RATE_LIMIT` code (server-side only) and pass through
      // Retry-After, preferring the upstream's own value when present, else our
      // fixed-window retry hint. `RATE_LIMIT` stays reserved for OUR throttling.
      const upstreamRetry = res.headers?.get?.('retry-after')
      const retryAfter = (upstreamRetry && Number(upstreamRetry) > 0)
        ? String(upstreamRetry)
        : String(retryAfterSeconds())
      return { error: json(429, { error: 'Google Books rate limit hit.', code: 'PROVIDER_RATE_LIMIT' }, { 'Retry-After': retryAfter }) }
    }
    return { error: json(502, { error: 'Google Books request failed.', code: 'HTTP_ERROR' }) }
  }

  // SEC-3.2 (#195): cap the provider body before parsing/caching.
  const raw = await res.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROXY_BYTES) {
    return { error: json(502, { error: 'Provider response too large.', code: 'HTTP_ERROR' }) }
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { error: json(502, { error: 'Provider returned an invalid response.', code: 'HTTP_ERROR' }) }
  }
  // Caching is best-effort — a failed write must not fail a successful lookup.
  // Writes through to both the DB and the legacy Blob store.
  await writeCache('books', lookupSpec.cacheKey, data, ttlMs)
  return { data }
}

export default async (req) => {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // Cover images are loaded by <img> tags, which cannot send the access-code
    // Authorization header — so this action is deliberately PUBLIC (T6). It is
    // safe because handleCover only ever fetches small images from an explicit
    // host allowlist (https-only, size-capped). Every other action stays
    // authenticated below. SEC-7.4 (#341): the public cover path is per-IP
    // rate-limited BEFORE handleCover so a flood can never reach the upstream.
    if (action === 'cover') {
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })
      const coverIp = clientIp(req)
      if (coverIp) {
        const coverLimiter = createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'cover:ip', limit: COVER_IP_LIMIT })
        const rl = await coverLimiter(coverIp)
        if (rl.limited) {
          // Abuse signal: a cover flood from one IP (NIT M5 — audit a hashed
          // scope, never the raw address).
          await recordAnomaly(getStore(RATE_LIMITS_STORE), `anom:cover:ip:${coverIp}`, { threshold: COVER_BURST_THRESHOLD, signal: 'cover_burst', scope: anomalyScope('anom:cover:ip', coverIp) })
          return json(429, { error: 'Too many cover requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
        }
      }
      // PUBLIC cover — always an unauthenticated handleCover; never flows into
      // the authenticated lookup path below (which needs `user`).
      return handleCover(url.searchParams, getStore(CACHE_STORE))
    }

    const { user, error } = await enforce(req, 'lookup:read')
    if (error) return error

    // Members/owner key provider limits by user id; the shared demo identity is
    // keyed by client IP so one demo visitor can't throttle every other.
    const identity = rateLimitIdentity(user, req)

    const lookupSpec = buildLookup(action, url.searchParams)
    if (!lookupSpec) return json(400, { error: 'Unknown action.' })

    const result = await lookup(lookupSpec, TTL_MS[action], identity)
    if (result.error) return result.error
    return json(200, result.data)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
