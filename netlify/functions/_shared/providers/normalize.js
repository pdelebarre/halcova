// normalize.js — FEAT-6.4 #317: provider-agnostic normalization into the
// normalized DTO (ADR-0020 §4 provider_ids / canonical_attributes / media).
//
// The ONLY shape that reaches collection-domain code is the NormalizedHit
// emitted here. A provider's raw JSON (Discogs result fields, Google volume
// fields, MusicBrainz release fields, OpenLibrary volume fields) is mapped
// into three provider-agnostic buckets and nothing else:
//   * provider_ids          — additive, preserved (never authoritative for
//                             ownership; ADR-0020 §4/#317 control).
//   * canonical_attributes  — validated extensible metadata (title, year,
//                             label, genre, …).
//   * media                 — public cover/resource URLs.
//   * source                — provenance marker.
//
// These normalizers are PURE and operate on a payload that has already passed
// payload-guard (schema-validated + size-limited). Every canonical string is
// guarded with the dangerous-content check (XSS-safe rendering, SEC-7.5 #409 /
// ADR-0020 #317 control) and length-capped, mirroring item-fields.js caps.

import { isSafeCanonicalString } from './payload-guard'

// Cap constants aligned with the server item allowlist (item-fields.js) so a
// normalized hit never exceeds what the domain can store.
export const NORMALIZE_CAPS = Object.freeze({
  title: 1000,
  label: 500,
  country: 200,
  formatRaw: 2000,
  formatType: 500,
  catno: 200,
  genreMax: 100,
  genreItem: 500,
  description: 5000,
  url: 2000,
})

// A safe canonical string: non-empty, dangerous-content-free, length-capped.
// Returns '' for an absent/unsafe/oversized value (fail-closed — an unsafe
// canonical field is dropped, never leaked to the domain).
function safeCanonical(value, { max = NORMALIZE_CAPS.title, required = false } = {}) {
  if (value == null) return required ? '' : ''
  const s = String(value).trim()
  if (s === '') return ''
  if (s.length > max) return ''
  if (!isSafeCanonicalString(s)) return ''
  return s
}

// A safe array of canonical strings (genre/style/categories). Entries are
// type-checked, capped, dangerous-content-guarded; unsafe entries dropped.
function safeCanonicalArray(value, { max = NORMALIZE_CAPS.genreMax, itemMax = NORMALIZE_CAPS.genreItem } = {}) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (s === '' || s.length > itemMax || !isSafeCanonicalString(s)) continue
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

// A safe https URL (cover/resource). Only https is emitted; any http/off-shape
// value is dropped (the client proxies https covers only). The host allowlist
// check already ran in payload-guard.
function safeUrl(value, { max = NORMALIZE_CAPS.url } = {}) {
  const s = safeCanonical(value, { max })
  return /^https:\/\//.test(s) ? s : ''
}

// Additive provider-id keys per catalog and the RAW field each maps from.
//   records: id -> discogsId (Discogs / MB-fallback envelope), mbid -> mbid
//   books:   id -> googleBooksId (Google / OL-fallback volume), openLibraryId,
//            isbn
// Provider IDs are ADDITIVE and PRESERVED — a present raw id is carried onto
// the normalized provider_ids map exactly; absent -> omitted (never invented).
const RECORDS_ID_FIELDS = [
  ['discogsId', 'id'],
  ['discogsId', 'discogsId'],
  ['mbid', 'mbid'],
]
const BOOKS_ID_FIELDS = [
  ['googleBooksId', 'id'],
  ['googleBooksId', 'googleBooksId'],
  ['openLibraryId', 'openLibraryId'],
  ['isbn', 'isbn'],
]

function pickProviderIds(hit, fields, extra = {}) {
  const ids = {}
  for (const [key, raw] of fields) {
    if (Object.hasOwn(ids, key)) continue // first raw source wins (primary id)
    const v = hit && Object.hasOwn(hit, raw) ? hit[raw] : null
    // Preserve the id additively when present and scalar-ish; never invent one.
    if (v !== undefined && v !== null && v !== '') ids[key] = v
  }
  // Additive extras (e.g. isbn derived from the volume) never override a
  // direct hit field already picked.
  for (const [key, value] of Object.entries(extra)) {
    if (!Object.hasOwn(ids, key) && value !== undefined && value !== null && value !== '') ids[key] = value
  }
  return ids
}

function baseHit(source, provider_ids) {
  return {
    provider_ids,
    canonical_attributes: {},
    media: {},
    source,
  }
}

// ---------------------------------------------------------------------------
// Records — Discogs-shaped envelope hit (also covers a MusicBrainz fallback
// hit, which the fallback adapter already maps into the same shape carrying
// `mbid` + `source:'musicbrainz'`).
// ---------------------------------------------------------------------------
export function normalizeRecordsHit(hit) {
  if (!hit || typeof hit !== 'object' || Array.isArray(hit)) return null

  const source = hit.source === 'musicbrainz' ? 'musicbrainz' : 'discogs'
  // discogsId stays null for a fallback hit; mbid present only on fallback.
  const provider_ids = pickProviderIds(hit, RECORDS_ID_FIELDS)

  const canonical = {}
  const title = safeCanonical(hit.title)
  if (title) canonical.title = title
  const year = Number(hit.year)
  if (Number.isInteger(year) && year >= 1000 && year <= 2100) canonical.year = year
  const label = safeCanonical(hit.label, { max: NORMALIZE_CAPS.label })
  if (label) canonical.label = label
  const country = safeCanonical(hit.country, { max: NORMALIZE_CAPS.country })
  if (country) canonical.country = country
  const catno = safeCanonical(hit.catno, { max: NORMALIZE_CAPS.catno })
  if (catno) canonical.catno = catno
  const formatRaw = safeCanonical(Array.isArray(hit.format) ? hit.format.join(', ') : hit.formatRaw, { max: NORMALIZE_CAPS.formatRaw })
  if (formatRaw) canonical.formatRaw = formatRaw
  const formatType = safeCanonical(hit.formatType, { max: NORMALIZE_CAPS.formatType })
  if (formatType) canonical.formatType = formatType
  const genre = safeCanonicalArray(hit.genre)
  if (genre.length) canonical.genre = genre
  const style = safeCanonicalArray(hit.style)
  if (style.length) canonical.style = style

  const media = {}
  const cover = safeUrl(hit.cover_image || hit.thumb)
  if (cover) media.coverImage = cover
  const resource = safeUrl(hit.resource_url)
  if (resource) media.resourceUrl = resource

  const hitNorm = baseHit(source, provider_ids)
  hitNorm.canonical_attributes = canonical
  hitNorm.media = media
  // A pathological row with no provider id and no canonical content is dropped
  // (nothing usable to surface — leaking an empty shell would carry provider
  // junk). A row with ONLY an id is kept (the id is the useful additive bit).
  if (Object.keys(provider_ids).length === 0 && Object.keys(canonical).length === 0) return null
  return hitNorm
}

// ---------------------------------------------------------------------------
// Books — Google Books envelope hit (also covers an OpenLibrary fallback hit,
// which the fallback adapter maps into the same volume shape carrying
// `openLibraryId` + `source:'openlibrary'`).
// ---------------------------------------------------------------------------
export function normalizeBooksHit(hit) {
  if (!hit || typeof hit !== 'object' || Array.isArray(hit)) return null

  const source = hit.source === 'openlibrary' ? 'openlibrary' : 'googleBooks'
  const v = (hit.volumeInfo && typeof hit.volumeInfo === 'object') ? hit.volumeInfo : {}
  // Derive the ISBN from the volume's industryIdentifiers as an additive id
  // (the Google/OL volume envelope carries it there, not on hit.isbn).
  const derivedIsbn = pickIsbn(v)
  const provider_ids = pickProviderIds(hit, BOOKS_ID_FIELDS, { isbn: derivedIsbn })

  const canonical = {}
  const title = safeCanonical(v.title)
  if (title) canonical.title = title
  const subtitle = safeCanonical(v.subtitle, { max: 500 })
  if (subtitle) canonical.subtitle = subtitle
  const series = safeCanonical(v.seriesInfo?.bookSeriesInfo?.seriesDisplayName, { max: 300 })
  if (series) canonical.series = series
  const mainCategory = safeCanonical(
    typeof v.mainCategory === 'string' && v.mainCategory.trim() !== '' ? v.mainCategory : (Array.isArray(v.categories) && v.categories[0]),
    { max: 120 },
  )
  if (mainCategory) canonical.mainCategory = mainCategory
  const publisher = safeCanonical(v.publisher, { max: NORMALIZE_CAPS.label })
  if (publisher) canonical.publisher = publisher
  const isbn = safeCanonical(hit.isbn || pickIsbn(v), { max: 24 })
  if (isbn) canonical.isbn = isbn
  const pageCount = v.pageCount
  if (Number.isInteger(pageCount) && pageCount >= 0) canonical.pageCount = pageCount
  const description = safeCanonical(v.description, { max: NORMALIZE_CAPS.description })
  if (description) canonical.description = description
  const language = safeCanonical(v.language, { max: 20 })
  if (language) canonical.language = language
  const authors = safeCanonicalArray(Array.isArray(v.authors) ? v.authors : [], { itemMax: 300 })
  if (authors.length) canonical.authors = authors

  const media = {}
  const cover = safeUrl(v.imageLinks?.thumbnail)
  if (cover) media.coverImage = cover
  const infoLink = safeUrl(hit.selfLink)
  if (infoLink) media.infoLink = infoLink

  const hitNorm = baseHit(source, provider_ids)
  hitNorm.canonical_attributes = canonical
  hitNorm.media = media
  if (Object.keys(provider_ids).length === 0 && Object.keys(canonical).length === 0) return null
  return hitNorm
}

// ---------------------------------------------------------------------------
// Provider-id helpers.
// ---------------------------------------------------------------------------

// Best-effort ISBN extraction from a Google volume's industryIdentifiers.
function pickIsbn(volumeInfo) {
  const ids = Array.isArray(volumeInfo?.industryIdentifiers) ? volumeInfo.industryIdentifiers : []
  const isbn13 = ids.find((i) => i?.type === 'ISBN_13')?.identifier
  const isbn10 = ids.find((i) => i?.type === 'ISBN_10')?.identifier
  return isbn13 || isbn10 || ''
}

// The public normalization surface.
export const normalizers = {
  records: normalizeRecordsHit,
  books: normalizeBooksHit,
}
