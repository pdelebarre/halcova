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

// ---------------------------------------------------------------------------
// Push — error branches
// ---------------------------------------------------------------------------

describe('sync push — error branches', () => {
  it('rejects when readJsonBody fails', async () => {
    readJsonBody.mockResolvedValue({ error: { status: 400, body: { error: 'Bad request' } } })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(400)
  })

  it('rejects when collection is not in user plan', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    resolveSession.mockResolvedValue({
      user: { id: 'u1', role: 'member', collections: { books: true } },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('PLAN_LIMIT')
  })

  it('rejects add with invalid item payload', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: '' } }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)
    validateItem.mockReturnValueOnce({ error: 'Title is required' })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('rejected')
    expect(response.body.results[0].error).toBe('Title is required')
  })

  it('rejects add when plan limit is reached', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)
    planLimitFor.mockReturnValueOnce(1)
    ensureOwnedCount.mockResolvedValueOnce(1)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('rejected')
    expect(response.body.results[0].code).toBe('PLAN_LIMIT')
  })

  it('handles update operation successfully', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op2',
          kind: 'update',
          itemId: 'srv-1',
          patch: { title: 'Updated Title' },
        }],
        collection: 'records',
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'item:srv-1') return { id: 'srv-1', title: 'Original' }
      return null
    })
    validateItem.mockReturnValueOnce({ error: null, item: { title: 'Updated Title' } })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
    expect(response.body.results[0].opId).toBe('local:op2')
  })

  it('rejects update with missing itemId', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op3',
          kind: 'update',
          patch: { title: 'Updated' },
        }],
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
    expect(response.body.results[0].error).toContain('Missing itemId')
  })

  it('rejects update when item not found', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op4',
          kind: 'update',
          itemId: 'nonexistent',
          patch: { title: 'Updated' },
        }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('rejected')
    expect(response.body.results[0].code).toBe('NOT_FOUND')
  })

  it('handles delete operation successfully', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op5',
          kind: 'delete',
          itemId: 'srv-1',
        }],
        collection: 'records',
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'item:srv-1') return { id: 'srv-1', title: 'To Delete', wishlist: false }
      return null
    })
    readIndex.mockResolvedValue(['srv-1', 'srv-2'])

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
    expect(response.body.results[0].item).toBeNull()
  })

  it('handles delete of already-deleted item (idempotent)', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op6',
          kind: 'delete',
          itemId: 'already-deleted',
        }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
    expect(response.body.results[0].item).toBeNull()
  })

  it('rejects delete with missing itemId', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op7',
          kind: 'delete',
        }],
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
    expect(response.body.results[0].error).toContain('Missing itemId')
  })

  it('catches internal errors in processPushOp', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op8', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)
    // Make readIndex throw inside processPushOp to trigger the catch-all
    readIndex.mockRejectedValueOnce(new Error('Index failure'))

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('rejected')
    expect(response.body.results[0].error).toBe('Index failure')
  })
})

// ---------------------------------------------------------------------------
// Push — idempotency replay
// ---------------------------------------------------------------------------

describe('sync push — idempotency replay', () => {
  it('returns existing item when idempotency mapping exists and item is found', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op1',
          kind: 'add',
          item: { title: 'Kind of Blue' },
        }],
        collection: 'records',
      },
    })
    // lookupIdempotency returns an itemId
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'idempotency:local:op1') return { itemId: 'srv-1' }
      if (key === 'item:srv-1') return { id: 'srv-1', title: 'Kind of Blue' }
      return null
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
    expect(response.body.results[0].item.id).toBe('srv-1')
  })

  it('falls through to create when idempotency mapping exists but item is gone', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{
          opId: 'local:op2',
          kind: 'add',
          item: { title: 'New Item' },
        }],
        collection: 'records',
      },
    })
    // lookupIdempotency returns an itemId, but the item no longer exists
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'idempotency:local:op2') return { itemId: 'srv-gone' }
      if (key === 'item:srv-gone') return null
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
    // Should have created a new item (not the old one)
    expect(response.body.results[0].item.id).not.toBe('srv-gone')
  })
})

// ---------------------------------------------------------------------------
// Pull — error branches and edge cases
// ---------------------------------------------------------------------------

describe('sync pull — error branches and edge cases', () => {
  it('rejects when readJsonBody fails', async () => {
    readJsonBody.mockResolvedValue({ error: { status: 400, body: { error: 'Bad request' } } })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(400)
  })

  it('rejects when collection is not in user plan', async () => {
    readJsonBody.mockResolvedValue({
      value: { cursor: '2026-08-20T10:00:00Z', collection: 'records' },
    })
    resolveSession.mockResolvedValue({
      user: { id: 'u1', role: 'member', collections: { books: true } },
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('PLAN_LIMIT')
  })

  it('handles pull with no cursor and no stored cursor', async () => {
    readJsonBody.mockResolvedValue({
      value: { collection: 'records', limit: 100 },
    })
    // No cursor provided, stored cursor is null
    mockStore.get.mockResolvedValue(null)
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
    expect(response.body.cursor).toBeDefined()
  })

  it('returns hasMore when more entries exist than limit', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'records',
        limit: 1,
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'cursor:u1:records') return '2026-08-20T10:00:00Z'
      return null
    })
    // Return 2 entries with limit=1 => hasMore should be true
    mockStore.list.mockReturnValue(async function* () {
      yield { key: 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1' }
      yield { key: 'synclog:u1:records:2026-08-20T12:00:00Z:srv-2' }
    }())
    mockStore.setJSON.mockResolvedValue(undefined)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.hasMore).toBe(true)
  })

  it('handles corrupt sync log entries gracefully', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'records',
        limit: 100,
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'cursor:u1:records') return '2026-08-20T10:00:00Z'
      if (key === 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1') throw new Error('Corrupt entry')
      if (key === 'synclog:u1:records:2026-08-20T12:00:00Z:srv-2') return { itemId: 'srv-2', kind: 'add', timestamp: '2026-08-20T12:00:00Z' }
      if (key === 'item:srv-2') return { id: 'srv-2', title: 'Surviving Item' }
      return null
    })
    mockStore.list.mockReturnValue(async function* () {
      yield { key: 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1' }
      yield { key: 'synclog:u1:records:2026-08-20T12:00:00Z:srv-2' }
    }())
    mockStore.setJSON.mockResolvedValue(undefined)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    // The corrupt entry should be skipped, only srv-2 should be returned
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].id).toBe('srv-2')
  })

  it('handles deleted entries in sync log', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'records',
        limit: 100,
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'cursor:u1:records') return '2026-08-20T10:00:00Z'
      if (key === 'item:srv-1') return { id: 'srv-1', title: 'Existing Item' }
      return null
    })
    mockStore.list.mockReturnValue(async function* () {
      yield { key: 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1' }
      yield { key: 'synclog:u1:records:2026-08-20T12:00:00Z:srv-2' }
    }())
    // First entry is a delete, second is an add
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'cursor:u1:records') return '2026-08-20T10:00:00Z'
      if (key === 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1') return { itemId: 'srv-1', kind: 'delete', timestamp: '2026-08-20T11:00:00Z' }
      if (key === 'synclog:u1:records:2026-08-20T12:00:00Z:srv-2') return { itemId: 'srv-2', kind: 'add', timestamp: '2026-08-20T12:00:00Z' }
      if (key === 'item:srv-2') return { id: 'srv-2', title: 'New Item' }
      return null
    })
    mockStore.setJSON.mockResolvedValue(undefined)

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.deletedIds).toContain('srv-1')
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].id).toBe('srv-2')
  })

  it('handles fetch failure for individual items', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        cursor: '2026-08-20T10:00:00Z',
        collection: 'records',
        limit: 100,
      },
    })
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'cursor:u1:records') return '2026-08-20T10:00:00Z'
      if (key === 'synclog:u1:records:2026-08-20T11:00:00Z:srv-1') return { itemId: 'srv-1', kind: 'add', timestamp: '2026-08-20T11:00:00Z' }
      if (key === 'item:srv-1') throw new Error('Fetch failed')
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
    // Item fetch failed, so items should be empty
    expect(response.body.items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Cursor management edge cases
// ---------------------------------------------------------------------------

describe('cursor management — error resilience', () => {
  it('readCursor returns null on store error', async () => {
    readJsonBody.mockResolvedValue({
      value: { cursor: '2026-08-20T10:00:00Z', collection: 'records', limit: 100 },
    })
    mockStore.get.mockRejectedValue(new Error('Store error'))

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    // Should still return a valid response (cursor defaults to null)
    expect(response.status).toBe(200)
  })

  it('writeCursor handles store error gracefully', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)
    readIndex.mockResolvedValue([])
    // Make set throw to test writeCursor catch
    mockStore.set.mockRejectedValueOnce(new Error('Write failed'))

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    // Should still succeed — writeCursor errors are best-effort
    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
  })

  it('recordIdempotency handles store error gracefully', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)
    readIndex.mockResolvedValue([])
    // Make setJSON reject only for idempotency keys to test recordIdempotency catch
    mockStore.setJSON.mockImplementation(async (key) => {
      if (key.startsWith('idempotency:')) throw new Error('Write failed')
      return undefined
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
  })

  it('lookupIdempotency returns null on store error', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    // lookupIdempotency throws -> returns null -> falls through to create
    mockStore.get.mockRejectedValue(new Error('Store error'))
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

  it('appendSyncLog handles store error gracefully', async () => {
    readJsonBody.mockResolvedValue({
      value: {
        operations: [{ opId: 'local:op1', kind: 'add', item: { title: 'Test' } }],
        collection: 'records',
      },
    })
    mockStore.get.mockResolvedValue(null)
    readIndex.mockResolvedValue([])
    // Make setJSON reject only for synclog keys to test appendSyncLog catch
    mockStore.setJSON.mockImplementation(async (key) => {
      if (key.startsWith('synclog:')) throw new Error('Write failed')
      return undefined
    })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.results[0].status).toBe('accepted')
  })

  it('readSyncLogSince outer catch returns empty on store list error', async () => {
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
    // Make list throw to test readSyncLogSince outer catch
    mockStore.list.mockImplementation(() => { throw new Error('List failed') })

    const handler = await import('./sync')
    const req = new Request('http://localhost/.netlify/functions/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler.default(req)

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    expect(response.body.hasMore).toBe(false)
  })
})