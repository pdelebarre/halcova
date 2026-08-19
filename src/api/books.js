import { getSessionToken } from '../utils/session'
import { proxyCoverUrl } from '../utils/cover'

// Books are looked up through the server-side Google Books proxy, which owns
// request building (country, etc.) and caches responses in Blobs. The browser
// just calls the function with the signed-in user's session token. Items are
// normalized into the same shape the app uses for records ("Author - Title",
// year, label=publisher, barcode=ISBN, etc.) so the shared grid/detail/
// duplicate-detection code works for both.

const FN_BASE = '/.netlify/functions/books'

const ERROR_MESSAGES = {
  RATE_LIMIT: 'Google Books rate limit hit — wait a moment and try again.',
  HTTP_ERROR: 'Google Books request failed.',
}

function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function booksFetch(action, params = {}) {
  const url = new URL(FN_BASE, window.location.origin)
  url.searchParams.set('action', action)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })

  const res = await fetch(url.pathname + url.search, { headers: authHeaders() })

  if (!res.ok) {
    let code = 'HTTP_ERROR'
    try {
      const body = await res.json()
      if (body?.code) code = body.code
    } catch { /* non-JSON error body — fall back to HTTP_ERROR */ }
    const err = new Error(ERROR_MESSAGES[code] || `Google Books request failed (${res.status})`)
    err.code = code
    throw err
  }
  return res.json()
}

// ISBN-13 barcodes scan as EAN-13; covers can also carry ISBN-10 as Code128.
function cleanIsbn(raw) {
  return String(raw).replace(/[^0-9Xx]/g, '')
}

function pickIsbn(volume) {
  const ids = volume.volumeInfo?.industryIdentifiers || []
  const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
  const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier
  return isbn13 || isbn10 || ''
}

// The "year" Google Books gives is often "2012-03-01" — keep just the year.
// The collection API requires an integer year (1000–2100) or omits it
// (netlify/functions/_shared/item-fields.js intInRange), so return an integer
// or undefined — never a string or ''.
function yearFrom(publishedDate) {
  const year = Number(String(publishedDate || '').slice(0, 4))
  return Number.isInteger(year) && year >= 1000 && year <= 2100 ? year : undefined
}

// Google Books thumbnails are served over http:// in the metadata — upshift to
// https so mixed-content rules don't blank the covers.
function httpsUrl(url) {
  return url ? url.replace(/^http:\/\//i, 'https://') : ''
}

// (FEAT-EPIC-5, #276) Phase A blob enrichment caps — keep in sync with the
// server allowlist (netlify/functions/_shared/item-fields.js: AUTHORS_MAX /
// SNIPPET_MAX).
const MAX_DETAIL_AUTHORS = 8
const SNIPPET_MAX = 400

// Google Books authors are a bare string array (no per-author ids in the
// volume payload) — keep them structured ({ name, id? }) with the flattened
// title behavior unchanged, capped defensively. Blank names are dropped (the
// server requires a non-empty name per entry).
function authorsList(volumeInfo) {
  const v = volumeInfo || {}
  return (Array.isArray(v.authors) ? v.authors : [])
    .slice(0, MAX_DETAIL_AUTHORS)
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => ({ name: name.trim() }))
}

// volumeInfo.seriesInfo.bookSeriesInfo.seriesDisplayName — a string when the
// volume belongs to a series, '' otherwise.
function seriesName(volumeInfo) {
  return volumeInfo?.seriesInfo?.bookSeriesInfo?.seriesDisplayName || ''
}

// The primary category: volumeInfo.mainCategory when present, else the first
// entry of volumeInfo.categories (Google Books usually only provides the
// latter).
function mainCategoryOf(volumeInfo) {
  const v = volumeInfo || {}
  if (typeof v.mainCategory === 'string' && v.mainCategory.trim() !== '') return v.mainCategory.trim()
  if (Array.isArray(v.categories) && typeof v.categories[0] === 'string' && v.categories[0].trim() !== '') {
    return v.categories[0].trim()
  }
  return ''
}

// searchInfo.textSnippet is an HTML-ish blurb (may carry &quot; entities);
// keep it raw but cap it defensively so the stored payload stays small.
function snippetFrom(searchInfo) {
  const raw = typeof searchInfo?.textSnippet === 'string' ? searchInfo.textSnippet : ''
  return raw.slice(0, SNIPPET_MAX)
}

function toBookItem(volume, scannedIsbn) {
  const v = volume.volumeInfo || {}
  const isbn = scannedIsbn || pickIsbn(volume)
  const authors = (v.authors || []).join(', ')
  const title = v.title || ''
  const itemTitle = authors ? `${authors} - ${title}` : title

  const item = {
    googleBooksId: volume.id || null,
    title: itemTitle,
    label: v.publisher || '',
    catno: isbn,
    isbn,
    formatRaw: '',
    formatType: '',
    genre: v.categories || [],
    style: [],
    country: '',
    coverImage: proxyCoverUrl(FN_BASE, httpsUrl(v.imageLinks?.thumbnail || '')),
    barcode: isbn,
    description: v.description || '',
    language: v.language || '',
    infoLink: volume.selfLink || '',
    resourceUrl: volume.selfLink || '',
    // (FEAT-EPIC-5, #276) Phase A content fields — authors stay structured
    // (the flattened title above is unchanged) and subtitle/series/
    // mainCategory/snippet are surfaced instead of discarded.
    authorsList: authorsList(v),
    subtitle: v.subtitle || '',
    series: seriesName(v),
    mainCategory: mainCategoryOf(v),
    snippet: snippetFrom(volume.searchInfo),
  }
  // `year`/`pageCount` must match the server's integer contract (a string or
  // '' is a 400 TYPE_ERROR on POST) — emit them only as valid integers.
  const year = yearFrom(v.publishedDate)
  if (year !== undefined) item.year = year
  if (Number.isInteger(v.pageCount) && v.pageCount >= 0) item.pageCount = v.pageCount
  // Google Books volumes carry averageRating (0–5) + ratingsCount — surface
  // them on the item when present (absent or 0 = no community votes).
  if (typeof v.averageRating === 'number' && v.averageRating > 0) item.rating = v.averageRating
  if (Number.isInteger(v.ratingsCount) && v.ratingsCount > 0) item.ratingCount = v.ratingsCount
  return item
}

export async function searchByBarcode(isbn) {
  const clean = cleanIsbn(isbn)
  const data = await booksFetch('searchBarcode', { isbn: clean })
  return (data.items || []).slice(0, 10).map((vol) => toBookItem(vol, clean))
}

export async function searchByText(query) {
  const data = await booksFetch('searchText', { q: query })
  return (data.items || []).map((vol) => toBookItem(vol, ''))
}

export async function getBookDetail(googleBooksId) {
  const data = await booksFetch('detail', { id: googleBooksId })
  const v = data.volumeInfo || {}
  return {
    description: v.description || '',
    pageCount: v.pageCount || '',
    // (FEAT-EPIC-5, #276) Phase A content fields — same shape as toBookItem so
    // the detail-view merge backfills them onto stored items.
    authorsList: authorsList(v),
    subtitle: v.subtitle || '',
    series: seriesName(v),
    mainCategory: mainCategoryOf(v),
    snippet: snippetFrom(data.searchInfo),
  }
}
