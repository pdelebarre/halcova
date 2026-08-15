import { getAccessCode } from '../utils/session'
import { proxyCoverUrl } from '../utils/cover'

// Record lookups go through the server-side Discogs proxy, which owns the
// single Discogs token, sends the User-Agent, and caches responses in Blobs.
// The browser never stores or sends a token — requests authenticate with the
// signed-in user's access code.
const FN_BASE = '/.netlify/functions/discogs'

const ERROR_MESSAGES = {
  SERVER_NO_TOKEN: "Lookups aren't configured yet — tell the owner to set the Discogs token.",
  BAD_TOKEN: 'Discogs token rejected.',
  RATE_LIMIT: 'Discogs rate limit hit — wait a moment and try again.',
  HTTP_ERROR: 'Discogs request failed.',
}

function authHeaders() {
  const code = getAccessCode()
  return code ? { Authorization: `Bearer ${code}` } : {}
}

async function discogsFetch(action, params = {}) {
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
    const err = new Error(ERROR_MESSAGES[code] || `Discogs request failed (${res.status})`)
    err.code = code
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

// Discogs reports the community rating two ways: search results carry
// `community.rating` (0–5) + `community.rating_count`; release details nest
// them as `community.rating.{average,count}`. Normalize both to the shared
// `rating` / `ratingCount` fields, omitting them when absent (0 = no votes).
function communityRating(community) {
  const c = community || {}
  const nested = (c.rating && typeof c.rating === 'object') ? c.rating : null
  const average = typeof c.rating === 'number' ? c.rating : nested?.average
  const count = Number.isInteger(c.rating_count) ? c.rating_count : nested?.count
  const out = {}
  if (typeof average === 'number' && average > 0) out.rating = average
  if (Number.isInteger(count) && count > 0) out.ratingCount = count
  return out
}

export async function searchByBarcode(barcode) {
  const clean = cleanBarcode(barcode)
  const data = await discogsFetch('searchBarcode', { barcode: clean })
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
    coverImage: proxyCoverUrl(FN_BASE, r.cover_image || r.thumb),
    resourceUrl: r.resource_url,
    barcode: clean,
    ...communityRating(r.community),
  }))
}

export async function searchByText(query) {
  const data = await discogsFetch('searchText', { q: query })
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
    coverImage: proxyCoverUrl(FN_BASE, r.cover_image || r.thumb),
    resourceUrl: r.resource_url,
    barcode: '',
    ...communityRating(r.community),
  }))
}

export async function getReleaseDetail(discogsId) {
  const data = await discogsFetch('release', { id: discogsId })
  return {
    tracklist: (data.tracklist || []).map((t) => ({
      position: t.position,
      title: t.title,
      duration: t.duration,
    })),
    notes: data.notes || '',
    images: (data.images || []).map((i) => i.resource_url),
    ...communityRating(data.community),
  }
}
