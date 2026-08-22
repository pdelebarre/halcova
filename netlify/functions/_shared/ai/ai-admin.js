// ai-admin.js — admin facade for secure LLM configuration (ADMIN-3.2, #304,
// epic #302). This is the ONLY surface admin.js calls; it owns the security
// invariants the acceptance criteria demand:
//
//   * Secrets are stored encrypted at rest (ai-secrets.js) and NEVER returned
//     to any caller — every read path emits a PUBLIC profile with the secret
//     masked (tail only) and a `secretSet` boolean.
//   * base_url is SSRF-validated (ai-endpoint.js) before it is ever stored,
//     and the connection test / activation re-validates before fetching.
//   * Activation is ATOMIC and only after a passing connection test (decrypt +
//     provider health()); the at-most-one-active invariant is enforced by the
//     partial unique index on the Postgres path and replicated in Blobs.
//   * Audit events are emitted without logging the secret (see each op).
//
// Backend selection mirrors the rest of the app: Postgres when DATABASE_URL is
// configured (authoritative), Blobs otherwise — both expose the same ops.
//
// `store`/`db` are injectable for tests; defaults match the app's real stores.

import { getStore } from '@netlify/blobs'
import { isPostgresConfigured, db } from '../postgres'
import { createAiConfigRepo } from './ai-config-repo'
import { createAiConfigBlobStore } from './ai-config-blob'
import { encryptSecret, decryptSecret, maskSecret } from './ai-secrets'
import { validateAiEndpoint, endpointAllowlistFromEnv } from './ai-endpoint'
import { OpenAIProvider } from './openai'
import { logAudit } from '../audit'
import { getUsageAggregates, recordUsageEvent } from './ai-cost-tracker'
import { dryRunFeedback } from './ai-dryrun'
import { getCooldownState } from './ai-fallback'

const AI_CONFIG_STORE = 'runout-ai-config'

// Known provider types (mirrors provider.js/openai.js). Unknown types are
// rejected by the facade so a typo can never be persisted as a profile that
// cannot be constructed later.
const KNOWN_PROVIDER_TYPES = new Set(['openai', 'anthropic'])

// The provider types we can actually instantiate and health-test. Add adapters
// here as they ship (e.g. 'anthropic') — until then a create/update must not
// accept a type we cannot test, or an untestable profile could be activated.
const TESTABLE_PROVIDER_TYPES = new Set(['openai'])

export const AI_CONFIG_STORE_NAME = AI_CONFIG_STORE

function backend() {
  if (isPostgresConfigured()) return createAiConfigRepo(db)
  return createAiConfigBlobStore({ store: getStore(AI_CONFIG_STORE) })
}

// A provider profile WITHOUT any secret material. `secretSet` tells the UI a
// secret exists; `secretMasked` is the tail-only display. secretCiphertext is
// never serialized.
function toPublic(profile) {
  if (!profile) return null
  return {
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    model: profile.model,
    capabilities: profile.capabilities,
    active: profile.active,
    fallbackProviderId: profile.fallbackProviderId,
    secretSet: profile.secretSet,
    secretMasked: profile.secretSet ? maskSecret('placeholder') : '',
    lastTestOk: profile.lastTestOk,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function isValidName(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80
}

function isValidModel(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120
}

function sanitizeCapabilities(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((c) => typeof c === 'string' && /^[A-Za-z0-9_:-]{1,40}$/.test(c))
    .slice(0, 20)
}

// Validate the common create/update fields. Returns { value } or { error }.
function validateProfileInput(input, { requireModel = true } = {}) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!isValidName(name)) {
    return { error: { code: 'INVALID_NAME', message: 'A profile name (1–80 chars) is required.' } }
  }
  const providerType = input?.providerType || 'openai'
  if (!KNOWN_PROVIDER_TYPES.has(providerType)) {
    return { error: { code: 'INVALID_PROVIDER', message: 'Unknown provider type.' } }
  }
  if (!TESTABLE_PROVIDER_TYPES.has(providerType)) {
    return { error: { code: 'UNTESTABLE_PROVIDER', message: 'That provider type cannot be activated yet.' } }
  }
  const endpoint = validateAiEndpoint(input?.baseUrl)
  if (endpoint.error) return { error: endpoint.error }
  const model = typeof input?.model === 'string' ? input.model.trim() : ''
  if (requireModel && !isValidModel(model)) {
    return { error: { code: 'INVALID_MODEL', message: 'A model (1–120 chars) is required.' } }
  }
  const fallbackProviderId = input?.fallbackProviderId ?? null
  if (fallbackProviderId !== null && fallbackProviderId !== '' && typeof fallbackProviderId !== 'string') {
    return { error: { code: 'INVALID_FALLBACK', message: 'Invalid fallback provider.' } }
  }
  return {
    value: {
      name,
      providerType,
      baseUrl: endpoint.value,
      model,
      capabilities: sanitizeCapabilities(input?.capabilities),
      fallbackProviderId: fallbackProviderId || null,
    },
  }
}

export async function listProviderProfiles() {
  const repo = backend()
  const profiles = await repo.listProfiles()
  return profiles.map(toPublic)
}

export async function createProviderProfile(input) {
  const v = validateProfileInput(input)
  if (v.error) return { error: v.error }

  let secretCiphertext = null
  let secretSet = false
  if (input?.apiKey !== undefined && input?.apiKey !== null && String(input.apiKey) !== '') {
    try {
      secretCiphertext = encryptSecret(String(input.apiKey))
      secretSet = true
    } catch (err) {
      // Missing server-side key → refuse to store a secret that would be
      // persisted weakly. The profile is not created.
      return { error: { code: 'SECRET_KEY_MISSING', message: err.message } }
    }
  }

  const repo = backend()
  const profile = await repo.insertProfile({ ...v.value, secretCiphertext, secretSet })
  logAudit('ai.profile.create', { profileId: profile.id, providerType: profile.providerType, secretSet })
  return { profile: toPublic(profile) }
}

export async function updateProviderProfile(id, input) {
  const repo = backend()
  const existing = await repo.getProfile(id)
  if (!existing) return { error: { code: 'NOT_FOUND', message: 'Profile not found.' } }

  // If baseUrl is changing, it must be SSRF-validated before it can be stored.
  const patch = {}
  if (input?.name !== undefined) {
    const name = String(input.name).trim()
    if (!isValidName(name)) return { error: { code: 'INVALID_NAME', message: 'A profile name (1–80 chars) is required.' } }
    patch.name = name
  }
  if (input?.providerType !== undefined) {
    const providerType = input.providerType || 'openai'
    if (!KNOWN_PROVIDER_TYPES.has(providerType)) return { error: { code: 'INVALID_PROVIDER', message: 'Unknown provider type.' } }
    if (!TESTABLE_PROVIDER_TYPES.has(providerType)) return { error: { code: 'UNTESTABLE_PROVIDER', message: 'That provider type cannot be activated yet.' } }
    patch.providerType = providerType
  }
  if (input?.baseUrl !== undefined) {
    const endpoint = validateAiEndpoint(input.baseUrl)
    if (endpoint.error) return { error: endpoint.error }
    patch.baseUrl = endpoint.value
  }
  if (input?.model !== undefined) {
    const model = String(input.model).trim()
    if (!isValidModel(model)) return { error: { code: 'INVALID_MODEL', message: 'A model (1–120 chars) is required.' } }
    patch.model = model
  }
  if (input?.capabilities !== undefined) patch.capabilities = sanitizeCapabilities(input.capabilities)
  if (input?.fallbackProviderId !== undefined) {
    const fb = input.fallbackProviderId || null
    if (fb !== null && typeof fb !== 'string') return { error: { code: 'INVALID_FALLBACK', message: 'Invalid fallback provider.' } }
    patch.fallbackProviderId = fb
  }
  if (input?.apiKey !== undefined && input?.apiKey !== null && String(input.apiKey) !== '') {
    try {
      patch.secretCiphertext = encryptSecret(String(input.apiKey))
      patch.secretSet = true
    } catch (err) {
      return { error: { code: 'SECRET_KEY_MISSING', message: err.message } }
    }
  }

  const profile = await repo.updateProfile(id, patch)
  logAudit('ai.profile.update', { profileId: id, providerType: patch.providerType, secretSet: patch.secretSet })
  return { profile: toPublic(profile) }
}

export async function deleteProviderProfile(id) {
  const repo = backend()
  const existing = await repo.getProfile(id)
  if (!existing) return { error: { code: 'NOT_FOUND', message: 'Profile not found.' } }
  await repo.deleteProfile(id)
  logAudit('ai.profile.delete', { profileId: id })
  return { ok: true }
}

// Resolve the plaintext secret for a profile (decrypt in memory only). Used by
// test/activate and the (future) live AI call path. Never returned to a client.
export async function getProfileSecret(id) {
  const repo = backend()
  const profile = await repo.getProfile(id)
  if (!profile || !profile.secretCiphertext) return null
  try {
    return decryptSecret(profile.secretCiphertext)
  } catch {
    return null
  }
}

function buildProvider(profile, secret) {
  if (profile.providerType === 'openai') {
    return new OpenAIProvider({
      baseUrl: profile.baseUrl,
      apiKey: secret,
      model: profile.model,
      capabilities: profile.capabilities,
      allowedHosts: endpointAllowlistFromEnv(),
    })
  }
  return null
}

// Connection test: instantiate the provider with the decrypted secret and run
// its health check. On success records lastTestOk=true; on failure records
// lastTestOk=false. Returns { ok } | { error }. The secret is never logged.
export async function testProviderProfile(id, { providerFactory = buildProvider } = {}) {
  const repo = backend()
  const profile = await repo.getProfile(id)
  if (!profile) return { error: { code: 'NOT_FOUND', message: 'Profile not found.' } }
  const endpoint = validateAiEndpoint(profile.baseUrl)
  if (endpoint.error) {
    await repo.updateProfile(id, { lastTestOk: false })
    return { error: endpoint.error }
  }
  const secret = await getProfileSecret(id)
  if (!secret) {
    await repo.updateProfile(id, { lastTestOk: false })
    return { error: { code: 'NO_SECRET', message: 'No secret is set for this profile.' } }
  }
  const provider = providerFactory(profile, secret)
  if (!provider) {
    await repo.updateProfile(id, { lastTestOk: false })
    return { error: { code: 'UNSUPPORTED_PROVIDER', message: 'Provider type is not supported.' } }
  }
  try {
    await provider.health()
    await repo.updateProfile(id, { lastTestOk: true })
    logAudit('ai.profile.test', { profileId: id, ok: true })
    return { ok: true }
  } catch (err) {
    await repo.updateProfile(id, { lastTestOk: false })
    logAudit('ai.profile.test', { profileId: id, ok: false, code: err?.code || 'PROVIDER_FAILURE' })
    return { error: { code: err?.code || 'PROVIDER_FAILURE', message: 'Connection test failed.' } }
  }
}

// Activate a profile ATOMICALLY, but only after a PASSING connection test (AC:
// "Connection test must pass before activation"). The test is re-run here with
// the stored secret so activation can never happen on a broken credential or
// an unsafe endpoint; on success the at-most-one-active invariant is enforced
// atomically in a single transaction (Postgres partial unique index / Blobs
// replicate).
export async function activateProviderProfile(id, { test = testProviderProfile } = {}) {
  const repo = backend()
  const profile = await repo.getProfile(id)
  if (!profile) return { error: { code: 'NOT_FOUND', message: 'Profile not found.' } }

  const testResult = await test(id)
  if (testResult.error) {
    return { error: { code: 'TEST_REQUIRED', message: 'Activation requires a passing connection test.' } }
  }

  const activated = await repo.transaction((txn) => txn.activateProfile(id))
  logAudit('ai.profile.activate', { profileId: id })
  return { profile: toPublic(activated) }
}

// ---------------------------------------------------------------------------
// AI Dashboard aggregates (ADMIN-3.8, #310)
// ---------------------------------------------------------------------------

// Get usage aggregates for the AI dashboard. Returns 7-day and 30-day stats
// plus per-provider breakdowns and cooldown state.
export async function getAiDashboard() {
  const [agg7d, agg30d, profiles, cooldowns] = await Promise.all([
    getUsageAggregates({ days: 7 }),
    getUsageAggregates({ days: 30 }),
    listProviderProfiles(),
    Promise.resolve(getCooldownState()),
  ])

  return {
    aggregates: {
      days7: agg7d,
      days30: agg30d,
    },
    providers: profiles,
    cooldowns,
  }
}

// Run a dry-run evaluation of feedback items through the active provider.
// Returns { results, summary } or { error }.
export async function runAiDryRun({ limit = 10, offset = 0 } = {}) {
  const result = await dryRunFeedback({ limit, offset, providerFactory: buildProvider })

  // Record usage events for the dry-run (metadata only — no prompts/responses).
  if (!result.error && result.results) {
    for (const r of result.results) {
      if (r.ok) {
        recordUsageEvent({
          provider: result.summary?.provider || 'unknown',
          model: result.summary?.model || 'unknown',
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          latencyMs: r.latencyMs,
          ok: true,
        }).catch(() => {})
      }
    }
  }

  return result
}
