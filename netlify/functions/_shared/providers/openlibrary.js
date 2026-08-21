// OpenLibrary fallback provider (RES-1.3 T3, #283).
//
// A T3 (tokenless) lookup provider for the books catalog. It sits BEHIND the
// Google Books proxy (netlify/functions/books.js): when the primary Google
// Books lookup ERRORS, or returns a HEALTHY-EMPTY result set, this adapter
// normalizes OpenLibrary JSON into the SAME `{ items:[...] }` Google Books
// envelope that the client already consumes — so a fallback hit looks to the
// frontend exactly like a Google Books search result, with
// `source: 'openlibrary'` + `openLibraryId` carried on top (and `googleBooksId`
// left null for fallback hits). A fallback hit therefore renders through the
// exact same `toBookItem` client path and the same BookDetail view.
//
// Uniform interface (matching how the lookup adapters are shaped):
//   searchBarcode(isbn)  -> { items:[...] }   (Google Books envelope)
//   searchText(q)        -> { items:[...] }
//   detail(olid)         -> normalized OpenLibrary volume object.
//
// Each search method NEVER throws to the caller — a provider failure surfaces
// as an empty `{ items: [] }` so the fallback chain degrades gracefully to
// "no result" instead of failing a request that already hit a Google problem.
//
// Security posture (parity with the Google Books proxy and the MusicBrainz
// fallback #288):
//   - SSRF-safe: the ONLY outbound host is the fixed openlibrary.org API.
//     User input rides only as encoded query-param VALUES on fixed base URLs —
//     there is never a user-supplied host or path segment. lookupFetch ALWAYS
//     sets redirect:'manual', so a hostile upstream 3xx surfaces as a raw
//     response and is rejected, never followed.
//   - Covers are NOT fetched by this adapter: we only EMIT a
//     covers.openlibrary.org cover URL on each result, and the existing public
//     cover proxy re-fetches it from an EXPLICIT host allowlist
//     (covers.openlibrary.org — extended in _shared/cover.js). The browser
//     routes every cover through that proxy via src/utils/cover.js. So the
//     cover host is only ever connected to by the allowlisted cover proxy.
//   - Tokenless: no API key. OpenLibrary needs only a descriptive UA.
//   - Size-capped: response bodies are capped before parsing.
//   - Rate-throttled: ~1 req/s (OpenLibrary etiquette) via a tokenless,
//     in-process min-interval gate (throttle), mirroring MusicBrainz #288. In
//     a warm serverless instance the gate spreads calls; a cross-instance
//     shared limiter is out of scope for this ticket (the fallback only fires
//     on a Google error / healthy-empty, and abuse of the lookup path is
//     bounded by the existing books rate limiter).

import { lookupFetch } from '../lookup-fetch'
import { isJsonContentType } from './payload-guard'

const OL_BASE = 'https://openlibrary.org'
const OL_COVER_HOST = 'covers.openlibrary.org'

// A descriptive User-Agent with a contact — OpenLibrary asks clients to
// identify themselves, and a missing/blank UA risks throttling. Mirrors the
// Google/Discogs proxy UA style; no token here.
const USER_AGENT = 'RunoutRecordCollector/1.0 (books catalog; https://runout.app — contact owner@runout.app)'

// SEC-3.2-style cap: bound the provider body before parsing. OpenLibrary
// search responses for a barcode/text query are small; 2 MiB is generous and
// safe (matches the MusicBrainz fallback and Discogs proxy caps).
const MAX_PROVIDER_BYTES = 2 * 1024 * 1024

// OpenLibrary etiquette: no more than ~1 request/second.
const OL_MIN_INTERVAL_MS = 1000

// ---------------------------------------------------------------------------
// Tokenless ~1 req/s throttle (mirrors MusicBrainz #288).
//
// A simple in-process min-interval gate, keyed by scope. Each call reserves the
// next scheduler slot and sleeps the remainder, so overlapping calls from a
// warm instance are spread to >= minIntervalMs apart. Exported so the spacing
// is unit-testable. There is deliberately no cross-instance coordination: in a
// serverless function each invocation is typically a fresh instance anyway, and
// the fallback only fires rarely, so this gate plus the existing books rate
// limiter keeps us well inside OpenLibrary's etiquette.
// ---------------------------------------------------------------------------
const lastSlotByScope = new Map()

export async function throttle(scope, minIntervalMs = OL_MIN_INTERVAL_MS) {
  const now = Date.now()
  const last = lastSlotByScope.get(scope) || 0
  // Reserve the next slot BEFORE sleeping so concurrent callers stack up
  // instead of bursting through the same gap.
  const next = Math.max(last, now) + minIntervalMs
  lastSlotByScope.set(scope, next)
  const wait = next - now
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

// The ONLY host this adapter may connect to is openlibrary.org (the API).
// covers.openlibrary.org is the cover URL host — it is only connected to by
// the allowlisted cover proxy, never by this adapter's fetch code. This set is
// asserted by the SSRF regression tests.
export const ALLOWED_HOSTS = Object.freeze(['openlibrary.org', OL_COVER_HOST])

// Strip a leading "/works/OLxxxW" / "/books/OLxxxM" path down to the bare OLID
// so the item's additive id is a stable `OL…` token (the same convention the
// ticket specifies). Returns '' when the key doesn't look like an OpenLibrary
// key.
function olidFromKey(key) {
  const m = /^\/(?:works|books|editions)\/(OL[a-zA-Z0-9]+)\/?$/.exec(String(key || '').trim())
  return m ? m[1] : ''
}

// -- cover ------------------------------------------------------------------
// Compose the covers.openlibrary.org cover URL when a cover is available. The
// cover proxy (allowlisted for covers.openlibrary.org) re-fetches it. Returns
// '' when there's no cover id to build from. Only https is emitted (the client
// proxies https covers only).
function coverUrl(id) {
  const coverId = String(id ?? '').trim()
  return coverId ? `https://${OL_COVER_HOST}/b/id/${coverId}-M.jpg` : ''
}

function descriptionValue(d) {
  if (typeof d === 'string') return d
  return (d && typeof d === 'object' && d.value) ? d.value : ''
}

// -- Google Books envelope item ---------------------------------------------
// Build ONE Google-style "volume" object that src/api/books.js toBookItem can
// consume for a fallback hit. Key fields toBookItem reads:
//   volume.selfLink  -> infoLink / resourceUrl
//   volumeInfo.title / authors[] / publisher / publishedDate / pageCount /
//     description / categories / imageLinks.thumbnail / industryIdentifiers
// We reproduce that shape so the same client path renders a fallback hit. Key
// differences for an OpenLibrary hit:
//   - `id` is null     -> the client stores googleBooksId: null (must stay null).
//   - `openLibraryId` is the work-or-edition OLID -> carried to the item as the
//     additive id.
//   - `source: 'openlibrary'` -> the fallback marker.
//   - `volumeInfo.imageLinks.thumbnail` points at a covers.openlibrary.org URL;
//     the client routes it through our cover proxy (covers.openlibrary.org
//     allowlist).
function mapVolume(input) {
  const {
    title, authors, publisher, publishedDate, pageCount, description,
    categories, cover, selfLink, openLibraryId, industryIdentifiers, language,
  } = input
  const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : !!v)
  const volumeInfo = {}
  if (nonEmpty(title)) volumeInfo.title = String(title)
  if (nonEmpty(authors)) volumeInfo.authors = authors.map(String)
  if (nonEmpty(publisher)) volumeInfo.publisher = String(publisher)
  if (nonEmpty(publishedDate)) volumeInfo.publishedDate = String(publishedDate)
  if (Number.isInteger(pageCount) && pageCount >= 0) volumeInfo.pageCount = pageCount
  if (nonEmpty(description)) volumeInfo.description = String(description)
  if (nonEmpty(categories)) volumeInfo.categories = categories.map(String)
  if (nonEmpty(language)) volumeInfo.language = String(language)
  if (nonEmpty(cover)) volumeInfo.imageLinks = { thumbnail: cover }
  if (nonEmpty(industryIdentifiers)) volumeInfo.industryIdentifiers = industryIdentifiers

  const out = {
    // googleBooksId must stay null for a fallback hit.
    id: null,
    // The additive OpenLibrary id (work OLID preferred; edition OLID when
    // that's all the endpoint returns).
    openLibraryId: openLibraryId || null,
    source: 'openlibrary',
  }
  if (nonEmpty(selfLink)) out.selfLink = String(selfLink)
  if (Object.keys(volumeInfo).length) out.volumeInfo = volumeInfo
  return out
}

// -- ISBN mapping ------------------------------------------------------------
// GET /api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data
// -> a per-bibkey object: { details:{…}, info_url, thumbnail_url, … }. Only the
// requested ISBN key is present. Map its `details` into one Google-style volume.
function mapIsbnEntry(isbn, entry) {
  if (!entry || typeof entry !== 'object') return null
  const d = entry.details || {}
  const title = d.title || ''
  const authors = Array.isArray(d.authors) ? d.authors.map((a) => a?.name).filter(Boolean) : []
  const publisher = Array.isArray(d.publishers) ? d.publishers[0] : ''
  const publishedDate = d.publish_date || (Number.isInteger(d.first_publish_year) ? String(d.first_publish_year) : '')
  const pageCount = Number.isInteger(d.number_of_pages) ? d.number_of_pages : undefined
  const description = descriptionValue(d.description)
  // OpenLibrary's jscmd=data only gives us an EDITION OLID (/books/OLxxxxM) —
  // use it as the openLibraryId (the work OLID isn't returned here). Documented
  // in the header: prefer the work OLID where one is available (search.json
  // returns it); the edition OLID is used for ISBN hits.
  const openLibraryId = olidFromKey(d.key)
  const cover = entry.thumbnail_url || coverUrl(Array.isArray(d.covers) ? d.covers[0] : null)
  const selfLink = entry.info_url || `https://openlibrary.org/isbn/${isbn}`
  const industryIdentifiers = [{ type: 'ISBN_13', identifier: isbn }]

  return mapVolume({
    title,
    authors,
    publisher,
    publishedDate,
    pageCount,
    description,
    categories: [],
    cover,
    selfLink,
    openLibraryId,
    industryIdentifiers,
  })
}

function workUrl(key, openLibraryId) {
  if (key) return `${OL_BASE}${key}`
  return openLibraryId ? `${OL_BASE}/works/${openLibraryId}` : ''
}

// -- search.json mapping -----------------------------------------------------
// GET /search.json?q=<q>&fields=…&limit=10
// -> { numFound, docs:[{ key:'/works/OLxxxW', title, author_name[], … }] }.
// The work OLID is preferred as openLibraryId (per the ticket's example).
function mapSearchData(data) {
  const docs = Array.isArray(data?.docs) ? data.docs : []
  return docs.map((doc) => {
    // strip any bounds-like artifacts; OpenLibrary's search.json fields already
    // come back unscoped.
    const openLibraryId = olidFromKey(doc.key)
    const title = doc.title || ''
    const authors = Array.isArray(doc.author_name) ? doc.author_name : []
    const publisher = Array.isArray(doc.publisher) && doc.publisher.length ? doc.publisher[0] : ''
    const publishedDate = Number.isInteger(doc.first_publish_year) ? String(doc.first_publish_year) : ''
    const cover = coverUrl(doc.cover_i)
    const selfLink = workUrl(doc.key, openLibraryId)
    // Provide industryIdentifiers from the doc's ISBNs so pickIsbn can fill the
    // barcode when no scanned code rides along (searchText path).
    const industryIdentifiers = Array.isArray(doc.isbn) && doc.isbn.length
      ? doc.isbn.slice(0, 2).map((id) => ({ type: id.length > 10 ? 'ISBN_13' : 'ISBN_10', identifier: id }))
      : []
    return mapVolume({
      title,
      authors,
      publisher,
      publishedDate,
      pageCount: undefined,
      description: '',
      categories: [],
      cover,
      selfLink,
      openLibraryId,
      industryIdentifiers,
    })
  }).filter((v) => v?.volumeInfo)
}

// ---------------------------------------------------------------------------
// Fetch an OpenLibrary payload from the FIXED base + path. Params only ever
// become encoded query VALUES — never a host or path segment. Throws on
// redirect / non-ok / oversized / network failure (the caller catches and maps
// to an empty envelope).
// ---------------------------------------------------------------------------
async function olFetch(path, params = {}) {
  // SSRF control: OL_BASE is a module constant; params set query VALUES only.
  const url = new URL(OL_BASE + path)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })

  // OpenLibrary etiquette: ~1 req/s.
  await throttle('openlibrary')

  let res
  try {
    // Shared T1 helper: retries transient 429/5xx + network failures with a
    // bounded Retry-After + full-jitter backoff inside an overall 8s deadline,
    // and ALWAYS sets redirect:'manual' (SSRF: a hostile upstream 3xx surfaces
    // here and is rejected below — never followed). No Authorization header:
    // OpenLibrary is tokenless.
    res = await lookupFetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
    })
  } catch {
    throw new Error('OpenLibrary request failed.')
  }
  // A manual 3xx (never followed) is rejected outright.
  if (res.status >= 300 && res.status < 400) {
    throw new Error('OpenLibrary redirect not allowed.')
  }
  if (!res.ok) throw new Error('OpenLibrary request failed.')
  // SEC-6.3 #217: reject a non-JSON content-type fail-closed.
  if (!isJsonContentType(res.headers?.get?.('content-type'))) {
    throw new Error('OpenLibrary response is not JSON.')
  }
  const raw = await res.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_BYTES) {
    throw new Error('OpenLibrary response too large.')
  }
  return JSON.parse(raw)
}

// Run a search, always resolving to the Google Books `{ items:[...] }` envelope.
// Any provider failure degrades to an empty set so the fallback chain never
// propagates a secondary error to the caller.
async function searchWith(fn) {
  try {
    const data = await fn()
    return { items: mapSearchData(data) }
  } catch {
    return { items: [] }
  }
}

// ISBN search: /api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data. The
// response is a single-key object (keyed by the bibkey); map it if present.
export async function searchBarcode(isbn) {
  const clean = String(isbn || '').replace(/[^0-9Xx]/g, '')
  if (!clean) return { items: [] }
  try {
    const data = await olFetch('/api/books', {
      bibkeys: `ISBN:${clean}`,
      format: 'json',
      jscmd: 'data',
    })
    const entry = (data && typeof data === 'object') ? data[`ISBN:${clean}`] : null
    const vol = mapIsbnEntry(clean, entry)
    return { items: vol ? [vol] : [] }
  } catch {
    return { items: [] }
  }
}

// Free-text search against /search.json. Returns up to 10 docs in the envelope.
export async function searchText(query) {
  const q = String(query || '').trim().slice(0, 200)
  if (!q) return { items: [] }
  return searchWith(() => olFetch('/search.json', {
    q,
    fields: 'title,author_name,first_publish_year,publisher,isbn,cover_i,key,edition_key',
    limit: 10,
  }))
}

// Uniform adapter detail method for an OLID. Returns a normalized volume object
// or null on failure. (Implemented for interface completeness; the books
// `detail` action stays Google-only and googleBooksId-gated — a fallback hit
// has no googleBooksId, so the frontend never asks for OpenLibrary detail
// through this ticket's scope.)
export async function detail(olid) {
  const id = String(olid || '').trim()
  if (!id) return null
  try {
    const data = await olFetch(`/works/${encodeURIComponent(id)}.json`)
    const authors = Array.isArray(data?.authors)
      ? data.authors.map((a) => a?.key).filter(Boolean)
      : []
    return mapVolume({
      title: data?.title || '',
      authors,
      publisher: '',
      publishedDate: Number.isInteger(data?.first_publish_year) ? String(data.first_publish_year) : '',
      pageCount: Number.isInteger(data?.number_of_pages) ? data.number_of_pages : undefined,
      description: descriptionValue(data?.description),
      categories: [],
      cover: '',
      selfLink: `${OL_BASE}/works/${encodeURIComponent(id)}`,
      openLibraryId: id,
      industryIdentifiers: [],
    })
  } catch {
    return null
  }
}

// The adapter's public surface — one import for the callers.
export const openlibrary = { searchBarcode, searchText, detail }
