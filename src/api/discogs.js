import { getUserId } from '../utils/session'

const BASE = 'https://api.discogs.com'
const USER_AGENT = 'RunoutRecordCollector/1.0'

// Each signed-in user has their own Discogs token (records lookups are
// personal). Keyed by user id so switching accounts never leaks a token.
function tokenKey() {
  return `runout_discogs_token_${getUserId() || 'local'}`
}

function getToken() {
  return localStorage.getItem(tokenKey()) || ''
}

export function hasToken() {
  return !!getToken()
}

export function setToken(token) {
  localStorage.setItem(tokenKey(), token.trim())
}

export function clearToken() {
  localStorage.removeItem(tokenKey())
}

async function discogsFetch(path, params = {}) {
  const token = getToken()
  if (!token) {
    const err = new Error('No Discogs token set')
    err.code = 'NO_TOKEN'
    throw err
  }
  const url = new URL(BASE + path)
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v) })
  url.searchParams.set('token', token)

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (res.status === 401) {
    const err = new Error('Discogs token was rejected. Check it in Settings.')
    err.code = 'BAD_TOKEN'
    throw err
  }
  if (res.status === 429) {
    const err = new Error('Discogs rate limit hit — wait a moment and try again.')
    err.code = 'RATE_LIMIT'
    throw err
  }
  if (!res.ok) {
    const err = new Error(`Discogs request failed (${res.status})`)
    err.code = 'HTTP_ERROR'
    throw err
  }
  return res.json()
}

// Barcodes with more than one internal space break Discogs' search — strip to digits.
function cleanBarcode(raw) {
  return String(raw).replace(/[^0-9Xx]/g, '')
}

function parseFormatType(formatArray) {
  const joined = (formatArray || []).join(' ').toLowerCase()
  if (joined.includes('cd')) return 'CD'
  if (joined.includes('cassette')) return 'Cassette'
  if (joined.includes('7"')) return '7"'
  if (joined.includes('12"')) return '12"'
  if (joined.includes('lp')) return 'LP'
  if (joined.includes('ep')) return 'EP'
  if (joined.includes('vinyl')) return 'LP'
  return 'Other'
}

export async function searchByBarcode(barcode) {
  const clean = cleanBarcode(barcode)
  const data = await discogsFetch('/database/search', { barcode: clean, type: 'release' })
  const results = data.results || []
  return results.map((r) => ({
    discogsId: r.id,
    discogsType: r.type,
    title: r.title, // "Artist - Release Title"
    year: r.year || '',
    label: (r.label && r.label[0]) || '',
    catno: r.catno || '',
    formatRaw: (r.format || []).join(', '),
    formatType: parseFormatType(r.format),
    genre: r.genre || [],
    style: r.style || [],
    country: r.country || '',
    coverImage: r.cover_image || r.thumb || '',
    resourceUrl: r.resource_url,
    barcode: clean,
  }))
}

export async function searchByText(query) {
  const data = await discogsFetch('/database/search', { q: query, type: 'release' })
  const results = data.results || []
  return results.slice(0, 20).map((r) => ({
    discogsId: r.id,
    discogsType: r.type,
    title: r.title,
    year: r.year || '',
    label: (r.label && r.label[0]) || '',
    catno: r.catno || '',
    formatRaw: (r.format || []).join(', '),
    formatType: parseFormatType(r.format),
    genre: r.genre || [],
    style: r.style || [],
    country: r.country || '',
    coverImage: r.cover_image || r.thumb || '',
    resourceUrl: r.resource_url,
    barcode: '',
  }))
}

export async function getReleaseDetail(discogsId) {
  const data = await discogsFetch(`/releases/${discogsId}`)
  return {
    tracklist: (data.tracklist || []).map((t) => ({
      position: t.position,
      title: t.title,
      duration: t.duration,
    })),
    notes: data.notes || '',
    images: (data.images || []).map((i) => i.resource_url),
  }
}
