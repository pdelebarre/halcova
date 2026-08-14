// Denormalized owned-count for the free-tier plan cap (T3, ADR-0002 Phase 0).
// The cap used to scan every `item:<id>` blob on each POST; now each store
// keeps a single `count:owned` key that POST/PUT/DELETE maintain, so the cap
// check is one blob read.
//
// No transactions in Netlify Blobs: the count is written with the same
// read-compare-write discipline as the index (ADR-0001). Invariant: the key,
// when present, is accurate. A missing key means "not denormalized yet" —
// adjustOwnedCount returns early without creating one, and the next capped
// POST lazily backfills from the then-current index (which already reflects
// any skipped mutations), so the count can never go negative or drift wrong.
// The pure transition logic below is unit-tested in isolation.

export const OWNED_COUNT_KEY = 'count:owned'

// Pure: is an item an OWNED item (not a wishlist "want")? Wishlist items never
// consume the cap.
export const isOwned = (item) => !item?.wishlist

// Pure: count OWNED (non-wishlist) items — the exact same predicate the old
// full-scan cap used.
export function ownedCountOf(items) {
  return (items || []).filter(Boolean).filter(isOwned).length
}

// Pure: next count after applying a delta, clamped at zero.
export function nextOwnedCount(current, delta) {
  return Math.max(0, (Number(current) || 0) + delta)
}

// Pure: given the existing item and a PUT patch, does the patch flip an item
// between owned and wishlist, and by how much does the owned count change?
//   { delta: 0, toggled: false } — patch doesn't touch `wishlist`
//   { delta: 0, toggled: true  } — `wishlist` set to the same value (no-op)
//   { delta: -1, toggled: true } — owned → wishlist (count drops)
//   { delta: +1, toggled: true } — wishlist → owned (count rises)
export function wishlistToggleDelta(patch, existing) {
  const patchObj = patch || {}
  if (!Object.prototype.hasOwnProperty.call(patchObj, 'wishlist')) {
    return { delta: 0, toggled: false }
  }
  const wasOwned = isOwned(existing)
  const nowOwned = isOwned({ wishlist: patchObj.wishlist })
  if (wasOwned === nowOwned) return { delta: 0, toggled: true }
  return { delta: wasOwned ? -1 : 1, toggled: true }
}

// Read the denormalized count, or null when the store has never had one
// (pre-Phase-0 data, or a store that only ever saw unlimited users).
export async function readOwnedCount(store) {
  try {
    const count = await store.get(OWNED_COUNT_KEY, { type: 'json' })
    return count == null ? null : Number(count) || 0
  } catch {
    return null
  }
}

// Backfill the count from the index once (a one-time O(n) cost), then return
// it. `readIndex` is injected so this module stays free of @netlify/blobs
// imports (testable with a fake store). A failed backfill propagates — the
// caller's existing error path returns a 500, exactly like the old cap scan.
export async function ensureOwnedCount(store, readIndex) {
  const existing = await readOwnedCount(store)
  if (existing != null) return existing
  const ids = await readIndex(store)
  const items = await Promise.all(ids.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })))
  const owned = ownedCountOf(items)
  try {
    await store.setJSON(OWNED_COUNT_KEY, owned)
  } catch { /* best-effort */ }
  return owned
}

// Apply `delta` (+1/-1) to the count, but ONLY when the key already exists —
// a missing key means "not denormalized yet", and the next capped POST will
// lazily backfill from the then-current index (which already reflects this
// mutation), so skipping keeps the count correct without ever going negative.
export async function adjustOwnedCount(store, delta) {
  if (!delta) return null
  const current = await readOwnedCount(store)
  if (current == null) return null
  const next = nextOwnedCount(current, delta)
  try {
    await store.setJSON(OWNED_COUNT_KEY, next)
  } catch { /* best-effort */ }
  return next
}
