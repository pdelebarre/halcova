// follows-repo.js — Postgres follows repository (FEAT-8.2, #327).
//
// Each row records a follow relationship: follower_id → followed_id of type
// 'user' or 'collection'. The UNIQUE constraint on (follower_id, followed_id,
// followed_type) makes follow/unfollow naturally idempotent — a second follow
// is a no-op INSERT ON CONFLICT DO NOTHING, and unfollow always succeeds.

import { randomUUID } from 'node:crypto'

const COLUMNS = `id, follower_id, followed_id, followed_type, created_at`

function toFollow(row) {
  if (!row) return null
  return {
    id: row.id,
    followerId: row.follower_id,
    followedId: row.followed_id,
    followedType: row.followed_type,
    createdAt: row.created_at ? (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at) : null,
  }
}

function toIso(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function createFollowsRepo(db) {
  // Follow a target (user or collection). Idempotent: if the follow already
  // exists, returns the existing row rather than erroring.
  async function follow(followerId, followedId, followedType = 'user') {
    if (!followerId || !followedId) return null
    const id = randomUUID()
    const { rows } = await db.query(
      `INSERT INTO follows (id, follower_id, followed_id, followed_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (follower_id, followed_id, followed_type) DO UPDATE
         SET id = follows.id  -- no-op: keep the existing row
       RETURNING ${COLUMNS}`,
      [id, followerId, followedId, followedType],
    )
    return toFollow(rows[0])
  }

  // Unfollow a target. Always succeeds (idempotent).
  async function unfollow(followerId, followedId, followedType = 'user') {
    if (!followerId || !followedId) return false
    const { rowCount } = await db.query(
      `DELETE FROM follows
       WHERE follower_id = $1 AND followed_id = $2 AND followed_type = $3`,
      [followerId, followedId, followedType],
    )
    return rowCount > 0
  }

  // Check if a follow relationship exists.
  async function isFollowing(followerId, followedId, followedType = 'user') {
    if (!followerId || !followedId) return false
    const { rows } = await db.query(
      `SELECT 1 FROM follows
       WHERE follower_id = $1 AND followed_id = $2 AND followed_type = $3
       LIMIT 1`,
      [followerId, followedId, followedType],
    )
    return rows.length > 0
  }

  // List who a member follows (their "following" list). Paginated with
  // cursor-based pagination (created_at DESC).
  async function listFollowing(followerId, { limit = 20, before } = {}) {
    if (!followerId) return { items: [], nextCursor: null, hasMore: false }
    const params = [followerId]
    let cursorClause = ''
    if (before) {
      params.push(before)
      cursorClause = 'AND created_at < $2'
    }
    params.push(limit + 1)
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM follows
       WHERE follower_id = $1 ${cursorClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    )
    const items = rows.map(toFollow)
    const hasMore = items.length > limit
    if (hasMore) items.pop()
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : null,
      hasMore,
    }
  }

  // List followers of a target. Paginated with cursor-based pagination.
  async function listFollowers(followedId, followedType = 'user', { limit = 20, before } = {}) {
    if (!followedId) return { items: [], nextCursor: null, hasMore: false }
    const params = [followedId, followedType]
    let cursorClause = ''
    if (before) {
      params.push(before)
      cursorClause = 'AND created_at < $3'
    }
    params.push(limit + 1)
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM follows
       WHERE followed_id = $1 AND followed_type = $2 ${cursorClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    )
    const items = rows.map(toFollow)
    const hasMore = items.length > limit
    if (hasMore) items.pop()
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : null,
      hasMore,
    }
  }

  // Get follower count for a target.
  async function followerCount(followedId, followedType = 'user') {
    if (!followedId) return 0
    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM follows
       WHERE followed_id = $1 AND followed_type = $2`,
      [followedId, followedType],
    )
    return Number(rows[0]?.count) || 0
  }

  // Get following count for a member.
  async function followingCount(followerId) {
    if (!followerId) return 0
    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM follows
       WHERE follower_id = $1`,
      [followerId],
    )
    return Number(rows[0]?.count) || 0
  }

  // Get the set of user_ids that `userId` follows (for feed querying).
  async function getFollowedUserIds(userId) {
    if (!userId) return []
    const { rows } = await db.query(
      `SELECT followed_id FROM follows
       WHERE follower_id = $1 AND followed_type = 'user'
       ORDER BY created_at DESC`,
      [userId],
    )
    return rows.map((r) => r.followed_id)
  }

  return {
    follow,
    unfollow,
    isFollowing,
    listFollowing,
    listFollowers,
    followerCount,
    followingCount,
    getFollowedUserIds,
  }
}