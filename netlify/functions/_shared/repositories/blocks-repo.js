// blocks-repo.js — Postgres block/mute repository (FEAT-8.5, #330).
// Blocks are one-directional: user A blocks user B. Blocked users are filtered
// at the query/display layer server-side.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]

import { randomUUID } from 'node:crypto'

const COLUMNS = `id, blocker_id, blocked_id, reason, created_at`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function toBlock(row) {
  if (!row) return null
  return {
    id: row.id,
    blockerId: row.blocker_id,
    blockedId: row.blocked_id,
    reason: row.reason,
    createdAt: toIso(row.created_at),
  }
}

export function createBlocksRepo(db) {
  // Create a block. Returns the block. Idempotent: a duplicate block returns
  // the existing block (ON CONFLICT DO NOTHING + select).
  async function createBlock(blockerId, blockedId, reason = '') {
    if (!blockerId || !blockedId) return null
    if (blockerId === blockedId) return null // cannot block yourself
    const id = randomUUID()
    const { rows } = await db.query(
      `INSERT INTO blocks (id, blocker_id, blocked_id, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET reason = EXCLUDED.reason
       RETURNING ${COLUMNS}`,
      [id, blockerId, blockedId, String(reason).slice(0, 500)],
    )
    return toBlock(rows[0])
  }

  // Remove a block. Returns true when a row was deleted.
  async function deleteBlock(blockerId, blockedId) {
    if (!blockerId || !blockedId) return false
    const { rowCount } = await db.query(
      `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, blockedId],
    )
    return rowCount > 0
  }

  // Check if blockerId has blocked blockedId. Returns the block or null.
  async function getBlock(blockerId, blockedId) {
    if (!blockerId || !blockedId) return null
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, blockedId],
    )
    return rows.length ? toBlock(rows[0]) : null
  }

  // List all users blocked by a given user.
  async function listBlocked(blockerId) {
    if (!blockerId) return []
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM blocks WHERE blocker_id = $1 ORDER BY created_at DESC`,
      [blockerId],
    )
    return rows.map(toBlock)
  }

  // Check if user A has blocked user B (for server-side filtering).
  // Returns true when a block exists.
  async function isBlocked(blockerId, blockedId) {
    if (!blockerId || !blockedId) return false
    const block = await getBlock(blockerId, blockedId)
    return !!block
  }

  // Get all user ids that have blocked a given user (for display filtering).
  async function getBlockerIds(blockedId) {
    if (!blockedId) return []
    const { rows } = await db.query(
      `SELECT blocker_id FROM blocks WHERE blocked_id = $1`,
      [blockedId],
    )
    return rows.map((r) => r.blocker_id)
  }

  // Remove all blocks involving a user (for account deletion).
  async function deleteByUserId(userId) {
    if (!userId) return false
    const { rowCount } = await db.query(
      `DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1`,
      [userId],
    )
    return rowCount > 0
  }

  return {
    createBlock,
    deleteBlock,
    getBlock,
    listBlocked,
    isBlocked,
    getBlockerIds,
    deleteByUserId,
  }
}