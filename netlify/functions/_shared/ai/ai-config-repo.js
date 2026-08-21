// ai-config-repo.js — Postgres repository for AI provider profiles (ADMIN-3.2,
// #304, epic #302). Mirrors the feedback/reviews repository pattern: profiles
// are FIRST-CLASS rows (every field a real column — no `data jsonb` mirror);
// reads map rows to the camelCase profile shape.
//
// Security (non-negotiable, see ai-secrets.js):
//   - The apiKey is NEVER stored as plaintext. Only `secret_ciphertext`
//     (AES-256-GCM under the server-side key) is persisted, and `secret_set`
//     records whether a secret is present. This repo only stores/reads the
//     ciphertext; encryption/decryption lives in ai-secrets.js and the
//     redaction of reads lives in ai-admin.js (the facade). Plaintext never
//     touches this module or the DB.
//   - `base_url` is validated (https, public hostname) by ai-endpoint.js in
//     the facade BEFORE it is written here.
//
// `db` is any object with the node-postgres shape:
//   query(text, params?) -> { rows, rowCount }
//   connect()            -> client with query() and release()   [transactions]

import { randomUUID } from 'node:crypto'

const COLUMNS = `id, name, provider_type, base_url, model, capabilities, active, fallback_provider_id, secret_ciphertext, secret_set, last_test_ok, created_at, updated_at`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function toIso(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// Map a profile row to the camelCase profile object. `capabilities` is stored
// as jsonb (text array); `secretCiphertext` is exposed to the facade only —
// never to clients (ai-admin.js strips it before returning).
function toProfile(row) {
  if (!row) return null
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities
    : (row.capabilities && typeof row.capabilities === 'object' && Array.isArray(row.capabilities.data)
      ? row.capabilities.data
      : [])
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    model: row.model,
    capabilities,
    active: !!row.active,
    fallbackProviderId: row.fallback_provider_id || null,
    secretCiphertext: row.secret_ciphertext || null,
    secretSet: !!row.secret_set,
    lastTestOk: row.last_test_ok == null ? null : !!row.last_test_ok,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export function createAiConfigRepo(db) {
  // Insert a profile. `id` is server-assigned; `active` defaults false (a
  // profile only becomes active through the atomic activate path). Returns the
  // row.
  async function insertProfile(profile) {
    const id = isUuid(profile?.id) ? profile.id : randomUUID()
    const { rows } = await db.query(
      `INSERT INTO ai_provider_profiles
         (id, name, provider_type, base_url, model, capabilities, active,
          fallback_provider_id, secret_ciphertext, secret_set, last_test_ok)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLUMNS}`,
      [id,
        String(profile?.name ?? ''),
        String(profile?.providerType ?? 'openai'),
        String(profile?.baseUrl ?? ''),
        String(profile?.model ?? ''),
        JSON.stringify(Array.isArray(profile?.capabilities) ? profile.capabilities : []),
        !!profile?.active,
        profile?.fallbackProviderId && isUuid(profile.fallbackProviderId) ? profile.fallbackProviderId : null,
        profile?.secretCiphertext ?? null,
        !!profile?.secretSet,
        profile?.lastTestOk == null ? null : !!profile.lastTestOk],
    )
    return toProfile(rows[0])
  }

  // List all profiles, newest first (insertion order for the admin panel).
  async function listProfiles() {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM ai_provider_profiles ORDER BY created_at ASC, id ASC`,
    )
    return rows.map(toProfile)
  }

  async function getProfile(id) {
    if (!isUuid(id)) return null
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM ai_provider_profiles WHERE id = $1`,
      [id],
    )
    return rows.length ? toProfile(rows[0]) : null
  }

  // Update a profile. Only the fields the caller sends are touched; the
  // ciphertext/secret_set pair is updated together (either both present or
  // neither). Returns the updated row, or null when the id is junk/unknown.
  async function updateProfile(id, patch) {
    if (!isUuid(id)) return null
    const sets = ['updated_at = now()']
    const params = [id]
    const put = (key, value) => {
      params.push(value)
      sets.push(`${key} = $${params.length}`)
    }
    if (patch.name !== undefined) put('name', String(patch.name))
    if (patch.providerType !== undefined) put('provider_type', String(patch.providerType))
    if (patch.baseUrl !== undefined) put('base_url', String(patch.baseUrl))
    if (patch.model !== undefined) put('model', String(patch.model))
    if (patch.capabilities !== undefined) {
      put('capabilities', JSON.stringify(Array.isArray(patch.capabilities) ? patch.capabilities : []))
    }
    if (patch.fallbackProviderId !== undefined) {
      put('fallback_provider_id', patch.fallbackProviderId && isUuid(patch.fallbackProviderId) ? patch.fallbackProviderId : null)
    }
    if (patch.secretCiphertext !== undefined || patch.secretSet !== undefined) {
      // Ciphertext and secret_set always move together — a secret update
      // carries both (facade encrypts then passes both).
      put('secret_ciphertext', patch.secretCiphertext ?? null)
      put('secret_set', !!patch.secretSet)
    }
    if (patch.lastTestOk !== undefined) put('last_test_ok', patch.lastTestOk == null ? null : !!patch.lastTestOk)
    if (patch.active !== undefined) put('active', !!patch.active)
    if (sets.length === 1) return getProfile(id)
    const { rows } = await db.query(
      `UPDATE ai_provider_profiles SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    )
    return rows.length ? toProfile(rows[0]) : null
  }

  async function deleteProfile(id) {
    if (!isUuid(id)) return false
    const { rowCount } = await db.query(`DELETE FROM ai_provider_profiles WHERE id = $1`, [id])
    return rowCount > 0
  }

  // Atomic activation. The `ai_provider_profiles_active_uidx` partial unique
  // index (migration 013) enforces at most one active row at the DB layer, so
  // this single statement both deactivates the current active profile (if any)
  // and activates `id`. Runs inside the caller's transaction when passed a
  // client; otherwise on the pool.
  async function activateProfile(id, client = db) {
    if (!isUuid(id)) return null
    await client.query(`UPDATE ai_provider_profiles SET active = false, updated_at = now() WHERE active = true`)
    const { rows } = await client.query(
      `UPDATE ai_provider_profiles SET active = true, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      [id],
    )
    return rows.length ? toProfile(rows[0]) : null
  }

  async function transaction(fn) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(createAiConfigRepo(client))
      await client.query('COMMIT')
      return result
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* connection may be dead */ }
      throw err
    } finally {
      client.release()
    }
  }

  return {
    insertProfile,
    listProfiles,
    getProfile,
    updateProfile,
    deleteProfile,
    activateProfile,
    transaction,
  }
}
