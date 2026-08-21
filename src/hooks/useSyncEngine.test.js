// M3 #160 — useSyncEngine hook tests (ADR-0019 Dec 7/8).
//
// Covers:
//   - Initial state: idle syncState, default metrics, zero pending
//   - Startup sync: triggers syncCycle after startupDelayMs
//   - Online event: triggers sync on window 'online' event
//   - Visibility change: triggers sync on document visibilitychange
//   - Manual sync: sync() calls syncCycle and updates state
//   - Sync states: synced, partial, error, idle
//   - Pending count: refreshed after sync
//   - No user: early return without crashing
//   - Already syncing: returns null (no concurrent sync)
//   - Error state: syncCycle throws sets syncState 'error'
//   - Unmount safety: no state updates after unmount
//   - Adversarial: flaky connectivity (mid-cycle failure from cursor)
//   - Adversarial: offline-to-online recovery
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// Mock session
vi.mock('../utils/session', () => ({
  getSessionToken: vi.fn(),
  getUserId: vi.fn(),
}))

import { getSessionToken, getUserId } from '../utils/session'

// Mock syncEngine
const mockSyncCycle = vi.fn()
const mockGetSyncMetrics = vi.fn()
const mockDefaultMetrics = vi.fn(() => ({
  totalPushed: 0,
  totalFailed: 0,
  totalPulled: 0,
  totalDeleted: 0,
  lastSyncAt: null,
  lastStatus: 'idle',
  lastLatencyMs: 0,
  queueSize: 0,
  conflictCount: 0,
  consecutiveFailures: 0,
}))

vi.mock('../utils/syncEngine', () => ({
  syncCycle: (...args) => mockSyncCycle(...args),
  getSyncMetrics: (...args) => mockGetSyncMetrics(...args),
  defaultMetrics: (...args) => mockDefaultMetrics(...args),
}))

// Mock outbox
vi.mock('../utils/outbox', () => ({
  countPendingOps: vi.fn(),
}))

import { countPendingOps } from '../utils/outbox'

const USER_ID = 'u1'
const TOKEN = 'tok-a'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  getSessionToken.mockReturnValue(TOKEN)
  getUserId.mockReturnValue(USER_ID)
  countPendingOps.mockResolvedValue(0)
  mockGetSyncMetrics.mockReturnValue(mockDefaultMetrics())
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useSyncEngine — initial state', () => {
  it('renders with idle syncState and default metrics', () => {
    const { result } = renderHook(() => useSyncEngine())

    expect(result.current.syncState).toBe('idle')
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.metrics).toEqual(mockDefaultMetrics())
    expect(result.current.lastResult).toBeNull()
    expect(typeof result.current.sync).toBe('function')
  })

  it('refreshes pending count and metrics on mount', () => {
    renderHook(() => useSyncEngine())

    expect(countPendingOps).toHaveBeenCalledWith(USER_ID, { token: TOKEN })
    expect(mockGetSyncMetrics).toHaveBeenCalledWith(USER_ID)
  })

  it('sets pending count to 0 when no user', () => {
    getUserId.mockReturnValue('')

    const { result } = renderHook(() => useSyncEngine())

    expect(result.current.pendingCount).toBe(0)
    expect(countPendingOps).not.toHaveBeenCalled()
  })

  it('sets default metrics when no user', () => {
    getUserId.mockReturnValue('')

    const { result } = renderHook(() => useSyncEngine())

    expect(result.current.metrics).toEqual(mockDefaultMetrics())
    expect(mockGetSyncMetrics).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Startup sync
// ---------------------------------------------------------------------------

describe('useSyncEngine — startup sync', () => {
  it('triggers syncCycle after startupDelayMs', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    renderHook(() => useSyncEngine({ startupDelayMs: 1000 }))

    // Before the timer fires, sync should not have been called
    expect(mockSyncCycle).not.toHaveBeenCalled()

    // Advance past the delay
    await act(async () => { vi.advanceTimersByTime(1000) })

    expect(mockSyncCycle).toHaveBeenCalledWith({ collection: 'records' })
  })

  it('uses custom collection in syncCycle', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    renderHook(() => useSyncEngine({ collection: 'books', startupDelayMs: 500 }))

    await act(async () => { vi.advanceTimersByTime(500) })

    expect(mockSyncCycle).toHaveBeenCalledWith({ collection: 'books' })
  })

  it('does not call sync when there is no user', async () => {
    getUserId.mockReturnValue('')

    renderHook(() => useSyncEngine({ startupDelayMs: 100 }))

    await act(async () => { vi.advanceTimersByTime(100) })

    expect(mockSyncCycle).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Online event
// ---------------------------------------------------------------------------

describe('useSyncEngine — online event', () => {
  it('triggers sync on window online event', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Fire the online event
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mockSyncCycle).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Visibility change
// ---------------------------------------------------------------------------

describe('useSyncEngine — visibility change', () => {
  it('triggers sync when document becomes visible', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Simulate visibility change to visible
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockSyncCycle).toHaveBeenCalled()
  })

  it('does not trigger sync when document becomes hidden', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // Should NOT have called sync (only visible triggers sync)
    expect(mockSyncCycle).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Manual sync
// ---------------------------------------------------------------------------

describe('useSyncEngine — manual sync', () => {
  it('sync() calls syncCycle and updates state on success', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      await result.current.sync()
    })

    expect(mockSyncCycle).toHaveBeenCalledWith({ collection: 'records' })
    expect(result.current.syncState).toBe('synced')
    expect(result.current.lastResult).toBeTruthy()
  })

  it('sets syncState to syncing during sync', async () => {
    // Return a promise that we control
    let resolveSync
    mockSyncCycle.mockReturnValue(new Promise((resolve) => { resolveSync = resolve }))

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Start sync but don't resolve yet
    let syncPromise
    act(() => { syncPromise = result.current.sync() })

    expect(result.current.syncState).toBe('syncing')

    // Resolve the sync
    resolveSync({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })
    await act(async () => { await syncPromise })

    expect(result.current.syncState).toBe('synced')
  })

  it('sets syncState to partial when sync returns partial status', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'partial', pushResult: { failed: 1 }, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      await result.current.sync()
    })

    expect(result.current.syncState).toBe('partial')
  })

  it('sets syncState to idle when sync returns idle status', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'idle', pushResult: {}, pullResult: {}, totalLatencyMs: 0, metrics: mockDefaultMetrics() })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      await result.current.sync()
    })

    expect(result.current.syncState).toBe('idle')
  })

  it('returns null when already syncing (no concurrent sync)', async () => {
    let resolveSync
    mockSyncCycle.mockReturnValue(new Promise((resolve) => { resolveSync = resolve }))

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    let firstPromise
    act(() => { firstPromise = result.current.sync() })

    // Try to sync again while first is in progress
    const secondResult = await result.current.sync()
    expect(secondResult).toBeNull()

    // Resolve the first sync
    resolveSync({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })
    await act(async () => { await firstPromise })
  })

  it('returns null when there is no user', async () => {
    getUserId.mockReturnValue('')

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    const syncResult = await result.current.sync()
    expect(syncResult).toBeNull()
    expect(mockSyncCycle).not.toHaveBeenCalled()
  })

  it('refreshes pending count and metrics after successful sync', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      await result.current.sync()
    })

    // countPendingOps should have been called again after sync
    expect(countPendingOps).toHaveBeenCalledTimes(2) // once on mount, once after sync
    expect(mockGetSyncMetrics).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('useSyncEngine — error state', () => {
  it('sets syncState to error when syncCycle throws', async () => {
    mockSyncCycle.mockRejectedValue(new Error('Network failure'))

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      await result.current.sync()
    })

    expect(result.current.syncState).toBe('error')
    expect(result.current.lastResult).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Unmount safety
// ---------------------------------------------------------------------------

describe('useSyncEngine — unmount safety', () => {
  it('does not update state after unmount', async () => {
    let resolveSync
    mockSyncCycle.mockReturnValue(new Promise((resolve) => { resolveSync = resolve }))

    const { result, unmount } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Start sync
    let syncPromise
    act(() => { syncPromise = result.current.sync() })

    // Unmount before sync completes
    unmount()

    // Resolve the sync (should not update state)
    resolveSync({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })
    await act(async () => { await syncPromise })

    // After unmount, state should not have been updated
    // (no assertion on state since it's unmounted — we're checking no errors)
  })

  it('cleans up timer on unmount', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    const { unmount } = renderHook(() => useSyncEngine({ startupDelayMs: 1000 }))

    // Unmount before timer fires
    unmount()

    // Advance past the delay
    await act(async () => { vi.advanceTimersByTime(1000) })

    // Sync should not have been called (timer was cleared)
    expect(mockSyncCycle).not.toHaveBeenCalled()
  })

  it('removes online event listener on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
  })

  it('removes visibilitychange listener on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})

// ---------------------------------------------------------------------------
// Adversarial: flaky connectivity
// ---------------------------------------------------------------------------

describe('useSyncEngine — adversarial flaky connectivity', () => {
  it('recovers after mid-cycle failure from cursor', async () => {
    // First sync fails mid-cycle
    mockSyncCycle.mockRejectedValueOnce(new Error('Cursor fetch failed'))

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // First sync attempt fails
    await act(async () => {
      await result.current.sync()
    })
    expect(result.current.syncState).toBe('error')

    // Second sync attempt succeeds (recovery)
    mockSyncCycle.mockResolvedValueOnce({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    await act(async () => {
      await result.current.sync()
    })
    expect(result.current.syncState).toBe('synced')
    expect(result.current.lastResult).toBeTruthy()
  })

  it('handles partial push failure then full recovery on retry', async () => {
    // First sync: partial failure (some ops failed)
    mockSyncCycle.mockResolvedValueOnce({
      status: 'partial',
      pushResult: { attempted: 2, pushed: 1, failed: 1, failedOps: [{ opId: 'op1', message: 'Plan limit' }] },
      pullResult: { pulled: 0, deleted: 0, cursor: null, hasMore: false, latencyMs: 50 },
      totalLatencyMs: 150,
      metrics: { ...mockDefaultMetrics(), totalFailed: 1, lastStatus: 'partial' },
    })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    await act(async () => {
      await result.current.sync()
    })
    expect(result.current.syncState).toBe('partial')

    // Second sync: full recovery
    mockSyncCycle.mockResolvedValueOnce({
      status: 'synced',
      pushResult: { attempted: 1, pushed: 1, failed: 0, failedOps: [], latencyMs: 50 },
      pullResult: { pulled: 2, deleted: 0, cursor: '2026-08-20T12:00:00Z', hasMore: false, latencyMs: 50 },
      totalLatencyMs: 100,
      metrics: { ...mockDefaultMetrics(), totalPushed: 1, totalPulled: 2, lastStatus: 'synced' },
    })

    await act(async () => {
      await result.current.sync()
    })
    expect(result.current.syncState).toBe('synced')
  })
})

// ---------------------------------------------------------------------------
// Adversarial: offline-to-online recovery
// ---------------------------------------------------------------------------

describe('useSyncEngine — offline-to-online recovery', () => {
  it('syncs on online event after being offline', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Simulate coming back online
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mockSyncCycle).toHaveBeenCalled()
    expect(result.current.syncState).toBe('synced')
  })

  it('syncs on visibility change after returning to app', async () => {
    mockSyncCycle.mockResolvedValue({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Simulate returning to the app tab
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockSyncCycle).toHaveBeenCalled()
    expect(result.current.syncState).toBe('synced')
  })

  it('recovers from error state when online event fires', async () => {
    // First sync fails
    mockSyncCycle.mockRejectedValueOnce(new Error('Offline'))

    const { result } = renderHook(() => useSyncEngine({ startupDelayMs: 10000 }))

    // Initial sync attempt (startup)
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    // Wait for the async error to propagate
    await act(async () => {})
    expect(result.current.syncState).toBe('error')

    // Now come online and sync again
    mockSyncCycle.mockResolvedValueOnce({ status: 'synced', pushResult: {}, pullResult: {}, totalLatencyMs: 100, metrics: mockDefaultMetrics() })

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.syncState).toBe('synced')
  })
})

// Need to import the hook at the bottom so mocks are set up first
import { useSyncEngine } from './useSyncEngine'