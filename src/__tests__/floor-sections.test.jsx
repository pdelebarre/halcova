import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'

// Same CollectionView integration harness as collection-view-refresh.test.jsx —
// the real useCollection hook runs against a mocked collection API.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    title: `Artist ${i} - Album ${i}`,
    year: 1955 + i,
    formatType: 'LP',
    dateAdded: new Date(2026, 0, 1 + i).toISOString(),
  }))
}

function renderCollection(props = {}) {
  return render(
    <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} {...props} />,
  )
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  api.listItems.mockReset()
  api.updateItem.mockReset().mockResolvedValue({ ok: true })
})

describe('CollectionView — The Floor (§ Phase 1)', () => {
  it('shows New arrivals + Browse all once the collection grows past 5 items (grid, default sort)', async () => {
    api.listItems.mockResolvedValue(makeItems(6))
    const { container } = renderCollection()

    // 5 on the "New arrivals" shelf + 6 in the "Browse all" wall below.
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(11))
    expect(screen.getByRole('heading', { name: 'New arrivals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument()
  })

  it('keeps the plain grid at exactly 5 items (the Floor needs more than 5)', async () => {
    api.listItems.mockResolvedValue(makeItems(5))
    const { container } = renderCollection()

    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(5))
    expect(screen.queryByRole('heading', { name: 'New arrivals' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Browse all' })).not.toBeInTheDocument()
  })

  it('shows an On loan shelf when lending is enabled and an item is out', async () => {
    const items = makeItems(14)
    items[0].lending = { borrower: { name: 'A' }, lentOn: '2026-02-01T00:00:00Z' }
    api.listItems.mockResolvedValue(items)

    renderCollection({ lendingEnabled: true })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'On loan' })).toBeInTheDocument())
  })

  it('hides the On loan shelf when lending is disabled', async () => {
    const items = makeItems(14)
    items[0].lending = { borrower: { name: 'A' }, lentOn: '2026-02-01T00:00:00Z' }
    api.listItems.mockResolvedValue(items)

    renderCollection({ lendingEnabled: false })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'New arrivals' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'On loan' })).not.toBeInTheDocument()
  })

  it('shows a Pinned shelf for pinned items', async () => {
    const items = makeItems(14)
    items[3].pinned = true
    api.listItems.mockResolvedValue(items)

    renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pinned' })).toBeInTheDocument())
  })

  it('hides the Floor when a search query is active (flat results instead)', async () => {
    api.listItems.mockResolvedValue(makeItems(14))
    const { container } = renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'New arrivals' })).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Search your crate…'), { target: { value: 'Album 3' } })

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'New arrivals' })).not.toBeInTheDocument())
    // Only the single match renders, in the plain flat grid.
    expect(container.querySelectorAll('.album-card')).toHaveLength(1)
  })

  it('hides the Floor in List view', async () => {
    localStorage.setItem('runout.view.records', 'list')
    api.listItems.mockResolvedValue(makeItems(14))

    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelector('.list-view')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'New arrivals' })).not.toBeInTheDocument()
  })

  it('Crate dive opens a random item detail (deterministic with Math.random mocked)', async () => {
    api.listItems.mockResolvedValue(makeItems(14))
    renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open a random record from your crate' }))
    randomSpy.mockRestore()

    // Math.random() === 0 → the first item in the array → Artist 0 / Album 0.
    expect(screen.getByRole('dialog', { name: 'Album 0' })).toBeInTheDocument()
  })

  it('Pin toggles an item from the detail sheet and persists it', async () => {
    api.listItems.mockResolvedValue(makeItems(3))
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(3))

    fireEvent.click(container.querySelector('.album-card'))
    fireEvent.click(screen.getByRole('button', { name: 'Pin to top' }))

    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(expect.any(String), { pinned: true }, 'records'),
    )
    // Optimistic UI flips the button to the pinned state.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unpin' })).toHaveAttribute('aria-pressed', 'true'),
    )
  })
})
