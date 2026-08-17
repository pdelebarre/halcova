// sessions-repo.js — Postgres sessions repository (SEC-EPIC-1, #176). Mirrors
// the Blobs session shape from blob-sessions.js so the session facade
// (_shared/sessions.js) can't tell which backend it's on.
//
// Session record shape -> { tokenHash, userId, role, status:'active'|'revoked',
//                           createdAt, expiresAt, revokedAt? }
//
// The raw token is NEVER stored — only its sha256 hash (the `sessions` table's
// PRIMARY KEY, like users.code_hash). Reads/writes are driven through the
// repository seam in postgres-repository.js, which treats a Postgres
// record-miss as authoritative (a revoked/expired/unknown token is invalid even
// if the Blobs mirror still holds it) and fails closed on auth-relevant writes.

const SESSION_COLUMNS = `token_hash, user_id, role, status, created_at, expires_at, revoked_at`

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function toSession(row) {
  if (!row) return null
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
  }
}

export function createSessionsRepo(db) {
  async function getByTokenHash(tokenHash) {
    if (!tokenHash) return null
    const { rows } = await db.query(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    )
    return rows.length ? toSession(rows[0]) : null
  }

  async function save(session) {
    await db.query(
      `INSERT INTO sessions (${SESSION_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (token_hash) DO UPDATE SET
         user_id = EXCLUDED.user_id, role = EXCLUDED.role, status = EXCLUDED.status,
         expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at`,
      [
        session.tokenHash,
        session.userId,
        session.role || 'member',
        session.status || 'active',
        session.createdAt ? new Date(session.createdAt) : new Date(),
        new Date(session.expiresAt),
        session.revokedAt ? new Date(session.revokedAt) : null,
      ],
    )
    return session
  }

  // Returns true when THIS call revoked a live session (first time), false
  // when it was already revoked / unknown — idempotent, like consumeMagicLink.
  async function revokeByTokenHash(tokenHash) {
    if (!tokenHash) return false
    const { rowCount } = await db.query(
      `UPDATE sessions SET status = 'revoked', revoked_at = now()
       WHERE token_hash = $1 AND status <> 'revoked'`,
      [tokenHash],
    )
    return (rowCount || 0) > 0
  }

  async function revokeAllForUser(userId) {
    await db.query(
      `UPDATE sessions SET status = 'revoked', revoked_at = now()
       WHERE user_id = $1 AND status <> 'revoked'`,
      [userId],
    )
  }

  async function deleteAllForUser(userId) {
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId])
  }

  return { getByTokenHash, save, revokeByTokenHash, revokeAllForUser, deleteAllForUser }
}
