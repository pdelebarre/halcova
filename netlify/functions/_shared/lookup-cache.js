// lookup-cache.js — shared read-through cache seam for discogs.js / books.js
// (ADR-0002 Phase 1, Part B). Replaces the Blob-only `discogs-cache` /
// `books-cache` reads with a DB-first `lookup_cache` read when Postgres is
// configured, falling back to the legacy Blobs cache on a miss or error, and
// writing through to BOTH (best-effort) so the legacy Blob stores stay complete
// for the read-through fallback and for rollback.
//
// TTL semantics are preserved exactly: discogs.js/books.js pass the same
// per-action TTLs as before (barcode/isbn/release/detail 30d, text q 1d). On
// the DB the TTL is a real `expires_at` column (repo.get filters on it); on
// Blobs the `{ ts, data }` age check is kept.
//
// Cover caching (`cover:…`) deliberately stays Blobs-only — it caches binary
// images, not provider JSON, and is fine at this scale (see db/README.md).

import { getStore } from '@netlify/blobs'
import { isPostgresConfigured } from './postgres'
import { getRepository } from './repository'

// The legacy shared Blob store per provider.
const BLOB_STORES = { discogs: 'discogs-cache', books: 'books-cache' }

// ---------------------------------------------------------------------------
// RES-1.4 T4 (#291) — negative caching.
//
// When a provider returns a HEALTHY-EMPTY result (200 + zero results), we cache
// a sentinel under (provider, key) so subsequent identical lookups skip the
// empty provider call within the (shorter) negative-cache TTL and fall straight
// through to the fallback provider. The sentinel is a real object `{ empty:true }`
// — it can never collide with a real Discogs `{ results }` or Google
// `{ items }` envelope. The lookup chains treat it as "no match here" (falls
// through to the fallback), NOT as a failure and NEVER as a real result.
//
// Negative empties live in the SAME lookup_cache under (provider, key),
// reusing writeCache -> DB + Blobs write-through, so the read-through contract
// is preserved exactly. They carry a deliberately SHORTER TTL than the positive
// caches because an empty result reflects "no known match today", which changes
// as new records/books are published.
// ---------------------------------------------------------------------------
export const EMPTY_SENTINEL = Object.freeze({ empty: true })

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// The actions with a fallback chain (searchBarcode / searchText) drive the
// negative-cache TTL: barcode/ISBN keys barely change and are re-scanned rarely
// -> 1 day. Free-text `q` results churn as new releases/volumes publish -> 6h.
// Any other action falls back to the shorter 6h window (not used in practice).
export function emptyCacheTtlMs(action) {
  if (action === 'searchBarcode' || action === 'barcode' || action === 'isbn') {
    return DAY
  }
  return 6 * HOUR
}

// Best-effort write of a negative-cache sentinel (healthy-empty result) for a
// provider lookup key. Reuses the shared writeCache so it lands in BOTH the DB
// (lookup_cache) and the legacy Blob store — contract preserved — with the
// shorter empty TTL. A failed write must never fail a successful lookup.
export async function writeEmptyCache(provider, key, action) {
  return writeCache(provider, key, EMPTY_SENTINEL, emptyCacheTtlMs(action))
}

// Read a provider key and report whether its cached value is the negative-cache
// sentinel (a HEALTHY-EMPTY result). Used by the lookup chains to skip an empty
// provider call within the empty TTL. A failed/expired read is treated as NOT
// negative-cached so a suppression can never silently wedge a lookup.
export async function isNegativeCached(provider, key, action) {
  try {
    const data = await readCache(provider, key, emptyCacheTtlMs(action))
    return data?.empty === true
  } catch {
    return false
  }
}

// Read a cached provider payload, DB-first when Postgres is configured, Blobs
// otherwise. Returns the raw payload or null on a miss / expired / error.
// A failed read is always a miss — it must never fail a valid lookup.
export async function readCache(provider, key, ttlMs) {
  if (isPostgresConfigured()) {
    try {
      const data = await getRepository().lookupCache.get(provider, key)
      // repo.get() already filters `expires_at > now()`, so a non-null row is fresh.
      if (data != null) return data
    } catch {
      // DB unreachable/errored — fall through to the Blobs cache.
    }
  }
  return readBlobCache(provider, key, ttlMs)
}

// Best-effort write-through: always mirror to the legacy Blob store (keeps the
// read-through fallback + rollback intact) and, when Postgres is configured,
// also to the lookup_cache table with a real expiry. A failed write must never
// fail a successful lookup.
export async function writeCache(provider, key, data, ttlMs) {
  try {
    const store = getStore(BLOB_STORES[provider])
    await store.setJSON(key, { ts: Date.now(), data })
  } catch {
    // ignore
  }
  if (isPostgresConfigured()) {
    try {
      await getRepository().lookupCache.set(provider, key, data, new Date(Date.now() + ttlMs))
    } catch {
      // ignore
    }
  }
}

// The legacy Blob read: `{ ts, data }` with the same age check discogs/books
// used pre-Phase-1.
async function readBlobCache(provider, key, ttlMs) {
  const store = getStore(BLOB_STORES[provider])
  let cached
  try {
    cached = await store.get(key, { type: 'json' })
  } catch {
    return null
  }
  if (cached && cached.data !== undefined && Date.now() - cached.ts < ttlMs) {
    return cached.data
  }
  return null
}
