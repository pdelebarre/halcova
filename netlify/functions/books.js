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
import { rateLimitGuard, rateLimitIdentity, clientIp, retryAfterSeconds } from './_shared/rate-limit'
import { handleCover } from './_shared/cover'
import { readCache, writeCache, isNegativeCached, writeEmptyCache } from './_shared/lookup-cache'
import { lookupFetch } from './_shared/lookup-fetch'
import { readCooldownMs, recordProviderDown, PROVIDER_STATE_STORE } from './_shared/provider-state'
import { openlibrary } from './_shared/providers/openlibrary'
import { json, safeError } from './_shared/security'
import { isJsonContentType } from './_shared/providers/payload-guard'
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

// The outbound Google Books fetch + retry a couple of times on transient
// failures (429/5xx/network) lives in the shared `_shared/lookup-fetch.js`
// helper (T1, #284) — the SAME helper discogs.js uses, so the two lookup
// proxies can't drift. All requests go through `lookupFetch`, which:
//   - retries only 429/5xx/network failures (never 4xx/3xx),
//   - honors a bounded `Retry-After` + full-jitter exponential backoff,
//   - enforces a per-attempt timeout and an overall 8s deadline,
//   - always sets `redirect:'manual'` (SSRF control — never follows redirects).
// This function only fetches — the caller decides what gets cached (successful
// bodies only, below in lookup()).

// Serve from the shared cache when fresh; otherwise hit Google and cache the
// response. Only successful responses are cached — never errors. `identity` is
// the caller's rate-limit identity (user id, or client IP for the demo).
async function lookup(lookupSpec, ttlMs, identity) {
  // DB-first read-through (Part B): lookup_cache when Postgres is configured,
  // the legacy Blobs cache otherwise / on miss / on error. A failed read is a
  // miss — never fail a valid lookup.
  const cached = await readCache('books', lookupSpec.cacheKey, ttlMs)
  if (cached) {
    // RES-1.4 T4 (#291): a negative-cache sentinel ({empty:true}) is "no match
    // here", NOT a real result and NOT a failure. It must never be returned to
    // the client as a real payload — surface a HEALTHY-EMPTY envelope so the
    // lookup chain falls through to the fallback without spending another
    // provider call. (The chain normally skips the primary before we reach
    // here; this is defense-in-depth against a mixed store.)
    if (cached.empty === true) return { data: { items: [] } }
    return { data: cached }
  }

  // Rate-limit the cache-MISS (provider) path (T5): per user and overall. The
  // overall cap protects the shared quota even across different users.
  // SEC-7.4.x (#383): routed through rateLimitGuard so each 429 emits
  // `rate_limit.served` + the exhaust burst signal.
  if (identity) {
    const userRl = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'books:user',
      limit: BOOKS_USER_LIMIT,
      identity,
      anomalyStore: getStore(RATE_LIMITS_STORE),
    })
    if (userRl) return { error: userRl }
  }
  const overallRl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'books:overall',
    limit: BOOKS_OVERALL_LIMIT,
    identity: 'all',
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  if (overallRl) return { error: overallRl }

  let res
  try {
    // Shared T1 helper — retries transient 429/5xx/network, enforces the
    // overall 8s deadline, and always sets redirect:'manual'. On a persistent
    // retryable HTTP status it returns the last raw Response (mapped below by
    // res.status); on a persistent network failure / deadline it throws.
    res = await lookupFetch(lookupSpec.endpoint, {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    // A network error survived the retries (or the deadline fired) — surface
    // HTTP_ERROR.
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
  // SEC-6.3 (#217): reject a non-JSON content-type fail-closed (a hostile
  // upstream must not smuggle an HTML/image body past the JSON boundary).
  const contentType = res.headers?.get?.('content-type')
  if (!isJsonContentType(contentType)) {
    return { error: json(502, { error: 'Provider response is not JSON.', code: 'HTTP_ERROR' }) }
  }
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

// Books codes that are NOT a transient lookup outage — we deliberately do NOT
// spend the fallback provider on them, mirroring #288's MusicBrainz chain: a
// token/config problem (BAD_TOKEN / SERVER_NO_TOKEN) is an ops signal that
// shouldn't be masked by quietly routing everything to OpenLibrary, and a rate
// limit (PROVIDER_RATE_LIMIT / our RATE_LIMIT) must not pile extra load onto
// the fallback provider while Google Books is already throttled. (Google Books
// is tokenless, so BAD_TOKEN / SERVER_NO_TOKEN are effectively unreachable —
// they are listed for parity + future-proofing with the Discogs chain.)
const NO_FALLBACK_CODES = new Set([
  'BAD_TOKEN',
  'SERVER_NO_TOKEN',
  'PROVIDER_RATE_LIMIT',
  'RATE_LIMIT',
])

// RES-1.5 T5 (#290): when EVERY provider in the lookup chain genuinely fails
// (a real service outage — NOT a token/config or rate-limit code, which the
// NO_FALLBACK_CODES path returns as-is), the client must be able to tell
// "all providers are down" apart from "no match anywhere". We return a
// DISTINCT `ALL_PROVIDERS_FAILED` code (cf. HTTP_ERROR, which is reserved for
// single-provider failures that surface a real/healthy error path). The client
// throws `err.code === 'ALL_PROVIDERS_FAILED'` for this, distinct from
// NO_MATCH (a healthy-empty result set).
function allProvidersFailed() {
  return json(502, { error: 'All lookup providers are unavailable.', code: 'ALL_PROVIDERS_FAILED' })
}

// The top-level `source` marker on a winning search response: the primary sets
// `source:'google'`; an OpenLibrary fallback win sets `source:'openlibrary'`
// (already on each fallback hit). The client reads it to know the origin and,
// for a fallback win, to offer "matched via {source}" feedback.
const PRIMARY_SOURCE = 'google'
const FALLBACK_SOURCE = 'openlibrary'

// Primary-then-fallback lookup chain (RES-1.3 T3, #283; RES-1.4 T4, #291).
//
// Google Books is the PRIMARY books provider and stays first, and every result
// keeps the `{ items:[...] }` Google Books envelope. When the primary call
// ERRORS (a genuine service outage — 5xx / network / timeout, i.e. NOT an
// auth/token or rate-limit code), or returns a HEALTHY-EMPTY result set, we
// fall back to the tokenless OpenLibrary provider (netlify/functions/_shared/
// providers/openlibrary.js). The FIRST non-empty result set wins:
//   - Google non-empty  -> Google results with a top-level `source:'google'`
//     marker (no fallback call).
//   - Google error/empty + OpenLibrary non-empty -> OL results in the SAME
//     `{ items:[...] }` envelope with a top-level `source:'openlibrary'`,
//     each hit also marked `source:'openlibrary'` with `openLibraryId` set and
//     `googleBooksId` null (normalized by the adapter).
//   - Both healthy-empty   -> 200 `{ items: [] }` (client NO_MATCH).
//   - Both errored (outage) -> 502 `{ code:'ALL_PROVIDERS_FAILED' }` (client
//     surfaces "all providers unavailable", distinct from NO_MATCH).
//
// RES-1.4 T4 (#291) — negative cache + circuit-breaker cooldown. Two
// SKIP-PRIMARY signals are checked BEFORE any provider call:
//   - Circuit-breaker cooldown (provider-state store): when Google was
//     recently recorded down (genuine 5xx/network outage), we skip it for
//     ~60s and go straight to the fallback, then retry after the cooldown.
//   - Negative cache: when this specific key is negative-cached as
//     HEALTHY-EMPTY ({empty:true} sentinel), we skip the empty provider call
//     and fall through to the fallback — "no match HERE" is not a failure.
// In BOTH skip cases the fallback's first non-empty result wins (marked with
// `source:'openlibrary'`); if the fallback is also empty/errored we return what
// the primary would have produced: healthy-empty (`{ data: { items: [] } }`)
// for a negative-cached key, or ALL_PROVIDERS_FAILED for a cooldown (a
// provider in cooldown is down, so all providers are unavailable).
//
// 429 / NO_FALLBACK tension (explicitly resolved here, #291): NO_FALLBACK_CODES
// (BAD_TOKEN / SERVER_NO_TOKEN / PROVIDER_RATE_LIMIT / RATE_LIMIT) still
// short-circuit WITHOUT falling back AND WITHOUT recording cooldown — an
// operator/token problem or an upstream/OUR rate limit is NOT a "skipped down
// provider", so it neither spends the fallback provider nor arms the breaker.
// Only a genuine provider-down outcome (5xx / network / timeout -> HTTP_ERROR
// by a non-NO_FALLBACK path) calls recordProviderDown. Provider-outage state
// lives in the SEPARATE provider-state store, NEVER in the 30d lookup_cache (no
// poisoning risk).
//
// `result` is the { data } | { error: Response } shape from lookup(). We read
// the primary body defensively to decide on healthy-empty vs error + code.
async function lookupWithFallback({
  providerStateStore,
  provider,
  key,
  action,
  lookupSpec,
  ttlMs,
  identity,
  fallback,
}) {
  // Skip-primary signal #1: circuit breaker (down provider in cooldown).
  const cooldownMs = await readCooldownMs(providerStateStore, provider)
  // Skip-primary signal #2: this key is negative-cached as healthy-empty.
  const negativeEmpty = cooldownMs <= 0 && (await isNegativeCached(provider, key, action))

  if (cooldownMs > 0 || negativeEmpty) {
    // Skip the primary ENTIRELY (no provider hit) — either it is in cooldown
    // (down) or this specific key is negative-cached as empty ("no match here").
    const fb = await fallback()
    if (fb && Array.isArray(fb.items) && fb.items.length > 0) {
      // Fallback wins — mark the winning source on top of the envelope.
      return { data: { source: FALLBACK_SOURCE, ...fb } }
    }
    // Fallback also empty/errored: mirror what the primary would have returned.
    // A negative-cached key -> healthy-empty primary -> empty envelope. A
    // provider in cooldown -> down primary -> all providers failed.
    return negativeEmpty
      ? { data: { items: [] } }
      : { error: allProvidersFailed() }
  }

  const result = await lookup(lookupSpec, ttlMs, identity)

  // A healthy, non-empty primary result wins — no fallback call. Mark source.
  if (result.data && Array.isArray(result.data.items) && result.data.items.length > 0) {
    return { data: { source: PRIMARY_SOURCE, ...result.data } }
  }

  // An error whose code is an authoritative outcome (auth/config/rate-limit)
  // is returned as-is — never mask it by falling back, never arm the breaker.
  if (result.error) {
    let code = null
    try {
      const body = await result.error.clone().json()
      code = body?.code
    } catch {
      code = null
    }
    if (code && NO_FALLBACK_CODES.has(code)) return result
  }

  // Fallback fires on a Google service error OR a healthy-empty result set.
  const healthyEmpty = !result.error && result.data && Array.isArray(result.data.items) && result.data.items.length === 0
  // A genuine provider-down outcome (5xx/network -> HTTP_ERROR by a
  // non-NO_FALLBACK path): arm the circuit breaker (~60s). Outage state never
  // goes into lookup_cache — only provider-state.
  if (result.error) await recordProviderDown(providerStateStore, provider)
  // A healthy-empty result is negative-cached so we stop re-spending the empty
  // provider call within the short empty TTL (isbn 1d / text 6h). Only a
  // HEALTHY empty is cached — never an error body.
  if (healthyEmpty) await writeEmptyCache(provider, key, action)

  const fb = await fallback()
  if (fb && Array.isArray(fb.items) && fb.items.length > 0) {
    // Fallback wins — mark the winning source on top of the envelope.
    return { data: { source: FALLBACK_SOURCE, ...fb } }
  }
  // Both the primary and the fallback came up short. RES-1.5 T5 (#290):
  // distinguish a genuine all-provider outage (-> ALL_PROVIDERS_FAILED) from
  // a healthy-empty across all (-> 200 [] = NO_MATCH), instead of returning
  // the primary's original error verbatim.
  if (result.error) return { error: allProvidersFailed() }
  return { data: { items: [] } }
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
        // SEC-7.4.x (#383): the public cover limiter routes through
        // rateLimitGuard so each 429 emits `rate_limit.served` + the exhaust
        // burst signal. Per-IP, so its burstScope is an anonymous anomalyScope
        // hash (the raw IP never becomes a burst scope). The distinct
        // `cover_burst` anomaly below (recordAnomaly) is preserved alongside.
        const rl = await rateLimitGuard({
          store: getStore(RATE_LIMITS_STORE),
          scope: 'cover:ip',
          limit: COVER_IP_LIMIT,
          identity: coverIp,
          anomalyStore: getStore(RATE_LIMITS_STORE),
          burstScope: anomalyScope('rlx:cover:ip', coverIp),
        })
        if (rl) {
          // Abuse signal: a cover flood from one IP (NIT M5 — audit a hashed
          // scope, never the raw address).
          await recordAnomaly(getStore(RATE_LIMITS_STORE), `anom:cover:ip:${coverIp}`, { threshold: COVER_BURST_THRESHOLD, signal: 'cover_burst', scope: anomalyScope('anom:cover:ip', coverIp) })
          return rl
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

    // RES-1.3 T3 (#283): the search actions fall back to the tokenless
    // OpenLibrary provider on a Google service error or healthy-empty result.
    // `detail` stays Google-only — a fallback hit has no googleBooksId, so the
    // frontend's BookDetail googleBooksId guard never asks for detail here.
    // RES-1.4 T4 (#291): skip the primary when Google is in circuit-breaker
    // cooldown or this key is negative-cached as empty.
    let result
    if (action === 'searchBarcode') {
      result = await lookupWithFallback({
        providerStateStore: getStore(PROVIDER_STATE_STORE),
        provider: 'books',
        key: lookupSpec.cacheKey,
        action,
        lookupSpec,
        ttlMs: TTL_MS[action],
        identity,
        fallback: () => openlibrary.searchBarcode(url.searchParams.get('isbn') || ''),
      })
    } else if (action === 'searchText') {
      result = await lookupWithFallback({
        providerStateStore: getStore(PROVIDER_STATE_STORE),
        provider: 'books',
        key: lookupSpec.cacheKey,
        action,
        lookupSpec,
        ttlMs: TTL_MS[action],
        identity,
        fallback: () => openlibrary.searchText(url.searchParams.get('q') || ''),
      })
    } else {
      result = await lookup(lookupSpec, TTL_MS[action], identity)
    }
    if (result.error) return result.error
    return json(200, result.data)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
