import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useReviews } from './useReviews'
import { saveSession } from '../utils/session'

// Mock the reviews API so the hook exercises real optimistic behavior without
// any network (same pattern as useCollection.test.js).
vi.mock('../api/reviews', () => ({
  listReviews: vi.fn(),
  upsertReview: vi.fn(),
  deleteReview: vi.fn(),
}))

import * as api from '../api/reviews'

// One published review by the caller (u1) + one by another member.
const MINE = {
  id: 'r1',
  kind: 'records',
  sourceId: '101',
  authorId: 'u1',
  authorName: 'Miles',
  rating: 5,
  body: 'Classic',
  status: 'published',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

const OTHER = {
  id: 'r2',
  kind: 'records',
  sourceId: '101',
  authorId: 'u2',
  authorName: 'Alice',
  rating: 4,
  body: 'Great',
  status: 'published',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
}

const PUBLISHED = [MINE, OTHER]

beforeEach(() => {
  vi.clearAllMocks()
  saveSession({ user: { id: 'u1', name: 'Miles' }, code: 'RU-AAAA-BBBB-CCCC' })
  api.listReviews.mockResolvedValue({ reviews: PUBLISHED, aggregate: { avg: 4.5, count: 2 }, mine: MINE })
})

describe('useReviews', () => {
  it('loads reviews + aggregate + mine and marks the member as signed in', async () => {
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(api.listReviews).toHaveBeenCalledWith('records', '101')
    expect(result.current.reviews).toEqual(PUBLISHED)
    expect(result.current.mine).toEqual(MINE)
    expect(result.current.signedIn).toBe(true)
    // The caller's review is merged into the display list once, on top.
    expect(result.current.allReviews[0].id).toBe('r1')
    expect(result.current.allReviews).toHaveLength(2)
  })

  it('derives the aggregate from the published list (avg + count)', async () => {
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.aggregate).toEqual({ avg: 4.5, count: 2 })
  })

  it('exposes signedIn=false and still loads the public reviews when not signed in', async () => {
    saveSession(null)
    // No caller → the server reports no `mine`, but the public list still loads.
    api.listReviews.mockResolvedValue({ reviews: PUBLISHED, aggregate: { avg: 4.5, count: 2 }, mine: null })
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.signedIn).toBe(false)
    expect(result.current.reviews).toEqual(PUBLISHED)
    expect(result.current.mine).toBeNull()
  })

  it('goes straight to ready with an empty thread when there is no sourceId', async () => {
    const { result } = renderHook(() => useReviews('records', null))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.listReviews).not.toHaveBeenCalled()
    expect(result.current.reviews).toEqual([])
    expect(result.current.mine).toBeNull()
    expect(result.current.aggregate).toEqual({ avg: 0, count: 0 })
  })

  it('surfaces a load error without throwing (dark-screen safety)', async () => {
    api.listReviews.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('network down')
  })

  it('exposes refresh so the section can offer a retry', async () => {
    api.listReviews.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(typeof result.current.refresh).toBe('function')
  })

  it('refresh recovers a failed thread and re-syncs mine + list (retry path)', async () => {
    api.listReviews.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(api.listReviews).toHaveBeenCalledTimes(1)

    await act(async () => { await result.current.refresh() })

    expect(api.listReviews).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('ready')
    expect(result.current.mine).toEqual(MINE)
    expect(result.current.reviews).toEqual(PUBLISHED)
    expect(result.current.aggregate).toEqual({ avg: 4.5, count: 2 })
  })

  it('shows a new review optimistically (and bumps the aggregate) before the upsert resolves', async () => {
    // No existing review for the caller.
    api.listReviews.mockResolvedValue({ reviews: [OTHER], aggregate: { avg: 4, count: 1 }, mine: null })
    let resolveUpsert
    api.upsertReview.mockReturnValue(new Promise((res) => { resolveUpsert = res }))
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let pending
    await act(async () => {
      pending = result.current.addOrUpdate(5, 'Brilliant')
    })

    // Optimistic before the API call resolves.
    expect(result.current.mine).toEqual(expect.objectContaining({ rating: 5, body: 'Brilliant' }))
    expect(result.current.allReviews[0].body).toBe('Brilliant')
    // The aggregate moves with the optimistic list: [5, 4].
    expect(result.current.aggregate).toEqual({ avg: 4.5, count: 2 })

    await act(async () => {
      resolveUpsert({
        review: {
          id: 'r9', kind: 'records', sourceId: '101', authorId: 'u1', authorName: 'Miles',
          rating: 5, body: 'Brilliant', status: 'published',
          createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z',
        },
      })
      await pending
    })
    // Adopts the server's authoritative review (real id).
    expect(result.current.mine.id).toBe('r9')
    expect(result.current.mine.authorName).toBe('Miles')
  })

  it('reverts the optimistic review and re-throws when the upsert rejects', async () => {
    api.upsertReview.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.addOrUpdate(3, 'meh')).rejects.toThrow('offline')
    })

    expect(result.current.mine).toEqual(MINE) // restored to the previous review
    expect(result.current.allReviews).toHaveLength(2)
  })

  it('clears mine optimistically and drops the deleted review from the list on remove', async () => {
    api.deleteReview.mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.remove()
    })

    expect(api.deleteReview).toHaveBeenCalledWith({ kind: 'records', sourceId: '101', id: 'r1' })
    expect(result.current.mine).toBeNull()
    expect(result.current.reviews).toEqual([OTHER]) // r1 dropped from the published list
    expect(result.current.aggregate).toEqual({ avg: 4, count: 1 })
  })

  it('restores mine and re-throws when the delete rejects', async () => {
    api.deleteReview.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useReviews('records', '101'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.remove()).rejects.toThrow('nope')
    })

    expect(result.current.mine).toEqual(MINE)
    expect(result.current.reviews).toEqual(PUBLISHED)
  })
})
