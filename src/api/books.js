// Books are looked up through the Google Books API. It needs no token — a
// public endpoint that returns JSON, good for ISBN scans and title/author
// searches. Items are normalized into the same shape the app uses for records
// ("Author - Title", year, label=publisher, barcode=ISBN, etc.) so the shared
// grid/detail/duplicate-detection code works for both.

const BASE = 'https://www.googleapis.com/books/v1'

async function booksFetch(path, params = {}) {
  const url = new URL(BASE + path)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })
  url.searchParams.set('country', 'US')
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const err = new Error(`Google Books request failed (${res.status})`)
    err.code = 'HTTP_ERROR'
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

  return {
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
    coverImage: httpsUrl(v.imageLinks?.thumbnail || ''),
    barcode: isbn,
    description: v.description || '',
    pageCount: v.pageCount || '',
    language: v.language || '',
    infoLink: volume.selfLink || '',
    resourceUrl: volume.selfLink || '',
  }
}

export async function searchByBarcode(isbn) {
  const clean = cleanIsbn(isbn)
  const data = await booksFetch('/volumes', { q: `isbn:${clean}` })
  return (data.items || []).slice(0, 10).map((vol) => toBookItem(vol, clean))
}

export async function searchByText(query) {
  const data = await booksFetch('/volumes', { q: query, maxResults: 20 })
  return (data.items || []).map((vol) => toBookItem(vol, ''))
}

export async function getBookDetail(googleBooksId) {
  const data = await booksFetch(`/volumes/${encodeURIComponent(googleBooksId)}`)
  return {
    description: data.volumeInfo?.description || '',
    pageCount: data.volumeInfo?.pageCount || '',
  }
}
