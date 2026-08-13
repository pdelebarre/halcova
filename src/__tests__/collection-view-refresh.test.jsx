import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'

// Same CollectionView integration harness as grid-lending-badge.test.jsx — the
// real useCollection hook runs against a mocked collection API.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

const ITEM = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  dateAdded: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  api.listItems.mockReset().mockResolvedValue([ITEM])
})

describe('CollectionView — refreshTick (W7)', () => {
  it('does not double-fetch on mount when refreshTick is provided', async () => {
    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} refreshTick={0} />,
    )

    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(api.listItems).toHaveBeenCalledTimes(1)
    expect(api.listItems).toHaveBeenCalledWith('records')
  })

  it('re-fetches the collection when refreshTick changes', async () => {
    const { container, rerender } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} refreshTick={0} />,
    )
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(api.listItems).toHaveBeenCalledTimes(1)

    // App bumps refreshTick after e.g. returning an item from the loans dashboard.
    rerender(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} refreshTick={1} />)
    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(2))
  })
})
