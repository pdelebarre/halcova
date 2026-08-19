// lookup-queue-repo.js — Postgres deferred-enrichment queue (T6, #285).
//
// Mirror of the lookup-cache-repo factory pattern: `createLookupQueueRepo(db)`
// hands back { enqueue, claimDue, markDone, markFailed, abandon, countPending }
// backed by the `lookup_queue` table (migration 008_lookup_queue.sql), scoped
// to a single `user_id` in EVERY statement.
//
// Tenant-isolation contract (SEC-EPIC-2, #190):
//   * Every method scopes its WHERE/INSERT by `user_id` — a drain for user A
//     can claim/enqueue/complete ONLY user A's rows.
//   * The matching RLS policy (db/rls/009_lookup_queue_rls.sql) enforces the
//     same boundary at the DB layer.
//   * The queue is server/service-identity ONLY — no client-facing endpoint.
//
// `db` is any node-postgres-shaped object ({ query, connect }); tests inject
// pg-mem.

// A stable, server-assigned uuid for a queue row. `contentKey` is a digest of
// the provider lookup parameters (kind + lookup key) so re-enqueueing the SAME
// lookup for the SAME item is idempotent (an upsert, not a duplicate row),
// while distinct lookups/items stay distinct.
export function queueRowId(kind, itemId, contentKey) {
  return hashUuid(`${kind}|${itemId || ''}|${contentKey}`)
}

// Deterministic uuid-v4-format id from an arbitrary string (consistent hashing
// of the dedupe key so Postgres' uuid PK accepts it).
function hashUuid(input) {
  // 16 bytes -> uuid via a simple FNV-1a over the bytes (deterministic).
  const bytes = new Uint8Array(16)
  const src = Buffer.from(String(input), 'utf8')
  let h = 0x811c9dc5
  for (const byte of src) {
    h ^= byte
    h = (h * 0x01000193) >>> 0
  }
  bytes[0] = (h >>> 24) & 0xff
  bytes[1] = (h >>> 16) & 0xff
  bytes[2] = (h >>> 8) & 0xff
  bytes[3] = h & 0xff
  // Distribute the remaining bytes deterministically.
  for (let i = 0; i < 12; i++) {
    bytes[4 + i] = (src[(i * 7 + 5) % Math.max(1, src.length)] || 0) ^ ((h + i * 31) & 0xff)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function createLookupQueueRepo(db) {
  // Enqueue a lookup for later completion. Idempotent on (id): re-enqueueing
  // the same lookup+item resets attempts and moves next_at up (never
  // duplicates). `status` returns to 'pending' if a done/abandoned row is
  // re-enqueued (a user re-looking-up later is a fresh chance).
  async function enqueue({ user_id: userId, kind, item_id: itemId, payload, key, nextAt }) {
    const id = queueRowId(kind, itemId, key)
    const at = nextAt instanceof Date ? nextAt : new Date()
    await db.query(
      `INSERT INTO lookup_queue (id, user_id, kind, status, attempts, next_at, payload, item_id, updated_at)
       VALUES ($1, $2, $3, 'pending', 0, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         status = 'pending', attempts = 0, next_at = EXCLUDED.next_at,
         payload = EXCLUDED.payload, item_id = EXCLUDED.item_id, updated_at = now()`,
      [id, userId, kind, at, JSON.stringify(payload), itemId || null],
    )
    return id
  }

  // Claim the next `limit` DUE rows for ONE tenant (status 'pending' and
  // next_at <= now()), oldest first. Scoped by user_id so a drain for user A
  // can never see user B's rows.
  async function claimDue(userId, limit = 10) {
    const { rows } = await db.query(
      `SELECT id, kind, payload, item_id, attempts, next_at
       FROM lookup_queue
       WHERE user_id = $1 AND status = 'pending' AND next_at <= now()
       ORDER BY next_at ASC
       LIMIT $2`,
      [userId, Math.max(1, Math.min(Number(limit) || 10, 100))],
    )
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: r.payload,
      item_id: r.item_id,
      attempts: r.attempts,
      next_at: r.next_at,
    }))
  }

  // Mark a row successfully completed (resets attempts, clears the payload
  // error). Scoped by user_id.
  async function markDone(userId, id) {
    await db.query(
      `UPDATE lookup_queue SET status = 'done', enriched_at = now(), last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND id = $2`,
      [userId, id],
    )
  }

  // Register a failure: bump attempts, schedule the next attempt at nextAt.
  // `abandon = true` flips the row to 'abandoned' (never retried again). The
  // caller enforces the 5-attempt / 7-day caps; `permanent` rows are failed
  // once then abandoned.
  async function markFailed(userId, id, { nextAt, abandon = false, error }) {
    const at = nextAt instanceof Date ? nextAt : new Date()
    await db.query(
      `UPDATE lookup_queue
       SET attempts = attempts + 1, next_at = $3, updated_at = now(),
           last_error = $4,
           status = CASE WHEN $5 THEN 'abandoned' ELSE status END
       WHERE user_id = $1 AND id = $2`,
      [userId, id, at, error || null, abandon],
    )
  }

  // The distinct tenants with any pending/due work — used by the @hourly drain
  // to iterate one tenant at a time (never crossing a user_id boundary).
  async function listPendingUsers() {
    const { rows } = await db.query(
      `SELECT DISTINCT user_id FROM lookup_queue WHERE status = 'pending'`,
    )
    return rows.map((r) => r.user_id)
  }

  // Count pending rows for a tenant (0 when none). Used by tests and by the
  // drain's per-tenant loop to skip tenants with no due work.
  async function countPending(userId) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS count FROM lookup_queue
       WHERE user_id = $1 AND status = 'pending'`,
      [userId],
    )
    return rows[0]?.count || 0
  }

  return { enqueue, claimDue, markDone, markFailed, listPendingUsers, countPending }
}
