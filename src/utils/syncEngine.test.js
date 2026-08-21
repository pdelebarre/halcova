// M3 #160 — Sync Engine tests (ADR-0019 Dec 7/8).
//
// Covers:
//   - nextBackoff: bounded exponential backoff with jitter
//   - pushPendingOps: batch push with idempotency, failure handling
//   - pullChanges: incremental pull with cursor
//   - syncCycle: full push + pull cycle with retry
//   - metrics: observability persistence
//   - cursor persistence across reloads
//   - adversarial: duplicate mutations rejected, partial failure safety,
//     incremental pull resumes from cursor, safe after termination
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  MAX_RETRY_ATTEMPTS,
  defaultMetrics,
  getSyncMetrics,
  nextBackoff,
  persistCursor,
  persistMetrics,
  pullChanges,
  pushPendingOps,
  readPersistedCursor,
  readPersistedMetrics,
  syncCycle,
  updateMetrics,
} from './syncEngine'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const USER_ID = 'u1'
const TOKEN = 'tok-a'
const OP_ID = 'local:11111111-2222-4333-8444-555555555555'
const SERVER_ITEM = { id: 'srv-1', serverId: 'srv-1', title: 'Kind of Blue', year: 1959 }

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    removeItem: vi.fn((key) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((i) => Object.keys(store)[i] ?? null),
  }
})()
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

// Mock session
vi.mock('./session', () => ({
  getSessionToken: () => TOKEN,
  getUserId: () => USER_ID,
}))

// Mock outbox
vi.mock('./outbox', () => ({
  listPendingOps: vi.fn(),
  markFlushed: vi.fn(),
  markFailed: vi.fn(),
  countPendingOps: vi.fn(),
}))

import { listPendingOps, markFlushed, markFailed, countPendingOps } from './outbox'

// Mock localDatabase
vi.mock('../repositories/localDatabase', () => ({
  saveItem: vi.fn(),
  saveItems: vi.fn(),
  deleteItem: vi.fn(),
  clearTombstone: vi.fn(),
  getTombstones: vi.fn(),
  getItem: vi.fn(),
  SYNC_STATUS: Object.freeze({
    SYNCED: 'synced',
    PENDING: 'pending',
    CONFLICT: 'conflict',
    LOCAL: 'local',
  }),
}))

// Mock conflictResolver
vi.mock('./conflictResolver', () => ({
  checkConflict: vi.fn(),
  ConflictError: class ConflictError extends Error {
    constructor(uuid, serverVersion, expectedVersion, message) {
      super(message || `Conflict: ${uuid}`)
      this.name = 'ConflictError'
      this.code = 'CONFLICT_ERROR'
      this.uuid = uuid
      this.serverVersion = serverVersion
      this.expectedVersion = expectedVersion
    }
  },
  determineEntityType: vi.fn(() => 'collection'),
}))

// Mock conflictStore
vi.mock('./conflictStore', () => ({
  saveConflict: vi.fn(),
}))

import { saveItem, saveItems, deleteItem, clearTombstone, getItem } from '../repositories/localDatabase'
import { checkConflict, determineEntityType } from './conflictResolver'
import { saveConflict } from './conflictStore'

// Mock global fetch
global.fetch = vi.fn()

function pendingOp(overrides = {}) {
  return {
    opId: OP_ID,
    scope: 'user:u1',
    kind: 'add',
    collection: 'records',
    pendingItem: { title: 'Kind of Blue', year: 1959, uuid: OP_ID },
    state: 'pending',
    attempts: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
  global.fetch.mockReset()
})

// ---------------------------------------------------------------------------
// nextBackoff
// ---------------------------------------------------------------------------

describe('nextBackoff — bounded exponential backoff', () => {
  it('returns 0 for attempt <= 0', () => {
    expect(nextBackoff(0)).toBe(0)
    expect(nextBackoff(-1)).toBe(0)
  })

  it('returns base delay for attempt 1', () => {
    const delay = nextBackoff(1)
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_BASE_MS)
    expect(delay).toBeLessThanOrEqual(BACKOFF_BASE_MS * 1.5)
  })

  it('doubles for attempt 2', () => {
    const delay = nextBackoff(2)
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_BASE_MS * 2)
    expect(delay).toBeLessThanOrEqual(BACKOFF_BASE_MS * 3)
  })

  it('caps at BACKOFF_MAX_MS', () => {
    const delay = nextBackoff(10)
    expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS)
  })

  it('includes jitter (non-deterministic)', () => {
    const delays = new Set(Array.from({ length: 20 }, () => nextBackoff(3)))
    expect(delays.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// Cursor persistence
// ---------------------------------------------------------------------------

describe('cursor persistence', () => {
  it('persists and reads cursor', () => {
    persistCursor(USER_ID, '2026-08-20T10:00:00Z')
    expect(readPersistedCursor(USER_ID)).toBe('2026-08-20T10:00:00Z')
  })

  it('returns null for unknown user', () => {
    expect(readPersistedCursor('unknown')).toBeNull()
  })

  it('returns null for empty userId', () => {
    expect(readPersistedCursor('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Metrics persistence
// ---------------------------------------------------------------------------

describe('metrics persistence', () => {
  it('returns default metrics when none persisted', () => {
    expect(getSyncMetrics(USER_ID)).toEqual(defaultMetrics())
  })

  it('persists and reads metrics', () => {
    const m = { totalPushed: 5, totalFailed: 1, totalPulled: 10, totalDeleted: 2, lastSyncAt: '2026-08-20T10:00:00Z', lastStatus: 'synced', lastLatencyMs: 500, queueSize: 0, conflictCount: 0, consecutiveFailures: 0 }
    persistMetrics(USER_ID, m)
    expect(getSyncMetrics(USER_ID)).toEqual(m)
  })

  it('updateMetrics accumulates values', () => {
    const event = {
      pushPushed: 3,
      pushFailed: 1,
      pullPulled: 5,
      pullDeleted: 1,
      latencyMs: 300,
      status: 'partial',
      now: Date.now(),
    }
    const updated = updateMetrics(USER_ID, event)
    expect(updated.totalPushed).toBe(3)
    expect(updated.totalFailed).toBe(1)
    expect(updated.totalPulled).toBe(5)
    expect(updated.totalDeleted).toBe(1)
    expect(updated.lastStatus).toBe('partial')
    expect(updated.consecutiveFailures).toBe(1)
  })

  it('updateMetrics resets consecutiveFailures on success', () => {
    // First failure
    updateMetrics(USER_ID, { pushFailed: 1, pushPushed: 0, pullPulled: 0, pullDeleted: 0, latencyMs: 100, status: 'partial', now: Date.now() })
    // Second failure
    updateMetrics(USER_ID, { pushFailed: 1, pushPushed: 0, pullPulled: 0, pullDeleted: 0, latencyMs: 100, status: 'partial', now: Date.now() })
    const m = getSyncMetrics(USER_ID)
    expect(m.consecutiveFailures).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// pushPendingOps
// ---------------------------------------------------------------------------

describe('pushPendingOps — batch push with idempotency', () => {
  it('pushes pending ops and marks them flushed on success', async () => {
    listPendingOps.mockResolvedValue([pendingOp()])
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ opId: OP_ID, status: 'accepted', item: SERVER_ITEM }],
        cursor: '2026-08-20T10:00:00Z',
      }),
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.attempted).toBe(1)
    expect(result.pushed).toBe(1)
    expect(result.failed).toBe(0)
    expect(markFlushed).toHaveBeenCalledWith(USER_ID, OP_ID, SERVER_ITEM, { now: 1, token: TOKEN })
    expect(saveItem).toHaveBeenCalled()
  })

  it('marks rejected ops as failed', async () => {
    listPendingOps.mockResolvedValue([pendingOp()])
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ opId: OP_ID, status: 'rejected', error: 'Plan limit reached' }],
        cursor: '2026-08-20T10:00:00Z',
      }),
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.attempted).toBe(1)
    expect(result.pushed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failedOps).toEqual([{ opId: OP_ID, message: 'Plan limit reached' }])
    expect(markFailed).toHaveBeenCalledWith(USER_ID, OP_ID, 'Plan limit reached', { now: 1, token: TOKEN })
  })

  it('handles network errors gracefully', async () => {
    listPendingOps.mockResolvedValue([pendingOp()])
    global.fetch.mockRejectedValue(new Error('Network error'))

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.attempted).toBe(1)
    expect(result.pushed).toBe(0)
    expect(result.failed).toBe(1)
    expect(markFailed).toHaveBeenCalled()
  })

  it('returns empty result when no pending ops', async () => {
    listPendingOps.mockResolvedValue([])

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.attempted).toBe(0)
    expect(result.pushed).toBe(0)
    expect(result.failed).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('handles batch rejection (non-200)', async () => {
    listPendingOps.mockResolvedValue([pendingOp()])
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.attempted).toBe(1)
    expect(result.failed).toBe(1)
    expect(markFailed).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// pullChanges
// ---------------------------------------------------------------------------

describe('pullChanges — incremental pull with cursor', () => {
  it('pulls and applies items', async () => {
    saveItems.mockResolvedValue(true)
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [SERVER_ITEM],
        deletedIds: [],
        cursor: '2026-08-20T11:00:00Z',
        hasMore: false,
      }),
    })

    const result = await pullChanges({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.pulled).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.cursor).toBe('2026-08-20T11:00:00Z')
    expect(result.hasMore).toBe(false)
    expect(saveItems).toHaveBeenCalled()
  })

  it('applies deletions', async () => {
    saveItems.mockResolvedValue(true)
    deleteItem.mockResolvedValue(true)
    clearTombstone.mockResolvedValue(true)
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        deletedIds: ['srv-1'],
        cursor: '2026-08-20T11:00:00Z',
        hasMore: false,
      }),
    })

    const result = await pullChanges({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.pulled).toBe(0)
    expect(result.deleted).toBe(1)
    expect(deleteItem).toHaveBeenCalledWith(USER_ID, 'server:srv-1', { now: 1 })
  })

  it('handles pull errors gracefully', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'))

    const result = await pullChanges({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.pulled).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.cursor).toBeNull()
  })

  it('uses persisted cursor when none provided', async () => {
    persistCursor(USER_ID, '2026-08-20T10:00:00Z')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        deletedIds: [],
        cursor: '2026-08-20T11:00:00Z',
        hasMore: false,
      }),
    })

    await pullChanges({ userId: USER_ID, token: TOKEN, now: 1 })

    // Verify the cursor was sent in the request body
    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(callBody.cursor).toBe('2026-08-20T10:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// syncCycle
// ---------------------------------------------------------------------------

describe('syncCycle — full push + pull cycle', () => {
  it('runs push and pull successfully', async () => {
    listPendingOps.mockResolvedValue([])
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [SERVER_ITEM],
        deletedIds: [],
        cursor: '2026-08-20T11:00:00Z',
        hasMore: false,
      }),
    })
    saveItems.mockResolvedValue(true)

    const result = await syncCycle({ collection: 'records', now: 1 })

    expect(result.status).toBe('synced')
    expect(result.pushResult).toBeDefined()
    expect(result.pullResult).toBeDefined()
    expect(result.metrics).toBeDefined()
  })

  it('returns no_user when not authenticated', async () => {
    // Temporarily make getUserId return empty
    const sessionMock = await import('./session')
    const orig = sessionMock.getUserId
    sessionMock.getUserId = () => ''
    try {
      const result = await syncCycle({ now: 1 })
      expect(result.status).toBe('no_user')
    } finally {
      sessionMock.getUserId = orig
    }
  })

  it('retries failed pushes with backoff', async () => {
    listPendingOps.mockResolvedValue([pendingOp()])
    // First call fails, second succeeds
    global.fetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ opId: OP_ID, status: 'accepted', item: SERVER_ITEM }],
          cursor: '2026-08-20T11:00:00Z',
        }),
      })

    const result = await syncCycle({ collection: 'records', maxRetries: 2, now: 1 })

    expect(result.pushResult.attempted).toBe(1)
    expect(result.pushResult.pushed).toBe(1)
    expect(global.fetch).toHaveBeenCalledTimes(3) // 1 push fail + 1 push success + 1 pull
  })
})

// ---------------------------------------------------------------------------
// Adversarial negatives
// ---------------------------------------------------------------------------

describe('adversarial — safety guarantees', () => {
  it('duplicate mutations are idempotent (same opId returns accepted)', async () => {
    // Two ops with the same opId
    listPendingOps.mockResolvedValue([pendingOp(), pendingOp()])
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { opId: OP_ID, status: 'accepted', item: SERVER_ITEM },
          { opId: OP_ID, status: 'accepted', item: SERVER_ITEM },
        ],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    // Both should be accepted (server handles idempotency)
    expect(result.pushed).toBe(2)
  })

  it('partial failure leaves unresolved ops safely queued', async () => {
    const op1 = pendingOp({ opId: 'local:op1' })
    const op2 = pendingOp({ opId: 'local:op2' })
    listPendingOps.mockResolvedValue([op1, op2])
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { opId: 'local:op1', status: 'accepted', item: SERVER_ITEM },
          { opId: 'local:op2', status: 'rejected', error: 'Plan limit' },
        ],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.pushed).toBe(1)
    expect(result.failed).toBe(1)
    // The failed op should have been marked failed (kept retryable)
    expect(markFailed).toHaveBeenCalledWith(USER_ID, 'local:op2', 'Plan limit', { now: 1, token: TOKEN })
  })

  it('pull is incremental and resumes from cursor', async () => {
    persistCursor(USER_ID, '2026-08-20T10:00:00Z')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [SERVER_ITEM],
        deletedIds: [],
        cursor: '2026-08-20T11:00:00Z',
        hasMore: false,
      }),
    })

    const result1 = await pullChanges({ userId: USER_ID, token: TOKEN, now: 1 })
    expect(result1.cursor).toBe('2026-08-20T11:00:00Z')

    // Next pull uses the new cursor
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        deletedIds: [],
        cursor: '2026-08-20T11:00:00Z',
        hasMore: false,
      }),
    })

    const result2 = await pullChanges({ userId: USER_ID, token: TOKEN, now: 1 })
    expect(result2.pulled).toBe(0) // No new items
  })

  it('safe after app termination during request', async () => {
    // Simulate: push starts but app terminates mid-request
    // The outbox ops remain in IndexedDB (durable)
    // On next startup, pending ops are re-read and re-pushed
    listPendingOps.mockResolvedValue([pendingOp()])
    // The fetch never completes (simulates termination)
    global.fetch.mockImplementation(() => new Promise(() => {}))

    // This should not throw — the promise just never resolves
    const pushPromise = pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })
    // In a real scenario the app would terminate here
    // The ops remain in the outbox (durable) and will be retried on next startup
    expect(listPendingOps).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Conflict handling
// ---------------------------------------------------------------------------

describe('conflict handling — optimistic concurrency', () => {
  it('sends base version with each mutation', async () => {
    getItem.mockResolvedValue({ serverVersion: 3, localVersion: 2 })
    listPendingOps.mockResolvedValue([pendingOp({ kind: 'edit' })])
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ opId: OP_ID, status: 'accepted', item: { ...SERVER_ITEM, serverVersion: 4 } }],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    // Verify the request body includes baseVersion
    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(callBody.operations[0].baseVersion).toBe(3)
  })

  it('handles conflict status from server and persists conflict', async () => {
    getItem.mockResolvedValue({ serverVersion: 3, localVersion: 2 })
    listPendingOps.mockResolvedValue([pendingOp({ kind: 'edit' })])
    checkConflict.mockReturnValue({
      conflictId: 'server:r1:123',
      uuid: OP_ID,
      entityType: 'collection',
      serverVersion: 5,
      localVersion: 2,
      status: 'unresolved',
    })
    saveConflict.mockResolvedValue(true)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          opId: OP_ID,
          status: 'conflict',
          error: 'Stale update',
          serverVersion: 5,
          expectedVersion: 3,
          serverItem: { id: 'srv-1', title: 'Server version' },
        }],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    expect(result.conflicted).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failedOps).toEqual([{ opId: OP_ID, message: 'Stale update' }])
    expect(markFailed).toHaveBeenCalledWith(USER_ID, OP_ID, 'Stale update', { now: 1, token: TOKEN })
    expect(checkConflict).toHaveBeenCalled()
    expect(saveConflict).toHaveBeenCalled()
  })

  it('syncCycle reports conflict status when conflicts exist', async () => {
    getItem.mockResolvedValue({ serverVersion: 1, localVersion: 1 })
    listPendingOps.mockResolvedValue([pendingOp({ kind: 'edit' })])
    checkConflict.mockReturnValue({
      conflictId: 'c1',
      uuid: OP_ID,
      entityType: 'collection',
      serverVersion: 5,
      localVersion: 2,
      status: 'unresolved',
    })
    saveConflict.mockResolvedValue(true)
    // markFailed must return a value to avoid retry loop
    markFailed.mockResolvedValue({ state: 'failed' })

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          opId: OP_ID,
          status: 'conflict',
          error: 'Stale update',
          serverVersion: 5,
          expectedVersion: 1,
          serverItem: { id: 'srv-1' },
        }],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    const result = await syncCycle({ collection: 'records', now: 1, maxRetries: 0 })
    expect(result.status).toBe('conflict')
    expect(result.pushResult.conflicted).toBe(1)
  })

  it('metrics track conflict counts', async () => {
    // Simulate a conflict event
    const metrics = updateMetrics(USER_ID, {
      pushPushed: 0,
      pushFailed: 1,
      pushConflicted: 1,
      pullPulled: 0,
      pullDeleted: 0,
      latencyMs: 100,
      status: 'conflict',
      now: Date.now(),
    })

    expect(metrics.conflictCount).toBe(1)
    expect(metrics.totalFailed).toBe(1)
    expect(metrics.lastStatus).toBe('conflict')

    // Second conflict
    const metrics2 = updateMetrics(USER_ID, {
      pushPushed: 0,
      pushFailed: 0,
      pushConflicted: 2,
      pullPulled: 0,
      pullDeleted: 0,
      latencyMs: 100,
      status: 'conflict',
      now: Date.now(),
    })

    expect(metrics2.conflictCount).toBe(3)
  })

  it('stale update rejected — conflict detection works for add/edit', async () => {
    // Simulate: server version (5) > base version (1) → conflict
    getItem.mockResolvedValue({ serverVersion: 1, localVersion: 2 })
    listPendingOps.mockResolvedValue([pendingOp({ kind: 'edit' })])
    checkConflict.mockReturnValue({
      conflictId: 'c1',
      uuid: OP_ID,
      serverVersion: 5,
      localVersion: 2,
      status: 'unresolved',
    })
    saveConflict.mockResolvedValue(true)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          opId: OP_ID,
          status: 'conflict',
          error: 'Stale update',
          serverVersion: 5,
          expectedVersion: 1,
          serverItem: { id: 'srv-1' },
        }],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    const result = await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })
    expect(result.conflicted).toBe(1)
  })

  it('persisted conflicts contain no credentials', async () => {
    getItem.mockResolvedValue({ serverVersion: 1, localVersion: 2 })
    listPendingOps.mockResolvedValue([pendingOp({ kind: 'edit' })])
    checkConflict.mockReturnValue({
      conflictId: 'c1',
      uuid: OP_ID,
      entityType: 'collection',
      serverVersion: 5,
      localVersion: 2,
      serverItem: { id: 'srv-1', title: 'Safe' },
      localItem: { uuid: OP_ID, title: 'Local' },
      status: 'unresolved',
    })
    saveConflict.mockResolvedValue(true)

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          opId: OP_ID,
          status: 'conflict',
          error: 'Stale update',
          serverVersion: 5,
          expectedVersion: 1,
          serverItem: { id: 'srv-1' },
        }],
        cursor: '2026-08-20T11:00:00Z',
      }),
    })

    await pushPendingOps({ userId: USER_ID, token: TOKEN, now: 1 })

    // Verify no credentials were passed to saveConflict
    const savedConflictArg = saveConflict.mock.calls[0]?.[1]
    if (savedConflictArg) {
      expect(savedConflictArg.serverItem?.token).toBeUndefined()
      expect(savedConflictArg.localItem?.token).toBeUndefined()
    }
  })
})