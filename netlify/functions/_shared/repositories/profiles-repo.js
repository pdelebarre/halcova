// profiles-repo.js — Postgres profile repository (FEAT-8.1, #326).
// Every member gets exactly ONE profile row, created on first profile save.
// The profile object is FIRST-CLASS in the schema (see 014_profiles.sql):
// every field is a real column — the source of truth — with CHECK constraints
// enforced by the database.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]
// The production module is _shared/postgres.js; unit tests inject pg-mem's
// node-postgres-compatible adapter.

import { randomUUID } from 'node:crypto'
import { VISIBILITY, resolveVisibility } from '../visibility'

const COLUMNS = `id, user_id, share_id, username, avatar, bio, links, visibility, collection_visibility, created_at, updated_at`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function toProfile(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    shareId: row.share_id,
    username: row.username,
    avatar: row.avatar,
    bio: row.bio,
    links: typeof row.links === 'string' ? JSON.parse(row.links) : (row.links || []),
    visibility: row.visibility,
    collectionVisibility: row.collection_visibility,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export function createProfilesRepo(db) {
  // Get a profile by user id (internal). Returns null when not found.
  async function getByUserId(userId) {
    if (!userId) return null
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM profiles WHERE user_id = $1`,
      [userId],
    )
    return rows.length ? toProfile(rows[0]) : null
  }

  // Get a profile by share id (opaque public identifier). Returns null when
  // not found or when the profile visibility is private (fail closed).
  async function getByShareId(shareId) {
    if (!isUuid(shareId)) return null
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM profiles WHERE share_id = $1`,
      [shareId],
    )
    if (!rows.length) return null
    const profile = toProfile(rows[0])
    // Fail closed: a private profile is never exposed via share id.
    if (resolveVisibility(profile.visibility) !== VISIBILITY.PUBLIC) return null
    return profile
  }

  // Upsert a profile (INSERT on first save, UPDATE thereafter). Returns the
  // saved profile. Only the mutable fields are accepted; id/shareId are
  // server-assigned on create and immutable on update.
  async function upsertProfile(input) {
    const existing = input.userId ? await getByUserId(input.userId) : null
    if (existing) {
      // Update existing profile
      const { rows } = await db.query(
        `UPDATE profiles SET
           username = $1,
           avatar = $2,
           bio = $3,
           links = $4,
           visibility = $5,
           collection_visibility = $6,
           updated_at = now()
         WHERE user_id = $7
         RETURNING ${COLUMNS}`,
        [
          String(input.username ?? existing.username ?? '').slice(0, 80),
          String(input.avatar ?? existing.avatar ?? ''),
          String(input.bio ?? existing.bio ?? '').slice(0, 500),
          JSON.stringify(input.links ?? existing.links ?? []),
          resolveVisibility(input.visibility ?? existing.visibility ?? 'private'),
          resolveVisibility(input.collectionVisibility ?? existing.collectionVisibility ?? 'private'),
          input.userId,
        ],
      )
      return toProfile(rows[0])
    }
    // Create new profile
    const id = randomUUID()
    const shareId = randomUUID()
    const { rows } = await db.query(
      `INSERT INTO profiles
         (id, user_id, share_id, username, avatar, bio, links, visibility, collection_visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        id,
        String(input.userId ?? ''),
        shareId,
        String(input.username ?? '').slice(0, 80),
        String(input.avatar ?? ''),
        String(input.bio ?? '').slice(0, 500),
        JSON.stringify(input.links ?? []),
        resolveVisibility(input.visibility ?? 'private'),
        resolveVisibility(input.collectionVisibility ?? 'private'),
      ],
    )
    return toProfile(rows[0])
  }

  // Delete a profile by user id (used on account deletion).
  async function deleteByUserId(userId) {
    if (!userId) return false
    const { rowCount } = await db.query(`DELETE FROM profiles WHERE user_id = $1`, [userId])
    return rowCount > 0
  }

  // Set profile visibility to private (used on account deletion/privacy change).
  async function revokePublicAccess(userId) {
    if (!userId) return false
    const { rowCount } = await db.query(
      `UPDATE profiles SET visibility = 'private', collection_visibility = 'private', updated_at = now()
       WHERE user_id = $1`,
      [userId],
    )
    return rowCount > 0
  }

  return {
    getByUserId,
    getByShareId,
    upsertProfile,
    deleteByUserId,
    revokePublicAccess,
  }
}