import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCollection } from './useCollection'

// Mock the collection API so the hook exercises real optimistic behavior
// without any network (same pattern as useCollection-pagination.test.jsx).
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

// The hook imports the lending API as a namespace — mock it the same way.
vi.mock('../api/lending', () => ({
  lend: vi.fn(),
  returnItem: vi.fn(),
}))

import * as api from '../api/collection'
import * as apiLending from '../api/lending'

const NOT_ON_LOAN = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  dateAdded: '2026-01-01T00:00:00Z',
}

// Ten historical loans so the return history cap (10) can be exercised.
const HISTORY = Array.from({ length: 10 }).map((_, i) => ({
  borrower: { name: `Old ${i}` },
  lentOn: '2026-01-01T00:00:00Z',
  returnedOn: '2026-02-01T00:00:00Z',
}))

const ON_LOAN = {
  ...NOT_ON_LOAN,
  lending: { borrower: { name: 'Alice', contact: 'a@x.com' }, lentOn: '2026-08-01T00:00:00Z', dueOn: '2026-09-01' },
  lendingHistory: HISTORY,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listItems.mockResolvedValue([NOT_ON_LOAN])
})

describe('useCollection — lending (W5)', () => {
  it('sets the lending optimistically and calls the lending API with the payload', async () => {
    apiLending.lend.mockResolvedValue({ id: 'r1' })
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.lend('r1', { borrower: { name: 'Bob', contact: 'bob@x.com' }, dueOn: '2026-12-31' })
    })

    expect(apiLending.lend).toHaveBeenCalledWith({
      collection: 'records',
      itemId: 'r1',
      borrower: { name: 'Bob', contact: 'bob@x.com' },
      dueOn: '2026-12-31',
    })
    const lending = result.current.items[0].lending
    expect(lending.borrower).toEqual({ name: 'Bob', contact: 'bob@x.com' })
    expect(lending.dueOn).toBe('2026-12-31')
    expect(lending.lentOn).toBeTruthy()
  })

  it('shows the optimistic lending before the API call resolves', async () => {
    let resolveLend
    apiLending.lend.mockReturnValue(new Promise((res) => { resolveLend = res }))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let pending
    await act(async () => {
      pending = result.current.lend('r1', { borrower: { name: 'Bob' } })
    })

    // The lending is visible even though the API promise is still pending.
    expect(result.current.items[0].lending.borrower.name).toBe('Bob')
    await act(async () => { resolveLend(); await pending })
  })

  it('omits dueOn and contact from the optimistic lending when not provided', async () => {
    apiLending.lend.mockResolvedValue({ id: 'r1' })
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.lend('r1', { borrower: { name: 'Bob' } })
    })

    const lending = result.current.items[0].lending
    expect(lending.borrower).toEqual({ name: 'Bob' })
    expect(lending.dueOn).toBeUndefined()
    expect(lending.borrower.contact).toBeUndefined()
  })

  it('reverts the optimistic lending and re-throws when the lend API rejects', async () => {
    apiLending.lend.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.lend('r1', { borrower: { name: 'Bob' } })).rejects.toThrow('offline')
    })

    expect(result.current.items[0].lending).toBeUndefined()
  })

  it('clears lending optimistically and prepends the returned loan to history (capped at 10)', async () => {
    api.listItems.mockResolvedValue([ON_LOAN])
    apiLending.returnItem.mockResolvedValue({ id: 'r1' })
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.returnItem('r1')
    })

    expect(apiLending.returnItem).toHaveBeenCalledWith({ collection: 'records', itemId: 'r1' })
    const item = result.current.items[0]
    expect(item.lending).toBeUndefined()
    expect(item.lendingHistory).toHaveLength(10) // cap, oldest dropped
    expect(item.lendingHistory[0].borrower.name).toBe('Alice')
    expect(item.lendingHistory[0].returnedOn).toBeTruthy()
  })

  it('reverts the optimistic return and re-throws when the return API rejects', async () => {
    api.listItems.mockResolvedValue([ON_LOAN])
    apiLending.returnItem.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.returnItem('r1')).rejects.toThrow('offline')
    })

    const item = result.current.items[0]
    expect(item.lending).toEqual(ON_LOAN.lending) // restored
    expect(item.lendingHistory).toEqual(HISTORY) // unchanged
  })
})
