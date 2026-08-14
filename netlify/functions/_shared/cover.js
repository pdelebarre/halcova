// Cover-image re-hosting through the lookup functions (T6, ADR-0002 Phase 0):
// covers are served by the proxy so the PWA caches them CacheFirst without
// depending on 3rd-party hosts.
//
// Security: this is a PUBLIC, constrained image proxy — cover requests come
// from `<img>` tags, which can't send the access-code Authorization header, so
// the `cover` action is deliberately unauthenticated. The safety boundary is
// the EXPLICIT host allowlist + https-only + image-only content + a hard size
// cap. We never proxy arbitrary user-supplied URLs; anything off the allowlist
// is rejected with 400.
//
// This module is blob-free (stores are passed in) so the allowlist logic is
// unit-testable under node, matching the other Phase-0 pure modules.

import { createHash } from 'node:crypto'

// Reject anything bigger than 5 MiB — covers are small; a huge body is a
// sign of abuse or a misconfigured upstream.
export const COVER_MAX_BYTES = 5 * 1024 * 1024
// Abort slow upstreams so a stuck image can't hold a function warm.
export const COVER_TIMEOUT_MS = 8000
// Server-side shared-cache TTL (short, like the task requires): one user's
// cover fetch serves the next, but stale covers are never held long.
export const COVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// Cache-Control on the proxy response: the PWA's CacheFirst and the browser
// both hold a cover for at most a day.
export const COVER_CACHE_SECONDS = 24 * 60 * 60 // 1 day

// Hosts allowed to serve covers beyond the Discogs family. Discogs images live
// on i.discogs.com today (legacy: st./img./s.discogs.com) — the whole
// *.discogs.com domain is Discogs-controlled, so proxying it is safe. Google
// Books thumbnails come from books.google.com. The Amazon CDNs are allowed for
// metadata that historically pointed at them.
const EXTRA_COVER_HOSTS = new Set([
  'books.google.com',
  'images-na.ssl-images-amazon.com',
  'm.media-amazon.com',
])

export function isAllowedCoverHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase()
  // Exact-suffix match only — "i.discogs.com" is fine, "discogs.com.evil.com"
  // is not (the suffix must align on a dot boundary).
  if (host === 'discogs.com' || host.endsWith('.discogs.com')) return true
  return EXTRA_COVER_HOSTS.has(host)
}

export function isAllowedCoverUrl(raw) {
  if (!raw) return false
  let parsed
  try {
    parsed = new URL(String(raw))
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && isAllowedCoverHost(parsed.hostname)
}

// Blob keys are character/length restricted — hash the cover URL into a
// fixed-size hex digest (same pattern as the lookup cache keys).
export function coverCacheKey(url) {
  return `cover:${createHash('sha256').update(String(url)).digest('hex')}`
}

// Fetch a cover image with a hard size cap + timeout. Only image content is
// accepted. Returns { ok: true, body: ArrayBuffer, contentType } or an error
// shaped like the functions' `json` responses ({ status, body }).
export async function fetchCoverImage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS)
  try {
    // SSRF guard (H1): never follow redirects. `redirect: 'manual'` surfaces
    // any 3xx as the raw response, which we reject below — otherwise a 3xx
    // could point this PUBLIC proxy at an off-allowlist host. The allowlist
    // in handleCover only ever validates the INITIAL url, so the only url we
    // ever fetch must be that same allowlisted url. Legit CDN covers don't
    // redirect, so there is no legitimate redirect to support.
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal })
    if (res.status >= 300 && res.status < 400) {
      return { error: { status: 502, body: { error: 'Cover redirect not allowed.', code: 'HTTP_ERROR' } } }
    }
    if (!res.ok) {
      return { error: { status: 502, body: { error: 'Cover fetch failed.', code: 'HTTP_ERROR' } } }
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (!contentType.startsWith('image/')) {
      return { error: { status: 502, body: { error: 'Cover is not an image.', code: 'HTTP_ERROR' } } }
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > COVER_MAX_BYTES) {
      return { error: { status: 502, body: { error: 'Cover too large.', code: 'HTTP_ERROR' } } }
    }
    return { ok: true, body: buf, contentType }
  } catch {
    return { error: { status: 502, body: { error: 'Cover fetch failed.', code: 'HTTP_ERROR' } } }
  } finally {
    clearTimeout(timer)
  }
}

// Server-side cover cache (shared store, short TTL). Bodies are stored base64
// inside { ts, contentType, data } so TTL and bytes travel together. A failed
// read/write is a cache miss/no-op — never fails a request.
export async function readCachedCover(store, url) {
  try {
    const entry = await store.get(coverCacheKey(url), { type: 'json' })
    if (entry?.ts && Date.now() - entry.ts < COVER_CACHE_TTL_MS && entry?.contentType && entry?.data) {
      return entry
    }
  } catch {
    // cache miss
  }
  return null
}

export async function writeCachedCover(store, url, contentType, body) {
  try {
    await store.setJSON(coverCacheKey(url), {
      ts: Date.now(),
      contentType,
      data: Buffer.from(body).toString('base64'),
    })
  } catch {
    // best-effort
  }
}

// The public cover handler shared by the discogs and books functions. Returns
// the proxied image with the upstream Content-Type and a short Cache-Control,
// or a JSON error (400 for a disallowed URL, 502 for upstream failure).
export async function handleCover(searchParams, store) {
  const raw = searchParams?.get?.('url')
  if (!isAllowedCoverUrl(raw)) {
    return new Response(JSON.stringify({ error: 'Cover URL not allowed.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const cached = await readCachedCover(store, raw)
  if (cached) return coverResponse(cached.contentType, Buffer.from(cached.data, 'base64'))

  const result = await fetchCoverImage(raw)
  if (result.error) {
    return new Response(JSON.stringify(result.error.body), {
      status: result.error.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeCachedCover(store, raw, result.contentType, result.body)
  return coverResponse(result.contentType, result.body)
}

export function coverResponse(contentType, body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Short cache: covers change rarely, but we'd rather serve a slightly
      // stale cover than hold one forever. The PWA CacheFirst respects this.
      'Cache-Control': `public, max-age=${COVER_CACHE_SECONDS}`,
    },
  })
}
