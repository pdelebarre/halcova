// Blobs-backed session repository (SEC-EPIC-1, #176). The `runout-sessions`
// store holds ONLY session records keyed by the sha256 hash of the token — the
// raw token is returned to its owner exactly once at login and never stored or
// logged. This is the Blobs side of the repository seam: when DATABASE_URL is
// unset these run as-is; when it is set the Postgres sessions repo is the
// authority and these become the read-through fallback / dual-write mirror
// (see postgres-repository.js).
//
// Layout inside the single "runout-sessions" store:
//   session:<tokenHash> -> { tokenHash, userId, role, status, createdAt,
//                            expiresAt, revokedAt? }
//   user:<userId>       -> ordered list of tokenHashes (for bulk revocation)

import { getStore } from '@netlify/blobs'

export const SESSIONS_STORE = 'runout-sessions'
const SESSION_KEY = (hash) => `session:${hash}`
const USER_INDEX = (userId) => `user:${userId}`

const store = () => getStore(SESSIONS_STORE)

export async function getSessionByTokenHash(tokenHash) {
  if (!tokenHash) return null
  return (await store().get(SESSION_KEY(tokenHash), { type: 'json' })) || null
}

export async function saveSession(session) {
  const s = store()
  await s.setJSON(SESSION_KEY(session.tokenHash), session)
  const list = (await s.get(USER_INDEX(session.userId), { type: 'json' })) || []
  if (!list.includes(session.tokenHash)) {
    await s.setJSON(USER_INDEX(session.userId), [...list, session.tokenHash])
  }
}

// Idempotent: returns true only when THIS call flipped a live session to
// revoked; false for an unknown token OR one already revoked (mirrors the
// Postgres repo's `WHERE status <> 'revoked'` row-count semantics).
export async function revokeSessionByTokenHash(tokenHash) {
  const record = await getSessionByTokenHash(tokenHash)
  if (!record) return false
  if (record.status === 'revoked') return false
  await store().setJSON(SESSION_KEY(tokenHash), {
    ...record,
    status: 'revoked',
    revokedAt: new Date().toISOString(),
  })
  return true
}

export async function revokeAllForUser(userId) {
  const s = store()
  const hashes = (await s.get(USER_INDEX(userId), { type: 'json' })) || []
  for (const hash of hashes) {
    const record = await getSessionByTokenHash(hash)
    if (record && record.status !== 'revoked') {
      await s.setJSON(SESSION_KEY(hash), { ...record, status: 'revoked', revokedAt: new Date().toISOString() })
    }
  }
}

export async function deleteAllForUser(userId) {
  const s = store()
  const hashes = (await s.get(USER_INDEX(userId), { type: 'json' })) || []
  for (const hash of hashes) await s.delete(SESSION_KEY(hash))
  await s.delete(USER_INDEX(userId))
}
