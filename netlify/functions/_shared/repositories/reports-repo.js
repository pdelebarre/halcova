// reports-repo.js — Postgres reports repository (FEAT-8.5, #330).
// Reports are private and auditable. Members report content; moderators review
// and take action. Reports are immutable after resolution.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]

import { randomUUID } from 'node:crypto'
import { DEFAULT_LIMIT, MAX_LIMIT } from '../pagination'

const COLUMNS = `id, reporter_id, target_type, target_id, reason, status, action_taken, moderator_id, moderator_note, created_at, updated_at`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

const REPORT_STATUSES = new Set(['open', 'under_review', 'resolved', 'dismissed'])
const REPORT_ACTIONS = new Set(['', 'content_hidden', 'user_warned', 'user_blocked', 'none'])
const TARGET_TYPES = new Set(['profile', 'item', 'review', 'comment'])

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function toReport(row) {
  if (!row) return null
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    actionTaken: row.action_taken,
    moderatorId: row.moderator_id,
    moderatorNote: row.moderator_note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export function createReportsRepo(db) {
  // Create a report. Returns the report. `targetType` must be in the allow-list.
  async function createReport({ reporterId, targetType, targetId, reason }) {
    if (!reporterId || !targetType || !targetId || !reason) return null
    if (!TARGET_TYPES.has(targetType)) return null
    const id = randomUUID()
    const { rows } = await db.query(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [id, reporterId, targetType, targetId, String(reason).slice(0, 2000)],
    )
    return toReport(rows[0])
  }

  // Get a report by id. Returns null for unknown/junk id.
  async function getReport(id) {
    if (!isUuid(id)) return null
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM reports WHERE id = $1`, [id])
    return rows.length ? toReport(rows[0]) : null
  }

  // List reports for the moderation queue. Filters by status when provided.
  // Newest first. Paginated.
  async function listReports({ status, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const capped = Math.max(0, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
    const params = []
    const clauses = []
    if (status && REPORT_STATUSES.has(status)) {
      params.push(status)
      clauses.push(`status = $${params.length}`)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(capped, Math.max(0, Number(offset) || 0))
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM reports ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return rows.map(toReport)
  }

  // Moderator action: update a report's status, action_taken, moderator_id,
  // and moderator_note. Returns the updated report, or null when the id is
  // unknown or the report is already resolved (immutable).
  async function moderateReport(id, { status, actionTaken, moderatorId, moderatorNote } = {}) {
    if (!isUuid(id)) return null
    const existing = await getReport(id)
    if (!existing) return null
    // Immutable after resolution: resolved/dismissed reports cannot be changed.
    if (existing.status === 'resolved' || existing.status === 'dismissed') return null

    if (status && !REPORT_STATUSES.has(status)) return null
    if (actionTaken !== undefined && !REPORT_ACTIONS.has(actionTaken)) return null
    if (!status && !actionTaken && !moderatorNote) return null

    const sets = ['updated_at = now()']
    const params = [id]
    if (status) {
      params.push(status)
      sets.push(`status = $${params.length}`)
    }
    if (actionTaken !== undefined) {
      params.push(actionTaken)
      sets.push(`action_taken = $${params.length}`)
    }
    if (moderatorId) {
      params.push(moderatorId)
      sets.push(`moderator_id = $${params.length}`)
    }
    if (moderatorNote !== undefined) {
      params.push(String(moderatorNote).slice(0, 2000))
      sets.push(`moderator_note = $${params.length}`)
    }
    const { rows } = await db.query(
      `UPDATE reports SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    )
    return rows.length ? toReport(rows[0]) : null
  }

  // Remove all reports by a specific reporter (for account deletion/anonymization).
  async function deleteByReporter(reporterId) {
    if (!reporterId) return false
    const { rowCount } = await db.query(
      `DELETE FROM reports WHERE reporter_id = $1`,
      [reporterId],
    )
    return rowCount > 0
  }

  // Get report counts by status for the moderation dashboard.
  async function countsByStatus() {
    const { rows } = await db.query(
      `SELECT status, count(*)::int AS count FROM reports GROUP BY status`,
    )
    return rows
  }

  return {
    createReport,
    getReport,
    listReports,
    moderateReport,
    deleteByReporter,
    countsByStatus,
  }
}