// lookup-cache-repo.js — Postgres lookup-response cache for the Phase 1 data
// layer (ADR-0002). Replaces the `discogs-cache` / `books-cache` Blob stores
// with a (provider, key) → jsonb row carrying a real `expires_at` TTL.
//
// Part A implements + tests the repository so it's ready; discogs.js / books.js
// keep using Blobs until Part B flips them over (see the report). The TTL
// semantics match Phase 0 exactly: the Blob path stored `{ ts, data }` and
// served it while `now - ts < ttl`; here `expires_at = now + ttl` and `get()`
// returns null once it has passed.

function toDate(value) {
  if (value instanceof Date) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function createLookupCacheRepo(db) {
  // Returns the cached payload, or null on a miss or an expired entry.
  async function get(provider, key) {
    const { rows } = await db.query(
      `SELECT data FROM lookup_cache
       WHERE provider = $1 AND key = $2 AND expires_at > now()
       LIMIT 1`,
      [provider, key],
    )
    return rows.length ? rows[0].data : null
  }

  // Upsert a payload with an absolute expiry (Date or ISO/ms).
  async function set(provider, key, data, expiresAt) {
    const at = toDate(expiresAt)
    if (!at) throw new Error('lookupCache.set requires a valid expiresAt')
    await db.query(
      `INSERT INTO lookup_cache (provider, key, data, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, key) DO UPDATE SET
         data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [provider, key, JSON.stringify(data), at],
    )
  }

  return { get, set }
}
