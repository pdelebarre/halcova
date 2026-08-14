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
