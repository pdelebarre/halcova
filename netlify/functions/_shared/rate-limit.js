// Dependency-free rate limiting for the functions layer (T5, ADR-0002 Phase 0).
// The pure window math lives here so it's unit-testable; the Blob-backed
// counter takes a store as an argument (this module never imports
// @netlify/blobs).
//
// Design: a fixed-window counter. The window index lives in the VALUE
// (`{ w, count }`), NOT the key, so each identity keeps exactly one blob key
// per scope — no per-window garbage accumulating in the store. When the
// window rolls, nextCounter sees a stale `w` and resets the count. The
// read-compare-write is best-effort (Blobs has no transactions) — under heavy
// concurrency a few extra requests can slip through, which is acceptable for
// Phase 0 and kept simple + reversible.

export const RATE_LIMIT_WINDOW_MS = 60_000
export const DEFAULT_RATE_LIMIT = 60

// Key for an identity's counter in `scope`. Identity is a user id, or a
// normalized code/email/IP where no user record exists yet.
export function rateLimitKey(scope, identity) {
  return `rl:${scope}:${identity}`
}

// The fixed window index a timestamp falls in.
export function windowIndex(now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS) {
  return Math.floor(now / windowMs)
}

// Seconds until the current fixed window rolls over (for Retry-After).
export function retryAfterSeconds(now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS) {
  const nextBoundary = (windowIndex(now, windowMs) + 1) * windowMs
  return Math.max(1, Math.ceil((nextBoundary - now) / 1000))
}

// Pure: advance the counter for `entry` in the current window. A counter from
// a previous window resets (its `w` is stale), so limits automatically reset
// each window without any cleanup.
export function nextCounter(entry, now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS) {
  const w = windowIndex(now, windowMs)
  const count = entry && entry.w === w ? (Number(entry.count) || 0) : 0
  return { w, count: count + 1 }
}

// Read-increment-write a counter. `limit` requests per window are allowed;
// the (limit+1)-th is rejected with a Retry-After hint. A failed read/write
// never throws — the limiter degrades to letting the request through.
export async function consume(store, key, limit, now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS) {
  let entry = null
  try {
    entry = (await store.get(key, { type: 'json' })) || null
  } catch {
    entry = null
  }
  const next = nextCounter(entry, now, windowMs)
  if (next.count > limit) return { limited: true, retryAfter: retryAfterSeconds(now, windowMs) }
  try {
    await store.setJSON(key, next)
  } catch { /* best-effort */ }
  return { limited: false }
}

// Fixed-window DISTINCT-item counter: like consume, but counts unique `item`
// values touched in the window instead of raw events — used to cap how many
// DIFFERENT things one identity can reach per window (e.g. how many releases a
// member opens a review thread on). Repeating an already-tracked item never
// advances the counter, so editing what you already touched stays free. Same
// fixed-window reset + best-effort read/write semantics as consume.
export async function consumeDistinct(store, key, item, limit, now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS) {
  let entry = null
  try {
    entry = (await store.get(key, { type: 'json' })) || null
  } catch {
    entry = null
  }
  const w = windowIndex(now, windowMs)
  const items = entry && entry.w === w && Array.isArray(entry.items) ? entry.items : []
  if (items.includes(item)) return { limited: false } // already tracked this window
  if (items.length >= limit) return { limited: true, retryAfter: retryAfterSeconds(now, windowMs) }
  try {
    await store.setJSON(key, { w, items: [...items, item] })
  } catch { /* best-effort */ }
  return { limited: false }
}

// Build a per-scope limiter bound to a blob store; call it with the identity.
export function createRateLimiter({ store, scope, limit = DEFAULT_RATE_LIMIT, windowMs = RATE_LIMIT_WINDOW_MS }) {
  return (identity, now = Date.now()) => consume(store, rateLimitKey(scope, identity), limit, now, windowMs)
}

// Client IP for per-IP limits (the real brute-force defense). Netlify sets
// `x-nf-client-connection-ip`; x-forwarded-for is the usual fallback. Returns
// '' when no header is present (callers skip the limit then).
export function clientIp(req) {
  const nf = req?.headers?.get?.('x-nf-client-connection-ip')
  if (nf) return nf.trim()
  const fwd = req?.headers?.get?.('x-forwarded-for')
  if (fwd) return String(fwd).split(',')[0].trim()
  return ''
}

// Identity to key a per-user limit on. Members/owner use their user id; the
// shared demo identity is keyed by client IP so one demo visitor can't
// throttle every other demo visitor (and a burst of demo traffic doesn't all
// share a single bucket). '' means "no identity to limit on" — callers skip.
export function rateLimitIdentity(user, req) {
  if (user?.role === 'demo') return clientIp(req)
  return user?.id || ''
}
