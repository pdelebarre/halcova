// Server-side Discogs proxy. Owns the single RUNOUT_DISCOGS_TOKEN (never
// shipped to the browser) and caches responses in a SHARED blob store so one
// user's lookup serves the next user. Normalization stays in src/api/discogs.js
// — this function only authenticates the caller and forwards raw Discogs JSON.

import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { enforce } from './_shared/policy'
import { rateLimitGuard, rateLimitIdentity, clientIp, retryAfterSeconds } from './_shared/rate-limit'
import { handleCover } from './_shared/cover'
import { readCache, writeCache, isNegativeCached, writeEmptyCache } from './_shared/lookup-cache'
import { lookupFetch } from './_shared/lookup-fetch'
import { readCooldownMs, recordProviderDown, PROVIDER_STATE_STORE } from './_shared/provider-state'
import { json, safeError } from './_shared/security'
import { musicbrainz } from './_shared/providers/musicbrainz'
import { anomalyScope, recordAnomaly } from './_shared/anomaly'

const DISCOGS_BASE = 'https://api.discogs.com'
// Discogs policy requires a User-Agent header on every request.
const USER_AGENT = 'RunoutRecordCollector/1.0 (records & books catalog)'

// SEC-3.2 (#195): cap the provider response size before it's parsed or cached.
// A hostile/degenerate Discogs response must not buffer unbounded bytes into
// the function or the shared cache. 2 MiB is above any real Discogs search/
// release payload this app requests.
const MAX_PROXY_BYTES = 2 * 1024 * 1024

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
// SEC-7.4 (#341): the cover action is PUBLIC (unauthenticated), per-IP limited
// BEFORE handleCover (see books.js for the same block).
const COVER_IP_LIMIT = Number(process.env.RUNOUT_COVER_IP_RATE_LIMIT) || 60
const COVER_BURST_THRESHOLD = Number(process.env.RUNOUT_COVER_BURST_THRESHOLD) || 20

const DAY = 24 * 60 * 60 * 1000
const TTL = {
  barcode: 30 * DAY, // scanned barcodes barely change
  q: 1 * DAY,        // text search drifts as new releases appear
  release: 30 * DAY, // release details are stable
}

// Same contract as collection.js (SEC-EPIC-1, #176): every request carries a
// live server-managed session token. SEC-7.1 (#338): authorization now routes
// through the shared policy layer — `lookup:read` (any authenticated caller;
// the demo identity stays ungated for lookups, T6). Unknown/expired/revoked
// tokens 401, disabled accounts 403 — same as resolveSession before.

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
  if (cached) {
    // RES-1.4 T4 (#291): a negative-cache sentinel ({empty:true}) is "no match
    // here", NOT a real result and NOT a failure. It must never be returned to
    // the client as a real payload — surface a HEALTHY-EMPTY envelope so the
    // lookup chain falls through to the fallback without spending another
    // provider call. (The chain normally skips the primary before we reach
    // here; this is defense-in-depth against a mixed store.)
    if (cached.empty === true) return json(200, { results: [] })
    return json(200, cached)
  }

  // Rate-limit the cache-MISS (provider) path (T5): per user and overall. The
  // overall cap protects the shared token/quota even across different users.
  // SEC-7.4.x (#383): routed through rateLimitGuard so each 429 emits
  // `rate_limit.served` + the exhaust burst signal.
  if (identity) {
    const userRl = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'discogs:user',
      limit: DISCOGS_USER_LIMIT,
      identity,
      anomalyStore: getStore(RATE_LIMITS_STORE),
    })
    if (userRl) return userRl
  }
  const overallRl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'discogs:overall',
    limit: DISCOGS_OVERALL_LIMIT,
    identity: 'all',
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  if (overallRl) return overallRl

  const url = new URL(DISCOGS_BASE + path)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })

  let data
  try {
    // Shared T1 helper (identical to books.js) — retries transient 429/5xx and
    // network failures with a bounded Retry-After + full-jitter backoff inside
    // an overall 8s deadline, and ALWAYS sets redirect:'manual' (SSRF control:
    // a hostile upstream 3xx surfaces as the raw response, rejected below —
    // never followed to an internal target). The single RUNOUT_DISCOGS_TOKEN
    // rides in the Authorization header, never a query string.
    const res = await lookupFetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Discogs token=${token}`,
      },
    })
    // Only successful responses get cached — never error bodies. A manual 3xx
    // (never followed) is rejected outright.
    if (res.status >= 300 && res.status < 400) {
      return json(502, { error: 'Discogs redirect not allowed.', code: 'HTTP_ERROR' })
    }
    if (!res.ok) {
      if (res.status === 401) return json(502, { error: 'Discogs token rejected.', code: 'BAD_TOKEN' })
      if (res.status === 429) {
        // SEC-7.4 (#341): upstream provider 429 — distinct `PROVIDER_RATE_LIMIT`
        // code (server-side only) + Retry-After (upstream's own when present,
        // else our fixed-window hint). `RATE_LIMIT` stays for OUR throttling.
        const upstreamRetry = res.headers?.get?.('retry-after')
        const retryAfter = (upstreamRetry && Number(upstreamRetry) > 0)
          ? String(upstreamRetry)
          : String(retryAfterSeconds())
        return json(429, { error: 'Discogs rate limit hit — try again shortly.', code: 'PROVIDER_RATE_LIMIT' }, { 'Retry-After': retryAfter })
      }
      return json(502, { error: 'Discogs request failed.', code: 'HTTP_ERROR' })
    }
    // SEC-3.2 (#195): cap the provider body before parsing/caching.
    const raw = await res.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_PROXY_BYTES) {
      return json(502, { error: 'Discogs response too large.', code: 'HTTP_ERROR' })
    }
    data = JSON.parse(raw)
  } catch {
    return json(502, { error: 'Discogs request failed.', code: 'HTTP_ERROR' })
  }

  // Caching is best-effort — a failed write must not fail a successful lookup.
  // Writes through to both the DB and the legacy Blob store.
  await writeCache('discogs', key, data, ttl)
  return json(200, data)
}

// Discogs codes that are NOT a transient lookup outage — we deliberately do NOT
// spend the fallback provider on them: a token/config problem (BAD_TOKEN /
// SERVER_NO_TOKEN) is an ops signal that shouldn't be masked by quietly routing
// everything to MusicBrainz, and a rate limit (PROVIDER_RATE_LIMIT / our
// RATE_LIMIT) must not pile extra load onto the fallback provider while Discogs
// is already throttled.
const NO_FALLBACK_CODES = new Set([
  'BAD_TOKEN',
  'SERVER_NO_TOKEN',
  'PROVIDER_RATE_LIMIT',
  'RATE_LIMIT',
])

// Primary-then-fallback lookup chain (RES-1.2 T2, #288; RES-1.4 T4, #291).
//
// Discogs is the PRIMARY records provider and stays first. When the primary
// call ERRORS (a genuine service outage — 5xx / network / timeout, i.e. NOT an
// auth/token or rate-limit code), or returns a HEALTHY-EMPTY result set, we fall
// back to the tokenless MusicBrainz provider (netlify/functions/_shared/
// providers/musicbrainz.js). The FIRST non-empty result set wins:
//   - Discogs non-empty  -> Discogs results, unchanged (no fallback call).
//   - Discogs error/empty + MusicBrainz non-empty -> MB results in the SAME
//     `{ results:[...] }` envelope, each hit marked `source:'musicbrainz'`
//     with `mbid` set and `discogsId` null (normalized by the adapter).
//   - Both empty/errored  -> return the PRIMARY's original response verbatim,
//     so today's error codes / empty-search behavior are preserved exactly.
//
// RES-1.4 T4 (#291) — negative cache + circuit-breaker cooldown. Two
// SKIP-PRIMARY signals are checked BEFORE any provider call:
//   - Circuit-breaker cooldown (provider-state store): when Discogs was
//     recently recorded down (genuine 5xx/network outage), we skip it for
//     ~60s and go straight to the fallback, then retry after the cooldown.
//   - Negative cache: when this specific key is negative-cached as
//     HEALTHY-EMPTY ({empty:true} sentinel), we skip the empty provider call
//     and fall through to the fallback — "no match HERE" is not a failure.
// In BOTH skip cases the fallback's first non-empty result wins; if the
// fallback is also empty/errored we return what the primary would have
// produced: healthy-empty (`{ results: [] }`) for a negative-cached key (the
// primary WOULD have been healthy-empty), or HTTP_ERROR for a cooldown (a
// provider in cooldown is down).
//
// 429 / NO_FALLBACK tension (explicitly resolved here, #291): NO_FALLBACK_CODES
// (BAD_TOKEN / SERVER_NO_TOKEN / PROVIDER_RATE_LIMIT / RATE_LIMIT) still
// short-circuit WITHOUT falling back AND WITHOUT recording cooldown — an
// operator/token problem or an upstream/OUR rate limit is NOT a "skipped down
// provider", so it neither spends the fallback provider nor arms the breaker
// (which would otherwise mask a token/config fix for 60s and pile load onto
// MusicBrainz while Discogs is already throttled). Only a genuine provider-down
// outcome (5xx / network / timeout -> HTTP_ERROR by a non-NO_FALLBACK path)
// calls recordProviderDown. Provider-outage state lives in the SEPARATE
// provider-state store, NEVER in the 30d lookup_cache (no poisoning risk).
//
// `primary` returns a `Response` (from fetchDiscogs -> json(...)). We clone it
// so reading its JSON to decide on empty-results never consumes the response we
// might return unchanged.
async function lookupWithFallback({
  providerStateStore,
  provider,
  key,
  action,
  primary,
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
    if (fb && Array.isArray(fb.results) && fb.results.length > 0) {
      return json(200, fb)
    }
    // Fallback also empty/errored: mirror what the primary would have returned.
    // A negative-cached key -> healthy-empty primary -> empty envelope. A
    // provider in cooldown -> down primary -> its original HTTP_ERROR outage.
    return negativeEmpty
      ? json(200, { results: [] })
      : json(502, { error: 'Discogs request failed.', code: 'HTTP_ERROR' })
  }

  const res = await primary()
  let primaryBody = null
  try {
    primaryBody = await res.clone().json()
  } catch {
    primaryBody = null
  }
  const code = primaryBody?.code
  // Auth/config and rate-limit outcomes are authoritative — no fallback, no
  // cooldown (see the 429 resolution in the comment above).
  if (!res.ok && code && NO_FALLBACK_CODES.has(code)) return res
  const primaryEmpty = primaryBody && Array.isArray(primaryBody.results) && primaryBody.results.length === 0
  // Fallback fires on a Discogs service error OR a healthy-empty result set.
  if (!res.ok || primaryEmpty) {
    // A genuine provider-down outcome (5xx/network/timeout -> HTTP_ERROR by a
    // non-NO_FALLBACK path): arm the circuit breaker so we skip Discogs for
    // ~60s. Outage state NEVER goes into lookup_cache — only provider-state.
    if (!res.ok) await recordProviderDown(providerStateStore, provider)
    // A healthy-empty result is negative-cached so we stop re-spending the
    // empty provider call within the short empty TTL (barcode 1d / text 6h).
    // Only a HEALTHY empty is cached — never an error body.
    if (primaryEmpty) await writeEmptyCache(provider, key, action)
    const fb = await fallback()
    if (fb && Array.isArray(fb.results) && fb.results.length > 0) {
      return json(200, fb)
    }
  }
  return res
}

export default async (req) => {
  try {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  // Cover images are loaded by <img> tags, which cannot send the access-code
  // Authorization header — so this action is deliberately PUBLIC (T6). It is
  // safe because handleCover only ever fetches small images from an explicit
  // host allowlist (https-only, size-capped). Every other action stays
  // authenticated below. SEC-7.4 (#341): the public cover path is per-IP
  // rate-limited BEFORE handleCover so a flood can never reach the upstream.
  if (action === 'cover') {
    const coverIp = clientIp(req)
    if (coverIp) {
      // SEC-7.4.x (#383): the public cover limiter routes through rateLimitGuard
      // so each 429 emits `rate_limit.served` + the exhaust burst signal.
      // Per-IP, so its burstScope is an anonymous anomalyScope hash (the raw IP
      // never becomes a burst scope). The distinct `cover_burst` anomaly below
      // (recordAnomaly) is preserved alongside.
      const rl = await rateLimitGuard({
        store: getStore(RATE_LIMITS_STORE),
        scope: 'cover:ip',
        limit: COVER_IP_LIMIT,
        identity: coverIp,
        anomalyStore: getStore(RATE_LIMITS_STORE),
        burstScope: anomalyScope('rlx:cover:ip', coverIp),
      })
      if (rl) {
        // Abuse signal: a cover flood from one IP (NIT M5 — hashed scope).
        await recordAnomaly(getStore(RATE_LIMITS_STORE), `anom:cover:ip:${coverIp}`, { threshold: COVER_BURST_THRESHOLD, signal: 'cover_burst', scope: anomalyScope('anom:cover:ip', coverIp) })
        return rl
      }
    }
    return handleCover(url.searchParams, getStore(CACHE_STORE))
  }

  const { user, error } = await enforce(req, 'lookup:read')
  if (error) return error

  // Members/owner key provider limits by user id; the shared demo identity is
  // keyed by client IP so one demo visitor can't throttle every other.
  const identity = rateLimitIdentity(user, req)

  if (action === 'searchBarcode') {
    const barcode = cleanDigits(url.searchParams.get('barcode'))
    if (!barcode) return json(400, { error: 'Missing barcode.' })
    // Discogs first; on error or healthy-empty, fall back to MusicBrainz.
    // RES-1.4 T4 (#291): skip Discogs when it's in circuit-breaker cooldown or
    // this key is negative-cached as empty.
    return lookupWithFallback({
      providerStateStore: getStore(PROVIDER_STATE_STORE),
      provider: 'discogs',
      key: `barcode:${barcode}`,
      action,
      primary: () => fetchDiscogs('/database/search', { barcode, type: 'release' }, `barcode:${barcode}`, TTL.barcode, identity),
      fallback: () => musicbrainz.searchBarcode(barcode),
    })
  }

  if (action === 'searchText') {
    // Cap the query so one huge string can't bloat the cache key/store or the
    // outbound request.
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 200)
    if (!q) return json(400, { error: 'Missing q.' })
    // Discogs first; on error or healthy-empty, fall back to MusicBrainz.
    // RES-1.4 T4 (#291): skip Discogs when it's in circuit-breaker cooldown or
    // this key is negative-cached as empty.
    return lookupWithFallback({
      providerStateStore: getStore(PROVIDER_STATE_STORE),
      provider: 'discogs',
      key: cacheKey('q', q.toLowerCase()),
      action,
      primary: () => fetchDiscogs('/database/search', { q, type: 'release' }, cacheKey('q', q.toLowerCase()), TTL.q, identity),
      fallback: () => musicbrainz.searchText(q),
    })
  }

  if (action === 'release') {
    const id = cleanDigits(url.searchParams.get('id'))
    if (!id) return json(400, { error: 'Missing id.' })
    return fetchDiscogs(`/releases/${id}`, {}, `release:${id}`, TTL.release, identity)
  }

  return json(400, { error: 'Unknown action.' })
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
