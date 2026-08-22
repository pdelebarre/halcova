// activities-repo.js — Postgres activities repository (FEAT-8.2, #327).
//
// Activities are the source of truth for the collector activity feed. Each
// activity records a member action (add_item, complete_collection,
// showcase_update, profile_update) with a type-specific JSONB payload
// containing ONLY C1 public metadata — no price, location, serial, notes,
// receipts, or borrower contact ever leaks into activity payloads.

import { randomUUID } from 'node:crypto'

const COLUMNS = `id, user_id, type, data, created_at`

const ACTIVITY_TYPES = new Set([
  'add_item',
  'complete_collection',
  'showcase_update',
  'profile_update',
])

function toActivity(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {}),
    createdAt: row.created_at ? (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at) : null,
  }
}

export function createActivitiesRepo(db) {
  // Log an activity. Returns the created activity row.
  // `type` must be one of the allowed types; unknown types are rejected.
  // `data` must contain only C1 public metadata.
  async function logActivity(userId, type, data = {}) {
    if (!userId) return null
    if (!ACTIVITY_TYPES.has(type)) return null
    const id = randomUUID()
    const { rows } = await db.query(
      `INSERT INTO activities (id, user_id, type, data)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [id, userId, type, JSON.stringify(data)],
    )
    return toActivity(rows[0])
  }

  // Get activities by user id (profile activity list). Paginated with
  // cursor-based pagination (created_at DESC).
  async function getActivitiesByUser(userId, { limit = 20, before } = {}) {
    if (!userId) return { items: [], nextCursor: null, hasMore: false }
    const params = [userId]
    let cursorClause = ''
    if (before) {
      params.push(before)
      cursorClause = 'AND created_at < $2'
    }
    params.push(limit + 1)
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM activities
       WHERE user_id = $1 ${cursorClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    )
    const items = rows.map(toActivity)
    const hasMore = items.length > limit
    if (hasMore) items.pop()
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : null,
      hasMore,
    }
  }

  // Get the feed for a set of followed user ids. Returns activities from those
  // users, ordered by created_at DESC. The caller is responsible for filtering
  // results through authorization (visibility, blocks) before returning them
  // to the viewer.
  async function getFeed(followedUserIds, { limit = 30, before } = {}) {
    if (!followedUserIds || followedUserIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false }
    }
    const placeholders = followedUserIds.map((_, i) => `$${i + 1}`).join(', ')
    const params = [...followedUserIds]
    let cursorClause = ''
    if (before) {
      params.push(before)
      cursorClause = `AND created_at < $${params.length}`
    }
    params.push(limit + 1)
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM activities
       WHERE user_id IN (${placeholders}) ${cursorClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    )
    const items = rows.map(toActivity)
    const hasMore = items.length > limit
    if (hasMore) items.pop()
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : null,
      hasMore,
    }
  }

  // Delete activities older than a given timestamp (for cleanup/TTL).
  async function deleteOlderThan(timestamp) {
    if (!timestamp) return 0
    const { rowCount } = await db.query(
      `DELETE FROM activities WHERE created_at < $1`,
      [timestamp],
    )
    return rowCount || 0
  }

  return {
    logActivity,
    getActivitiesByUser,
    getFeed,
    deleteOlderThan,
    ACTIVITY_TYPES,
  }
}