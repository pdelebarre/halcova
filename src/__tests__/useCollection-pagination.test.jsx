import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCollection } from '../hooks/useCollection'

// Mock the collection API module so the hook exercises real optimistic
// add/update/remove behavior without any network. Pagination is not part of
// the current API — the hook loads the full list, so the tests assert that
// contract rather than a fake paged one.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

const KIND_OF_BLUE = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  dateAdded: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listItems.mockResolvedValue([KIND_OF_BLUE])
})

describe('useCollection', () => {
  it('loads the full collection for the requested store on mount', async () => {
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.listItems).toHaveBeenCalledWith('records')
    expect(result.current.items).toEqual([KIND_OF_BLUE])
  })

  it('prepends a newly added item to the top of the list', async () => {
    api.addItem.mockImplementation(async (item) => ({ ...item, id: 'r2' }))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.add({ title: 'Nina Simone - Little Girl Blue' })
    })

    expect(api.addItem).toHaveBeenCalledWith({ title: 'Nina Simone - Little Girl Blue' }, 'records')
    expect(result.current.items[0]).toMatchObject({ id: 'r2' })
  })

  it('updates optimistically and rolls back when the API rejects', async () => {
    api.updateItem.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.update('r1', { year: 1960 })).rejects.toThrow('offline')
    })

    expect(result.current.items[0].year).toBe(1959)
  })

  it('removes optimistically and rolls back when the API rejects', async () => {
    api.deleteItem.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.remove('r1')).rejects.toThrow('offline')
    })

    expect(result.current.items).toHaveLength(1)
  })

  it('surfaces load failures through status and error', async () => {
    api.listItems.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatch(/boom/)
  })
})
