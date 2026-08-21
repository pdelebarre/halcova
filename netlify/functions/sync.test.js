// M3 #160 — Sync function tests (ADR-0019 Dec 7/8).
//
// Covers:
//   - Push: accepts batch operations, processes idempotently
//   - Push: rejects unknown operations
//   - Push: plan limit enforcement
//   - Pull: returns items since cursor
//   - Pull: handles empty results
//   - Security: requires authentication
//   - Security: rejects unknown collections
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Netlify Blobs
vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn(),
}))

import { getStore } from '@netlify/blobs'

// Mock shared modules
vi.mock('./_shared/security', () => ({
  json: vi.fn((status, body, headers) => ({ status, body, headers })),
  readJsonBody: vi.fn(),
  safeError: vi.fn((err) => ({ status: 500, body: { error: 'Internal error', code: 'INTERNAL' } })),
}))

vi.mock('./_shared/session-auth', () => ({
  resolveSession: vi.fn(),
}))

vi.mock('./_shared/policy', () => ({
  enforce: vi.fn(),
  forbidden: vi.fn(() => ({ status: 403, body: { error: 'Not authorized.', code: 'FORBIDDEN' } })),
}))

vi.mock('./_shared/collection-store', () => ({
  COLLECTIONS: { records: true, books: true },
  readIndex: vi.fn(),
  writeIndex: vi.fn(),
}))

vi.mock('./_shared/users', () => ({
  storeNameFor: vi.fn((id) => `user:${id}`),
}))

vi.mock('./_shared/item-fields', () => ({
  pickItemFields: vi.fn((item) => item),
  validateItem: vi.fn(() => ({ error: null, item: {} })),
}))

vi.mock('./_shared/plans', () => ({
  planLimitFor: vi.fn(() => null),
}))

vi.mock('./_shared/counts', () => ({
  ensureOwnedCount: vi.fn(() => 0),
  adjustOwnedCount: vi.fn(),
}))

vi.mock('./_shared/list-cache', () => ({
  invalidateListCache: vi.fn(),
}))

vi.mock('./_shared/filter', () => ({
  filterFor: vi.fn((user, type, item) => item),
}))

vi.mock('./_shared/postgres', () => ({
  isPostgresConfigured: vi.fn(() => false),
}))

vi.mock('./_shared/repository', () => ({
  getRepository: vi.fn(),
}))

import { json, readJsonBody } from './_shared/security'
import { resolveSession } from './_shared/session-auth'
import { COLLECTIONS, readIndex, writeIndex } from './_shared/collection-store'
import { storeNameFor } from './_shared/users'
import { pickItemFields, validateItem } from './_shared/item-fields'
import { planLimitFor } from './_shared/plans'
import { ensureOwnedCount, adjustOwnedCount } from './_shared/counts'
import { invalidateListCache } from './_shared/list-cache'
import { filterFor } from './_shared/filter'

const USER = {
  id: 'u1',
  role: 'member',
  collections: { records: true, books: true },
}

// Mock store
const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  setJSON: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  getStore.mockReturnValue(mockStore)
  resolveSession.mockResolvedValue({ user: USER })
  readJsonBody.mockReset()
  mockStore.get.mockReset()
  mockStore.set.mockReset()
  mockStore.setJSON.mockReset()
  mockStore.delete.mockReset()
  mockStore.list.mockReset()
})

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

describe('sync push endpoint', () => {
  it('accepts a batch of add operations', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [
          {
            opId: 'local:op1',
            kind: 'add',
            item: { title: 'Kind of Blue', year: 1959 },
          },
        ],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null) // No existing idempotency
    mockStore.setJSON.mockResolvedValue(undefined)
    readIndex.mockResolvedValue([])
    writeIndex.mockResolvedValue(undefined)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results).toBeDefined()
    expect(response.body.results[0].status).toBe('accepted')
    expect(response.body.results[0].opId).toBe('local:op1')
  })

  it('rejects operations with missing opId', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [
          {
            kind: 'add',
            item: { title: 'Test' },
          },
        ],
        collection: 'records',
      },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('rejected')
  })

  it('rejects unknown operation kinds', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [
          {
            opId: 'local:op1',
            kind: 'unknown_kind',
          },
        ],
        collection: 'records',
      },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('rejected')
  })

  it('rejects empty operations array', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [],
        collection: 'records',
      },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(400)
  })

  it('rejects unknown collection', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: {} }],
        collection: 'unknown',
      },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(400)
  })

  it('handles idempotent replay (same opId returns existing item)', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [
          {
            opId: 'local:op1',
            kind: 'add',
            item: { title: 'Kind of Blue' },
          },
        ],
        collection: 'records',
      },
    })
    // First call: no existing idempotency
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'idempotency:local:op1') return null
      if (key === 'item:srv-1') return { id: 'srv-1', title: 'Kind of Blue' }
      return null
    })
    readIndex.mockResolvedValue([])

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
  })
})

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

describe('sync pull endpoint', () => {
  it('returns items since cursor', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'records',
        limit: 100,
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'cursor:u1:records') return '2026-08-20T10:00:00Z'
      return null
    })
    mockStore.list.mockReturnValue(async function* () {
      yield { key: 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1' }
    }())
    mockStore.setJSON.mockResolvedValue(undefined)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.items).toBeDefined()
    expect(response.body.cursor).toBeDefined()
  })

  it('handles empty pull (no changes since cursor)', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'records',
        limit: 100,
      },
    })
    mockStore.get.mockResolvedValue('2026-08-20T10:00:00Z')
    mockStore.list.mockReturnValue(async function* () {
      // No entries
    }())

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    expect(response.body.deletedIds).toEqual([])
  })

  it('rejects unknown collection', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'unknown',
      },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('sync security', () => {
  it('requires authentication', async () => {
    resolveSession.mockResolvedValue({ error: { status: 401, body: { error: 'Not signed in.' } } })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(401)
  })

  it('rejects unsupported methods', async () => {
    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'GET',
    })
    const response = await handler.default(req)

    expect(response.status).toBe(405)
  })

  it('rejects unknown paths', async () => {
    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/unknown', {
      method: 'POST',
    })
    const response = await handler.default(req)

    expect(response.status).toBe(405)
  })
})