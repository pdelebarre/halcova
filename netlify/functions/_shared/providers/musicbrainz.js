// MusicBrainz + Cover Art Archive fallback provider (RES-1.2 T2, #288).
//
// A T2 (tokenless) lookup provider for the records catalog. It sits BEHIND the
// Discogs proxy (netlify/functions/discogs.js): when the primary Discogs lookup
// errors, or returns a HEALTHY-EMPTY result set, this adapter normalizes
// MusicBrainz release JSON into the SAME `{ results:[...] }` envelope that the
// Discogs client already consumes — so a fallback hit looks to the frontend
// exactly like a Discogs search result, with `source: 'musicbrainz'` + `mbid`
// carried on top (and `discogsId` left null for fallback hits).
//
// Uniform interface (matching how the lookup adapters are shaped):
//   searchBarcode(barcode)     -> { results:[...] }
//   searchText(q)              -> { results:[...] }
//   detail(releaseMbid)        -> normalized MusicBrainz release object.
//                                (Uniform adapter contract only. It is NOT wired
//                                into the discogs `release` action, which stays
//                                Discogs-only + discogsId-gated; a fallback hit
//                                has no discogsId, so the frontend never asks
//                                for MusicBrainz release detail through this
//                                ticket's scope.)
//
// Each search method NEVER throws to the caller — a provider failure surfaces
// as an empty `{ results: [] }` so the fallback chain degrades gracefully to
// "no result" instead of failing a request that already hit a Discogs problem.
//
// Security posture (parity with the Discogs proxy):
//   - SSRF-safe: the ONLY outbound hosts are the fixed musicbrainz.org API and
//     coverartarchive.org (no CAA fetch here — see below). User input rides
//     only as encoded query-param VALUES on fixed base URLs — there is never a
//     user-supplied host or path segment. lookupFetch ALWAYS sets
//     redirect:'manual', so a hostile upstream 3xx surfaces as a raw response
//     and is rejected, never followed.
//   - Cover Art Archive covers are NOT fetched by this adapter: we only EMIT a
//     `coverartarchive.org/release/<mbid>/front-250` cover URL on each result,
//     and the existing public cover proxy re-fetches it from an EXPLICIT host
//     allowlist (coverartarchive.org — extended in _shared/cover.js). The
//     browser routes every cover through that proxy via src/utils/cover.js. So
//     the CAA host is only ever connected to by the allowlisted cover proxy.
//   - Tokenless: no API key. MusicBrainz requires only a descriptive UA.
//   - Size-capped: response bodies are capped before parsing.
//   - Rate-throttled: ~1 req/s (MusicBrainz etiquette) via a tokenless,
//     in-process min-interval gate (throttle). In a warm serverless instance
//     the gate spreads calls from the same instance; a cross-instance shared
//     limiter is out of scope for this ticket (the fallback only fires on a
//     Discogs error / healthy-empty, which is already rare, and abuse of the
//     lookup path is bounded by the existing Discogs rate limiter).

import { lookupFetch } from '../lookup-fetch'

const MB_BASE = 'https://musicbrainz.org/ws/2'
const CAA_BASE = 'https://coverartarchive.org'

// A descriptive User-Agent with a contact — MusicBrainz rejects or throttles
// requests that lack one, and their etiquette asks for a way to reach the
// operator. Mirrors the Discogs proxy's User-Agent style; no token here.
const USER_AGENT = 'RunoutRecordCollector/1.0 (records catalog; https://runout.app — contact owner@runout.app)'

// SEC-3.2-style cap: bound the provider body before parsing. MusicBrainz search
// responses for a barcode/text query are small; 2 MiB is generous and safe
// (matches the Discogs proxy's cap).
const MAX_PROVIDER_BYTES = 2 * 1024 * 1024

// MusicBrainz etiquette: no more than ~1 request/second (their docs + the
// RateLimit-* response headers).
const MB_MIN_INTERVAL_MS = 1000

// ---------------------------------------------------------------------------
// Tokenless ~1 req/s throttle.
//
// A simple in-process min-interval gate, keyed by scope. Each call reserves the
// next scheduler slot and sleeps the remainder, so overlapping calls from a
// warm instance are spread to >= minIntervalMs apart. Exported so the spacing
// is unit-testable. There is deliberately no cross-instance coordination: in a
// serverless function each invocation is typically a fresh instance anyway, and
// the fallback only fires rarely, so this gate plus the existing Discogs rate
// limiter keeps us well inside MusicBrainz's etiquette.
// ---------------------------------------------------------------------------
const lastSlotByScope = new Map()

export async function throttle(scope, minIntervalMs = MB_MIN_INTERVAL_MS) {
  const now = Date.now()
  const last = lastSlotByScope.get(scope) || 0
  // Reserve the next slot BEFORE sleeping so concurrent callers stack up
  // instead of bursting through the same gap.
  const next = Math.max(last, now) + minIntervalMs
  lastSlotByScope.set(scope, next)
  const wait = next - now
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

// The ONLY hosts this adapter may reference. lookupFetch force-sets
// redirect:'manual', so even a hostile upstream cannot bounce us to an
// off-allowlist target; the fixed base URLs below are the enforcement, and this
// set is asserted by the SSRF regression tests. (coverartarchive.org is the
// cover URL host; it is only connected to by the allowlisted cover proxy, never
// by this adapter's fetch code.)
export const ALLOWED_HOSTS = Object.freeze(['musicbrainz.org', 'coverartarchive.org'])

// ---------------------------------------------------------------------------
// MusicBrainz release JSON -> Discogs `{ results:[...] }` envelope mapping.
//
// The client (src/api/discogs.js) reads Discogs search results and maps
// `id` -> discogsId, `title`, `year`, `label`, `catno`, `format`,
// `genre`/`style`, `country`, `cover_image`, `resource_url`, `community`.
// We reproduce that shape so the same client path renders a fallback hit. Key
// differences for a MusicBrainz hit:
//   - `id` is null      -> the client stores discogsId: null (must stay null).
//   - `mbid` is the release MBID -> carried to the item as the additive id.
//   - `source: 'musicbrainz'`   -> the fallback marker.
//   - `cover_image` points at the Cover Art Archive `front-250` URL; the
//     client routes it through our cover proxy (coverartarchive.org allowlist).
//
// title is composed as "Artist - Title" so the frontend's record-title
// convention (which expects "Artist - Release Title") is preserved.
// ---------------------------------------------------------------------------
function mapRelease(release) {
  if (!release || typeof release !== 'object') return null
  const artist = (Array.isArray(release['artist-credit']) && release['artist-credit'][0]?.name)
    || (Array.isArray(release['artist-credit']) && release['artist-credit'][0]?.artist?.name)
    || ''
  const title = String(release.title || '').trim()
  const yearMatch = /^(\d{4})/.exec(String(release.date || ''))
  const media = Array.isArray(release.media) ? release.media[0] : null
  const labelInfo = Array.isArray(release['label-info']) ? release['label-info'][0] : null
  const mbid = String(release.id || '').trim()

  // Compose the cover URL only when we have a release MBID — the cover proxy
  // will re-fetch it from the allowlisted coverartarchive.org host.
  const cover = mbid ? `${CAA_BASE}/release/${mbid}/front-250` : ''

  return {
    id: null, // discogsId stays null for a fallback hit
    mbid: mbid || null,
    source: 'musicbrainz',
    type: 'release',
    title: artist && title ? `${artist} - ${title}` : (artist || title),
    year: yearMatch ? yearMatch[1] : '',
    label: (labelInfo?.label?.name) || '',
    catno: labelInfo?.['catalog-number'] || '',
    format: media?.format ? [media.format] : [],
    formatType: media?.format || '',
    genre: [],
    style: [],
    country: (release.country || '').trim(),
    cover_image: cover,
    thumb: cover,
    resource_url: mbid ? `https://musicbrainz.org/release/${mbid}` : '',
    community: {},
  }
}

function mapReleases(data) {
  const list = data?.releases || []
  if (!Array.isArray(list)) return []
  return list.map(mapRelease).filter(Boolean)
}

// Fetch a MusicBrainz search payload from the FIXED base + path. Params only
// ever become encoded query VALUES — never a host or path segment. Throws on
// redirect / non-ok / oversized / network failure (the caller catches and maps
// to an empty envelope).
async function mbFetch(path, params) {
  // SSRF control: MB_BASE is a module constant; params set query VALUES only.
  const url = new URL(MB_BASE + path)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })
  url.searchParams.set('fmt', 'json')

  // MusicBrainz etiquette: ~1 req/s.
  await throttle('musicbrainz')

  let res
  try {
    // Shared T1 helper: retries transient 429/5xx + network failures with a
    // bounded Retry-After + full-jitter backoff inside an overall 8s deadline,
    // and ALWAYS sets redirect:'manual' (SSRF: a hostile upstream 3xx surfaces
    // here and is rejected below — never followed). No Authorization header:
    // MusicBrainz is tokenless.
    res = await lookupFetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
    })
  } catch {
    throw new Error('MusicBrainz request failed.')
  }
  // A manual 3xx (never followed) is rejected outright.
  if (res.status >= 300 && res.status < 400) {
    throw new Error('MusicBrainz redirect not allowed.')
  }
  if (!res.ok) throw new Error('MusicBrainz request failed.')
  const raw = await res.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_BYTES) {
    throw new Error('MusicBrainz response too large.')
  }
  return JSON.parse(raw)
}

// Run a search, always resolving to the `{ results:[...] }` envelope. Any
// provider failure degrades to an empty set so the fallback chain never
// propagates a secondary error to the caller.
async function searchWith(fn) {
  try {
    const data = await fn()
    return { results: mapReleases(data) }
  } catch {
    return { results: [] }
  }
}

// Release barcode search: query=barcode:<barcode> against the fixed API base.
export async function searchBarcode(barcode) {
  const clean = String(barcode || '').replace(/[^0-9Xx]/g, '')
  if (!clean) return { results: [] }
  return searchWith(() => mbFetch('/release/', { query: `barcode:${clean}` }))
}

// Free-text release search.
export async function searchText(query) {
  const q = String(query || '').trim().slice(0, 200)
  if (!q) return { results: [] }
  return searchWith(() => mbFetch('/release/', { query: q }))
}

// Uniform adapter detail method (release-group-granularity detail for a release
// MBID). Implemented for interface completeness; the discogs `release` action
// does not route here (see header). Returns a normalized release object or
// null on failure.
export async function detail(releaseMbid) {
  const mbid = String(releaseMbid || '').trim()
  if (!mbid) return null
  try {
    const data = await mbFetch(`/release/${encodeURIComponent(mbid)}`, {
      inc: 'artists+labels+recordings+release-groups',
    })
    return mapRelease(data)
  } catch {
    return null
  }
}

// The adapter's public surface — one import for the callers.
export const musicbrainz = { searchBarcode, searchText, detail }
