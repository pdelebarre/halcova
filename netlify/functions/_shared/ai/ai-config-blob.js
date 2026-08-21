// ai-config-blob.js — Blobs fallback for the AI provider-profile data layer
// (ADMIN-3.2, #304, epic #302).
//
// This is a small, owner-only configuration (a handful of provider profiles
// managed by the single admin), so unlike reviews/items there is ONE shared
// store holding the whole profile list:
//
//   store: runout-ai-config
//     profiles -> [ { profile… }, … ]   (the full list, insertion order)
//
// Owner-only low-concurrency writes make the last-write-wins Blobs semantic
// acceptable here (only the admin mutates it; there is no cross-tenant
// contention). Postgres (repositories/ai-config-repo.js) is the authoritative
// home and enforces at-most-one-active atomically; this Blobs path is the
// DATABASE_URL-unset fallback so the feature works without a DB and degrades
// gracefully.
//
// The apiKey is ALWAYS stored as `secretCiphertext` (AES-256-GCM) — never
// plaintext. This module only stores/reads the ciphertext; encryption and
// read-redaction live in ai-secrets.js / ai-admin.js.

import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'

const CONFIG_STORE = 'runout-ai-config'
const PROFILES_KEY = 'profiles'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function nowIso() {
  return new Date().toISOString()
}

// `store` is any @netlify/blobs-shaped store. Defaults to the real shared
// `runout-ai-config` store; tests inject an in-memory store.
export function createAiConfigBlobStore({ store = getStore(CONFIG_STORE) } = {}) {
  async function readProfiles() {
    const data = await store.get(PROFILES_KEY, { type: 'json' })
    return Array.isArray(data) ? data : []
  }

  async function writeProfiles(profiles) {
    await store.setJSON(PROFILES_KEY, profiles)
  }

  async function listProfiles() {
    return readProfiles()
  }

  async function getProfile(id) {
    if (!isUuid(id)) return null
    const profiles = await readProfiles()
    return profiles.find((p) => p.id === id) || null
  }

  // The Blobs path can't enforce at-most-one-active at the DB layer, so it
  // replicates the same invariant here (deactivate all, then activate `id`).
  async function activateProfile(id) {
    if (!isUuid(id)) return null
    const profiles = await readProfiles()
    let target = null
    const next = profiles.map((p) => {
      if (p.id === id) {
        target = { ...p, active: true, updatedAt: nowIso() }
        return target
      }
      return p.active ? { ...p, active: false, updatedAt: nowIso() } : p
    })
    if (!target) return null
    await writeProfiles(next)
    return target
  }

  // Insert a profile (server-assigned id, active=false by default).
  async function insertProfile(profile) {
    const profiles = await readProfiles()
    const id = isUuid(profile?.id) ? profile.id : randomUUID()
    const row = {
      id,
      name: String(profile?.name ?? ''),
      providerType: String(profile?.providerType ?? 'openai'),
      baseUrl: String(profile?.baseUrl ?? ''),
      model: String(profile?.model ?? ''),
      capabilities: Array.isArray(profile?.capabilities) ? profile.capabilities : [],
      active: !!profile?.active,
      fallbackProviderId: profile?.fallbackProviderId && isUuid(profile.fallbackProviderId) ? profile.fallbackProviderId : null,
      secretCiphertext: profile?.secretCiphertext ?? null,
      secretSet: !!profile?.secretSet,
      lastTestOk: profile?.lastTestOk == null ? null : !!profile.lastTestOk,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    await writeProfiles([...profiles, row])
    return row
  }

  async function updateProfile(id, patch) {
    if (!isUuid(id)) return null
    const profiles = await readProfiles()
    let updated = null
    const next = profiles.map((p) => {
      if (p.id !== id) return p
      updated = {
        ...p,
        ...(patch.name !== undefined ? { name: String(patch.name) } : {}),
        ...(patch.providerType !== undefined ? { providerType: String(patch.providerType) } : {}),
        ...(patch.baseUrl !== undefined ? { baseUrl: String(patch.baseUrl) } : {}),
        ...(patch.model !== undefined ? { model: String(patch.model) } : {}),
        ...(patch.capabilities !== undefined
          ? { capabilities: Array.isArray(patch.capabilities) ? patch.capabilities : [] }
          : {}),
        ...(patch.fallbackProviderId !== undefined
          ? { fallbackProviderId: patch.fallbackProviderId && isUuid(patch.fallbackProviderId) ? patch.fallbackProviderId : null }
          : {}),
        ...(patch.secretCiphertext !== undefined || patch.secretSet !== undefined
          ? { secretCiphertext: patch.secretCiphertext ?? null, secretSet: !!patch.secretSet }
          : {}),
        ...(patch.lastTestOk !== undefined ? { lastTestOk: patch.lastTestOk == null ? null : !!patch.lastTestOk } : {}),
        ...(patch.active !== undefined ? { active: !!patch.active } : {}),
        updatedAt: nowIso(),
      }
      return updated
    })
    if (!updated) return null
    await writeProfiles(next)
    return updated
  }

  async function deleteProfile(id) {
    if (!isUuid(id)) return false
    const profiles = await readProfiles()
    const next = profiles.filter((p) => p.id !== id)
    if (next.length === profiles.length) return false
    await writeProfiles(next)
    return true
  }

  async function transaction(fn) {
    // Blobs has no transactions; run the op directly against this store.
    return fn(createAiConfigBlobStore({ store }))
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
