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
function yearFrom(publishedDate) {
  return (publishedDate || '').slice(0, 4)
}

// Google Books thumbnails are served over http:// in the metadata — upshift to
// https so mixed-content rules don't blank the covers.
function httpsUrl(url) {
  return url ? url.replace(/^http:\/\//i, 'https://') : ''
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
    year: yearFrom(v.publishedDate),
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
    pageCount: v.pageCount || '',
    language: v.language || '',
    infoLink: volume.selfLink || '',
    resourceUrl: volume.selfLink || '',
  }
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
  return {
    description: data.volumeInfo?.description || '',
    pageCount: data.volumeInfo?.pageCount || '',
  }
}
