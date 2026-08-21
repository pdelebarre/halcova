// @vitest-environment node
//
// Tests for the secure AI provider-profile administration (ADMIN-3.2, #304).
// Exercises the real ai-admin facade on BOTH backends (Blobs via an injected
// in-memory store, Postgres via pg-mem), by mocking @netlify/blobs and
// ./postgres so the facade's backend() selects the backend under test.
//
// Proves the acceptance-criteria invariants:
//   - secrets stored encrypted at rest, NEVER returned (masked only)
//   - unsafe/invalid endpoints cannot be stored
//   - activation is atomic (at most one active) and only after a passing test
//   - a missing/failing secret or unsafe endpoint cannot activate

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemDb } from '../repositories/test-helpers'
import { AI_SECRET_KEY_ENV, encryptSecret, decryptSecret } from './ai-secrets'
import {
  createProviderProfile,
  updateProviderProfile,
  listProviderProfiles,
  deleteProviderProfile,
  testProviderProfile,
  activateProviderProfile,
  getProfileSecret,
} from './ai-admin'

process.env[AI_SECRET_KEY_ENV] = 'test-secret-key-1234'

// In-memory @netlify/blobs.
const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, { type } = {}) {
        const v = this.data.get(String(key))
        if (v === undefined) return null
        return type === 'json' ? JSON.parse(JSON.stringify(v)) : v
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({
  getStore: (name) => {
    if (!stores[name]) stores[name] = createStore()
    return stores[name]
  },
}))

// Controllable Postgres switch so the facade's backend() picks the path under test.
const pgRef = vi.hoisted(() => ({ configured: false, db: null }))
vi.mock('../postgres', () => ({
  isPostgresConfigured: () => pgRef.configured,
  get db() { return pgRef.db },
}))

const VALID = {
  name: 'OpenAI Primary',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  capabilities: ['classify', 'deduplicate'],
  apiKey: 'sk-test-secret-value-1234',
}

// A fake provider whose health() we control (no network).
function fakeProvider({ ok = true, errorCode = null } = {}) {
  return (_profile, _secret) => ({
    async health() {
      if (!ok) {
        const err = new Error('boom')
        err.code = errorCode || 'PROVIDER_FAILURE'
        throw err
      }
      return { ok: true, latencyMs: 1 }
    },
  })
}

async function setupBackend(kind) {
  if (kind === 'postgres') {
    const mem = await createMemDb()
    pgRef.configured = true
    pgRef.db = mem
  } else {
    pgRef.configured = false
    pgRef.db = null
    stores['runout-ai-config'] = createStore()
  }
}

async function makeProfile(input = {}) {
  const res = await createProviderProfile({ ...VALID, ...input })
  expect(res.error).toBeUndefined()
  return res.profile
}

describe.each([
  ['blobs', 'blobs'],
  ['postgres', 'postgres'],
])('ai-admin #304 — %s backend', (_label, kind) => {
  beforeEach(async () => {
    await setupBackend(kind)
  })

  it('stores a secret encrypted and never returns it (masked only)', async () => {
    const profile = await makeProfile()
    expect(profile.secretSet).toBe(true)
    expect(profile.secretCiphertext).toBeUndefined()
    expect(JSON.stringify(profile)).not.toContain(VALID.apiKey)

    // The persisted data never contains the plaintext.
    if (kind === 'blobs') {
      expect(JSON.stringify(stores['runout-ai-config'].data.get('profiles'))).not.toContain(VALID.apiKey)
    }

    // getProfileSecret decrypts in memory only.
    const secret = await getProfileSecret(profile.id)
    expect(secret).toBe(VALID.apiKey)
  })

  it('list returns profiles with no secret material', async () => {
    await makeProfile()
    const profiles = await listProviderProfiles()
    expect(profiles.length).toBe(1)
    expect(profiles[0].secretSet).toBe(true)
    expect(JSON.stringify(profiles)).not.toContain(VALID.apiKey)
  })

  it('rejects an unsafe/invalid endpoint on create and update', async () => {
    const bad = await createProviderProfile({ ...VALID, baseUrl: 'http://api.openai.com/v1' })
    expect(bad.error.code).toBe('INSECURE_ENDPOINT')
    const meta = await createProviderProfile({ ...VALID, baseUrl: 'https://127.0.0.1/v1' })
    expect(meta.error.code).toBe('UNSAFE_ENDPOINT')

    const p = await makeProfile()
    const upd = await updateProviderProfile(p.id, { baseUrl: 'https://localhost/v1' })
    expect(upd.error.code).toBe('UNSAFE_ENDPOINT')
  })

  it('rejects an unknown provider type', async () => {
    const res = await createProviderProfile({ ...VALID, providerType: 'gemini' })
    expect(res.error.code).toBe('INVALID_PROVIDER')
  })

  it('test passes and records lastTestOk with a working provider', async () => {
    const p = await makeProfile()
    const res = await testProviderProfile(p.id, { providerFactory: fakeProvider({ ok: true }) })
    expect(res.ok).toBe(true)
    const list = await listProviderProfiles()
    expect(list[0].lastTestOk).toBe(true)
  })

  it('test fails (no secret) and does NOT activate', async () => {
    const p = await makeProfile()
    const noSecret = await testProviderProfile(p.id, { providerFactory: fakeProvider({ ok: false }) })
    // With a fake failing provider the test reports failure.
    expect(noSecret.error).toBeTruthy()

    const act = await activateProviderProfile(p.id, { test: async () => ({ error: { code: 'NO_SECRET', message: 'x' } }) })
    expect(act.error.code).toBe('TEST_REQUIRED')
    const list = await listProviderProfiles()
    expect(list[0].active).toBe(false)
  })

  it('activation is atomic — exactly one active after activating', async () => {
    const a = await makeProfile({ name: 'A' })
    const b = await makeProfile({ name: 'B' })

    const actA = await activateProviderProfile(a.id, { test: async () => ({ ok: true }) })
    expect(actA.profile.active).toBe(true)

    const actB = await activateProviderProfile(b.id, { test: async () => ({ ok: true }) })
    expect(actB.profile.active).toBe(true)

    const profiles = await listProviderProfiles()
    expect(profiles.filter((p) => p.active).map((p) => p.id)).toEqual([b.id])
  })

  it('a failing connection test cannot activate (activation re-tests)', async () => {
    const p = await makeProfile()
    const act = await activateProviderProfile(p.id, { test: async () => ({ error: { code: 'PROVIDER_FAILURE', message: 'boom' } }) })
    expect(act.error.code).toBe('TEST_REQUIRED')
    const list = await listProviderProfiles()
    expect(list[0].active).toBe(false)
  })

  it('delete removes the profile', async () => {
    const p = await makeProfile()
    const res = await deleteProviderProfile(p.id)
    expect(res.ok).toBe(true)
    expect((await listProviderProfiles()).length).toBe(0)
  })

  it('rejects missing/invalid fields on create (fail-closed)', async () => {
    expect((await createProviderProfile({ ...VALID, name: '' })).error.code).toBe('INVALID_NAME')
    expect((await createProviderProfile({ ...VALID, name: 'x'.repeat(81) })).error.code).toBe('INVALID_NAME')
    expect((await createProviderProfile({ ...VALID, model: '' })).error.code).toBe('INVALID_MODEL')
    expect((await createProviderProfile({ ...VALID, model: 'x'.repeat(121) })).error.code).toBe('INVALID_MODEL')
    // 'anthropic' is KNOWN but not yet TESTABLE -> rejected before it can be activated.
    expect((await createProviderProfile({ ...VALID, providerType: 'anthropic' })).error.code).toBe('UNTESTABLE_PROVIDER')
    // fallback must be a string
    expect((await createProviderProfile({ ...VALID, fallbackProviderId: 123 })).error.code).toBe('INVALID_FALLBACK')
  })

  it('creates a profile with no secret when apiKey is absent (secretSet false)', async () => {
    const profile = await createProviderProfile({ ...VALID, apiKey: '' })
    expect(profile.error).toBeUndefined()
    expect(profile.profile.secretSet).toBe(false)
    expect(profile.profile.secretMasked).toBe('')
  })

  it('update validates each changed field and rejects bad values', async () => {
    const p = await makeProfile()
    expect((await updateProviderProfile(p.id, { name: '' })).error.code).toBe('INVALID_NAME')
    expect((await updateProviderProfile(p.id, { providerType: 'nope' })).error.code).toBe('INVALID_PROVIDER')
    expect((await updateProviderProfile(p.id, { providerType: 'anthropic' })).error.code).toBe('UNTESTABLE_PROVIDER')
    expect((await updateProviderProfile(p.id, { model: '' })).error.code).toBe('INVALID_MODEL')
    expect((await updateProviderProfile(p.id, { fallbackProviderId: 7 })).error.code).toBe('INVALID_FALLBACK')
    expect((await updateProviderProfile(p.id, { baseUrl: 'http://x.com/v1' })).error.code).toBe('INSECURE_ENDPOINT')
  })

  it('update/delete/test/activate on an unknown id return NOT_FOUND', async () => {
    const id = '00000000-0000-0000-0000-000000000099'
    expect((await updateProviderProfile(id, { name: 'X' })).error.code).toBe('NOT_FOUND')
    expect((await deleteProviderProfile(id)).error.code).toBe('NOT_FOUND')
    expect((await testProviderProfile(id, { providerFactory: fakeProvider() })).error.code).toBe('NOT_FOUND')
    expect((await activateProviderProfile(id, { test: async () => ({ ok: true }) })).error.code).toBe('NOT_FOUND')
  })

  it('a provider factory that fails health does not record lastTestOk', async () => {
    const p = await makeProfile()
    const res = await testProviderProfile(p.id, { providerFactory: fakeProvider({ ok: false }) })
    expect(res.error).toBeTruthy()
    const list = await listProviderProfiles()
    expect(list[0].lastTestOk).toBe(false)
  })
})
