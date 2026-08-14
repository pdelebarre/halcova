// Short-TTL per-user cache for GET /collection (T4, ADR-0002 Phase 0) so
// repeat reads don't re-fetch every `item:<id>` blob. Netlify Blobs has no
// native expiry, so entries carry `{ ts, items }` and are judged stale by
// wall-clock age (isCacheFresh). Every write (POST/PUT/DELETE) invalidates
// the key write-through. All I/O is best-effort — a failed cache read or
// write must never fail a request.

export const LIST_CACHE_KEY = 'cache:list'
export const LIST_CACHE_TTL_MS = Number(process.env.RUNOUT_LIST_CACHE_TTL) || 15_000

// Pure: is a cached entry fresh at `now` given the TTL?
export function isCacheFresh(entry, now = Date.now(), ttlMs = LIST_CACHE_TTL_MS) {
  return !!(entry && Array.isArray(entry.items) && typeof entry.ts === 'number' && now - entry.ts < ttlMs)
}

export async function readListCache(store, ttlMs = LIST_CACHE_TTL_MS) {
  try {
    const entry = await store.get(LIST_CACHE_KEY, { type: 'json' })
    return isCacheFresh(entry, Date.now(), ttlMs) ? entry.items : null
  } catch {
    return null
  }
}

export async function writeListCache(store, items) {
  try {
    await store.setJSON(LIST_CACHE_KEY, { ts: Date.now(), items })
  } catch { /* best-effort */ }
}

export async function invalidateListCache(store) {
  try {
    await store.delete(LIST_CACHE_KEY)
  } catch { /* best-effort */ }
}
