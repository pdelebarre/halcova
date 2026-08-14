// Build the proxied cover URL for a normalized item's coverImage (T6,
// ADR-0002 Phase 0). Covers are re-hosted through the lookup functions so the
// PWA can cache them CacheFirst without depending on 3rd-party hosts.
//
// The server is authoritative for which hosts are allowed (see
// netlify/functions/_shared/cover.js) — this client helper only guards the
// basics so a bad cover never crashes a render or leaks an arbitrary URL into
// an <img>: missing / malformed / non-https covers are dropped to ''.
export function proxyCoverUrl(fnPath, cover) {
  if (!cover) return ''
  let parsed
  try {
    parsed = new URL(cover)
  } catch {
    return ''
  }
  if (parsed.protocol !== 'https:') return ''
  const proxy = new URL(fnPath, window.location.origin)
  proxy.searchParams.set('action', 'cover')
  proxy.searchParams.set('url', cover)
  return proxy.pathname + proxy.search
}
