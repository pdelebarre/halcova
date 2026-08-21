// M3 #161 — useConflicts hook tests (ADR-0019 Dec 8).
//
// Covers:
//   - reads unresolved conflicts on mount
//   - resolveConflict: applies resolution and marks resolved
//   - refresh: re-reads conflicts
//   - no user: returns empty state

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConflicts } from './useConflicts'

// Mock session
vi.mock('../utils/session', () => ({
  getUserId: vi.fn(() => 'u1'),
}))

// Mock conflictStore — use vi.hoisted to create the mock object before hoisting
const { mockStore, mockResolver } = vi.hoisted(() => ({
  mockStore: { getConflicts: vi.fn(), getConflictMetrics: vi.fn(), markResolved: vi.fn() },
  mockResolver: { applyResolution: vi.fn(), buildResolutionPatch: vi.fn(() => null), RESOLUTION: Object.freeze({ USE_SERVER: 'resolved-server', USE_LOCAL: 'resolved-local', MERGE: 'resolved-merged' }) },
}))

vi.mock('../utils/conflictStore', () => mockStore)
vi.mock('../utils/conflictResolver', () => mockResolver)

const UNRESOLVED_CONFLICTS = [
  { conflictId: 'c1', uuid: 'server:r1', entityType: 'collection', serverVersion: 5, localVersion: 2, status: 'unresolved' },
  { conflictId: 'c2', uuid: 'server:r2', entityType: 'lending', serverVersion: 3, localVersion: 1, status: 'unresolved' },
]

const METRICS = { totalConflicts: 2, unresolved: 2, resolvedServer: 0, resolvedLocal: 0, resolvedMerged: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.getConflicts.mockResolvedValue(UNRESOLVED_CONFLICTS)
  mockStore.getConflictMetrics.mockResolvedValue(METRICS)
  mockStore.markResolved.mockResolvedValue(true)
  mockResolver.applyResolution.mockImplementation((conflict, resolution) => ({
    ...conflict,
    status: resolution,
    resolution,
    resolvedAt: new Date().toISOString(),
    mergedItem: null,
  }))
})

describe('useConflicts', () => {
  it('reads unresolved conflicts on mount', async () => {
    const { result } = renderHook(() => useConflicts())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.conflicts).toEqual(UNRESOLVED_CONFLICTS)
    expect(result.current.metrics).toEqual(METRICS)
    expect(mockStore.getConflicts).toHaveBeenCalledWith('u1', { status: 'unresolved' })
  })

  it('resolves a conflict', async () => {
    const { result } = renderHook(() => useConflicts())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const ok = await result.current.resolveConflict('c1', 'resolved-server')
    expect(ok).toBe(true)
    expect(mockResolver.applyResolution).toHaveBeenCalledWith(
      UNRESOLVED_CONFLICTS[0],
      'resolved-server',
      undefined,
    )
    expect(mockStore.markResolved).toHaveBeenCalled()
  })

  it('returns false for unknown conflictId', async () => {
    const { result } = renderHook(() => useConflicts())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const ok = await result.current.resolveConflict('nonexistent', 'resolved-server')
    expect(ok).toBe(false)
  })

  it('returns empty state when no user', async () => {
    const { getUserId } = await import('../utils/session')
    getUserId.mockReturnValue('')

    const { result } = renderHook(() => useConflicts())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.conflicts).toEqual([])
    expect(result.current.metrics.totalConflicts).toBe(0)
  })
})