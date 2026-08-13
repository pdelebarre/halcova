import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'

// Same CollectionView integration harness as the other collection tests.
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
    genre: i < 6 ? ['Rock'] : i < 12 ? ['Jazz'] : ['Funk'],
    dateAdded: new Date(2026, 0, 1 + i).toISOString(),
  }))
}

function renderCollection(items = makeItems(14), props = {}) {
  api.listItems.mockResolvedValue(items)
  return render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} {...props} />)
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  localStorage.removeItem('runout.browse.records')
  localStorage.removeItem('runout.views.records')
  api.listItems.mockReset()
  api.updateItem.mockReset().mockResolvedValue({ ok: true })
  api.deleteItem.mockReset()
})

describe('CollectionView — Smart views & stats (§ Phase 5)', () => {
  it('keeps wishlist wants out of the owned crate and lists them in the sheet', async () => {
    const items = makeItems(14)
    items[0].wishlist = true
    const { container } = renderCollection(items)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    // 13 owned — the want never appears in the crate/grid.
    expect(container.querySelectorAll('.album-grid .album-card')).toHaveLength(13)

    // The Wishlist toolbar button (count badge) opens the sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Wishlist' }))
    const dialog = screen.getByRole('dialog', { name: 'Your wishlist' })
    expect(within(dialog).getByText('Album 0')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add to crate' })).toBeInTheDocument()
  })

  it('converts a wishlist want into an owned item — it lands on the shelf', async () => {
    const items = makeItems(13)
    items[0].wishlist = true
    const { container } = renderCollection(items)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())
    expect(container.querySelectorAll('.album-grid .album-card')).toHaveLength(12)

    fireEvent.click(screen.getByRole('button', { name: 'Wishlist' }))
    const dialog = screen.getByRole('dialog', { name: 'Your wishlist' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to crate' }))

    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(items[0].id, { wishlist: false }, 'records'))
    await waitFor(() => expect(container.querySelectorAll('.album-grid .album-card')).toHaveLength(13))
    expect(screen.queryByRole('dialog', { name: 'Your wishlist' })).not.toBeInTheDocument()
  })

  it('removes a wishlist want', async () => {
    const items = makeItems(13)
    items[0].wishlist = true
    renderCollection(items)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Wishlist' }))
    const dialog = screen.getByRole('dialog', { name: 'Your wishlist' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from wishlist' }))

    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(items[0].id, 'records'))
  })

  it('saves a view, persists it, resets, and re-applies it', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    // The Floor's shelf cards also carry .album-card, so count grid cards only.
    const gridCards = (c) => c.querySelectorAll('.album-grid .album-card')
    // Reopen the sheet while Rock is still active — the toolbar button then
    // reads "1 active" rather than "Filter" (see § Phase 5).
    const openFilters = () => screen.getByRole('button', { name: /Filter|active/i })

    // Save "My Rock" from the filter sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    let dialog = screen.getByRole('dialog', { name: 'Filters' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rock' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Name this view/ }), { target: { value: 'My Rock' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save view' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(gridCards(container)).toHaveLength(6))

    // Persisted per kind.
    const saved = JSON.parse(localStorage.getItem('runout.views.records'))
    expect(saved[0].name).toBe('My Rock')

    // Reset the filters, then re-apply the saved view.
    fireEvent.click(openFilters())
    dialog = screen.getByRole('dialog', { name: 'Filters' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(gridCards(container)).toHaveLength(14))

    fireEvent.click(openFilters())
    dialog = screen.getByRole('dialog', { name: 'Filters' })
    fireEvent.click(within(dialog).getByRole('button', { name: /^My Rock/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(gridCards(container)).toHaveLength(6))
  })

  it('opens stats and shows genre + decade counts', async () => {
    renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Stats' }))
    const dialog = screen.getByRole('dialog', { name: 'Your crate, by the numbers' })
    expect(within(dialog).getByText('By genre')).toBeInTheDocument()
    expect(within(dialog).getByText('Rock')).toBeInTheDocument()
    expect(within(dialog).getByText('Funk')).toBeInTheDocument()
    expect(within(dialog).getByText('By decade')).toBeInTheDocument()
  })
})
