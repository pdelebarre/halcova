// @vitest-environment node
//
// Direct unit tests for the Postgres AI provider-profile repository
// (ai-config-repo.js, ADMIN-3.2 #304) against pg-mem with the REAL migrations
// applied (001-013). Complements ai-admin.test.js by exercising the repo
// surface directly so the guard/edge branches (junk ids, partial updates,
// empty lists, timestamp coercion) are covered, not just the happy path the
// facade drives.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiConfigRepo } from './ai-config-repo'
import { createMemDb } from '../repositories/test-helpers'

const PROFILE = {
  name: 'OpenAI Primary',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  capabilities: ['classify', 'deduplicate'],
  secretCiphertext: 'ciphertext-payload',
  secretSet: true,
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createAiConfigRepo(db)
})

describe('insertProfile', () => {
  it('inserts with a server-assigned uuid and defaults active=false', async () => {
    const row = await repo.insertProfile(PROFILE)
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(row.active).toBe(false)
    expect(row.secretSet).toBe(true)
    expect(row.secretCiphertext).toBe('ciphertext-payload')
  })

  it('coerces missing fields to safe defaults (never 500)', async () => {
    const row = await repo.insertProfile({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })
    expect(row.name).toBe('')
    expect(row.providerType).toBe('openai')
    expect(row.baseUrl).toBe('https://api.openai.com/v1')
    expect(row.model).toBe('gpt-4o-mini')
    expect(row.capabilities).toEqual([])
    expect(row.fallbackProviderId).toBeNull()
    expect(row.secretCiphertext).toBeNull()
    expect(row.secretSet).toBe(false)
  })

  it('drops a junk fallback id and keeps a valid one', async () => {
    const junk = await repo.insertProfile({ ...PROFILE, fallbackProviderId: 'not-a-uuid' })
    expect(junk.fallbackProviderId).toBeNull()
    const a = await repo.insertProfile(PROFILE)
    const b = await repo.insertProfile({ ...PROFILE, fallbackProviderId: a.id })
    expect(b.fallbackProviderId).toBe(a.id)
  })
})

describe('listProfiles', () => {
  it('returns an empty list when none exist', async () => {
    expect(await repo.listProfiles()).toEqual([])
  })

  it('returns profiles in insertion order', async () => {
    const a = await repo.insertProfile({ ...PROFILE, name: 'A' })
    const b = await repo.insertProfile({ ...PROFILE, name: 'B' })
    const rows = await repo.listProfiles()
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id])
  })
})

describe('getProfile', () => {
  it('returns null for a junk or unknown id', async () => {
    expect(await repo.getProfile('not-a-uuid')).toBeNull()
    expect(await repo.getProfile('00000000-0000-0000-0000-000000000099')).toBeNull()
  })

  it('returns the row for a known id', async () => {
    const created = await repo.insertProfile(PROFILE)
    const got = await repo.getProfile(created.id)
    expect(got.id).toBe(created.id)
    expect(got.name).toBe(PROFILE.name)
  })
})

describe('updateProfile', () => {
  it('returns null for a junk id', async () => {
    expect(await repo.updateProfile('not-a-uuid', { name: 'X' })).toBeNull()
  })

  it('updates only the fields provided and leaves others intact', async () => {
    const created = await repo.insertProfile(PROFILE)
    const updated = await repo.updateProfile(created.id, { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.model).toBe(PROFILE.model)
    expect(updated.baseUrl).toBe(PROFILE.baseUrl)
    expect(updated.secretSet).toBe(true)
  })

  it('updates each field independently', async () => {
    const created = await repo.insertProfile(PROFILE)
    const updated = await repo.updateProfile(created.id, {
      providerType: 'openai',
      baseUrl: 'https://api.other.com/v1',
      model: 'gpt-5',
      capabilities: ['prioritize'],
      fallbackProviderId: null,
      lastTestOk: true,
      active: true,
    })
    expect(updated.baseUrl).toBe('https://api.other.com/v1')
    expect(updated.model).toBe('gpt-5')
    expect(updated.capabilities).toEqual(['prioritize'])
    expect(updated.lastTestOk).toBe(true)
    expect(updated.active).toBe(true)
  })

  it('clears the secret when secretSet is false', async () => {
    const created = await repo.insertProfile(PROFILE)
    const updated = await repo.updateProfile(created.id, { secretCiphertext: null, secretSet: false })
    expect(updated.secretSet).toBe(false)
    expect(updated.secretCiphertext).toBeNull()
  })

  it('no-op update returns the current row unchanged', async () => {
    const created = await repo.insertProfile(PROFILE)
    const updated = await repo.updateProfile(created.id, {})
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe(PROFILE.name)
  })
})

describe('deleteProfile', () => {
  it('returns false for a junk id', async () => {
    expect(await repo.deleteProfile('not-a-uuid')).toBe(false)
  })

  it('returns false for an unknown id', async () => {
    expect(await repo.deleteProfile('00000000-0000-0000-0000-000000000099')).toBe(false)
  })

  it('deletes a known profile and returns true', async () => {
    const created = await repo.insertProfile(PROFILE)
    expect(await repo.deleteProfile(created.id)).toBe(true)
    expect(await repo.getProfile(created.id)).toBeNull()
  })
})

describe('activateProfile', () => {
  it('returns null for a junk id', async () => {
    expect(await repo.activateProfile('not-a-uuid')).toBeNull()
  })

  it('returns null for an unknown id', async () => {
    expect(await repo.activateProfile('00000000-0000-0000-0000-000000000099')).toBeNull()
  })

  it('activates the target and deactivates any previously active profile', async () => {
    const a = await repo.insertProfile(PROFILE)
    const b = await repo.insertProfile({ ...PROFILE, name: 'B' })
    await repo.activateProfile(a.id)
    const activated = await repo.activateProfile(b.id)
    expect(activated.id).toBe(b.id)
    expect(activated.active).toBe(true)
    const rows = await repo.listProfiles()
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([b.id])
  })
})

describe('transaction', () => {
  it('commits the work when the callback succeeds', async () => {
    const result = await repo.transaction((txn) => txn.insertProfile(PROFILE))
    expect(result.id).toBeTruthy()
    expect((await repo.listProfiles()).length).toBe(1)
  })

  it('issues BEGIN -> fn -> COMMIT and always releases the client', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createAiConfigRepo(memDb)
    const fn = vi.fn()

    await txRepo.transaction(fn)

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT'])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('issues BEGIN -> fn -> ROLLBACK and rethrows on error', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createAiConfigRepo(memDb)
    const boom = new Error('boom')
    const fn = vi.fn(async () => { throw boom })

    await expect(txRepo.transaction(fn)).rejects.toThrow('boom')

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})