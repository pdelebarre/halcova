// lookup-queue-drain.js — T6 deferred-enrichment scheduled drain (#285).
//
// Netlify @hourly scheduled function that completes items saved with partial
// metadata: it claims each tenant's DUE rows from the lookup queue, re-runs the
// SSRF-safe fixed-host provider lookup, and idempotently merges ONLY the
// missing fields into the item (never clobbering a user's edits), then stamps
// enrichedAt + clears metadataPending.
//
// Security gate (#285 — the Security Auditor's review):
//   * SERVICE IDENTITY: this function never carries a client session; it runs
//     under the function's service principal. It iterates tenants ONE AT A TIME
//     (listPendingUsers -> claimDue(userId)); every queue op and item merge is
//     owner-scoped, so a drain for user A can NEVER touch user B.
//   * The queue is NEVER echoed to a client: no request handler, no response
//     body carries queue rows — only a short internal summary.
//   * SSRF: lookups are re-triggered ONLY through lookupQueuePayload's fixed
//     provider base URLs via the SSRF-safe lookupFetch (redirect:'manual',
//     capped body, fixed hosts). No arbitrary-host fetch is ever introduced.
//   * safeError integrity: drain outcomes are aggregated as counters; the raw
//     provider/queue internals, keys and payloads never leak into any error.
//
// Deploys as a scheduled function via vite-plugin-netlify-functions / the
// `config.schedule` export (Netlify scheduled-function convention).

import { getRepository } from './_shared/repository'
import { drain } from './_shared/lookup-queue'
import { lookupFetch } from './_shared/lookup-fetch'

export const config = { schedule: '@hourly' }

// The fixed, allow-listed provider base hosts the drain may re-fetch (SSRF
// control — never derived from client input, never arbitrary).
const FIXED_BASES = {
  discogs: 'https://api.discogs.com',
  musicbrainz: 'https://musicbrainz.org',
  books: 'https://www.googleapis.com',
  openlibrary: 'https://openlibrary.org',
}

// Resolve a queued row's lookup to enrichment data. `lookupFetch` enforces
// redirect:'manual' + a body cap and hits ONLY the fixed base for the queued
// provider. On any uncertainty (missing token, error, empty) we return
// { ok:false } so the row backs off and is never half-merged.
function providerLookupFor(row) {
  const payload = row.payload || {}
  const provider = payload.provider
  const base = FIXED_BASES[provider]
  const action = payload.action
  if (!base) {
    return { ok: false, permanent: true, error: 'UNKNOWN_PROVIDER' }
  }

  let path
  try {
    if (action === 'barcode' || action === 'isbn' || action === 'searchBarcode') {
      const q = encodeURIComponent(payload.barcode || payload.key?.split(':').slice(1).join(':') || '')
      if (provider === 'books') path = `/books/v1/volumes?q=${q}`
      else path = `/database/search?q=${q}&type=release`
    } else if (payload.q) {
      const q = encodeURIComponent(payload.q)
      if (provider === 'books') path = `/books/v1/volumes?q=${q}`
      else path = `/database/search?q=${q}&type=release`
    } else {
      // We hold no re-triggerable key — don't invent a call.
      return { ok: false, permanent: true, error: 'NO_RETRIGGER_KEY' }
    }
  } catch {
    return { ok: false, permanent: true, error: 'BAD_PAYLOAD' }
  }

  return runFixedLookup(base + path)
}

async function runFixedLookup(url) {
  try {
    const res = await lookupFetch(url, { headers: {} })
    if (!res.ok) return { ok: false, permanent: res.status >= 400 && res.status < 500, error: `HTTP_${res.status}` }
    const raw = await res.json()
    const results = raw.results || raw.items
    const hit = Array.isArray(results) ? results[0] : raw
    if (!hit) return { ok: false, permanent: true, error: 'EMPTY' }
    return { ok: true, data: normalizeHit(hit) }
  } catch {
    return { ok: false, error: 'LOOKUP_ERROR' }
  }
}

// Minimal, defensive normalization to the shared item shape. Only maps stable
// top-level fields; unknown/absent fields are simply left for the merge to
// skip. Deliberately conservative — the merge only fills MISSING fields, so a
// sparse normalization can never clobber user data.
function genreOf(hit) {
  if (Array.isArray(hit.genres)) return hit.genres
  if (hit.genre) return [hit.genre]
  return undefined
}

function normalizeHit(hit) {
  const yearSource = hit.year || (hit.volumeInfo?.publishedDate || '').slice(0, 4)
  return {
    title: hit.title || hit.volumeInfo?.title,
    year: yearSource ? Number(yearSource) || undefined : undefined,
    label: hit.labels?.[0]?.name || hit.label?.[0],
    genre: genreOf(hit),
    coverImage: hit.cover_image || (Array.isArray(hit.images) && hit.images[0]) || hit.thumbnail,
    formatType: hit.format?.[0]?.name || hit.major_formats?.[0],
  }
}

// Return a reporter that produces a short service-only summary.
export function drainSummary(repo, options) {
  return drain({ queue: repo.lookupQueue, items: repo.items, lookup: providerLookupFor }, options)
}

export async function handler() {
  const repo = getRepository()
  try {
    const summary = await drain({ queue: repo.lookupQueue, items: repo.items, lookup: providerLookupFor })
    return { statusCode: 200, body: { ok: true, summary } }
  } catch {
    // Never leak internals: return a counter-only summary, no error text.
    return { statusCode: 500, body: { ok: false, summary: { processed: 0, enriched: 0, failed: 0, abandoned: 0 } } }
  }
}
