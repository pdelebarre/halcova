import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'

// Same CollectionView integration harness as the floor tests — the real
// useCollection hook runs against a mocked collection API.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

function makeItems(n, opts = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    title: `Artist ${i} - Album ${i}`,
    year: 1955 + i,
    formatType: 'LP',
    label: `Label ${i % 3}`,
    genre: i < 6 ? ['Rock'] : i < 12 ? ['Jazz'] : ['Funk'],
    dateAdded: new Date(2026, 0, 1 + i).toISOString(),
    ...(opts[i] || {}),
  }))
}

function renderCollection(props = {}) {
  return render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} {...props} />)
}

function openBrowse() {
  fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
  return screen.getByRole('dialog', { name: 'Browse your crate' })
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  api.listItems.mockReset()
  api.updateItem.mockReset().mockResolvedValue({ ok: true })
})

describe('CollectionView — The Aisles (§ Phase 2)', () => {
  it('opens the browse sheet from the toolbar with axis chips and genre bins + counts', async () => {
    api.listItems.mockResolvedValue(makeItems(14))
    renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    const dialog = openBrowse()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: 'Genre' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Decade' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Format' })).toBeInTheDocument()

    // A–Z bins with live counts: Funk 2, Jazz 6, Rock 6.
    expect(within(dialog).getByRole('button', { name: /Funk/ })).toHaveTextContent('2')
    expect(within(dialog).getByRole('button', { name: /Jazz/ })).toHaveTextContent('6')
    expect(within(dialog).getByRole('button', { name: /Rock/ })).toHaveTextContent('6')
  })

  it('selecting a bin filters the collection and shows an active aisle chip', async () => {
    api.listItems.mockResolvedValue(makeItems(14))
    const { container } = renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    const dialog = openBrowse()
    fireEvent.click(within(dialog).getByRole('button', { name: /Rock/ }))

    // Sheet closes and the grid drops to the 6 Rock items (flat, floor hidden).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(6))
    expect(screen.getByRole('button', { name: 'Clear browse: Genre: Rock' })).toBeInTheDocument()
  })

  it('decade axis buckets years and shows Other for missing years', async () => {
    const items = makeItems(10)
    items[9].year = undefined // no year → "Other"
    api.listItems.mockResolvedValue(items)
    renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    const dialog = openBrowse()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decade' }))

    // Years 1955–1963 (item 9 has no year): 1950s×5, 1960s×4, Other×1.
    const bins = within(dialog)
    expect(bins.getByRole('button', { name: /1950s/ })).toHaveTextContent('5')
    expect(bins.getByRole('button', { name: /1960s/ })).toHaveTextContent('4')
    expect(bins.getByRole('button', { name: /Other/ })).toHaveTextContent('1')
  })

  it('clear browse removes the filter and restores the full collection', async () => {
    api.listItems.mockResolvedValue(makeItems(14))
    const { container } = renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    const dialog = openBrowse()
    fireEvent.click(within(dialog).getByRole('button', { name: /Rock/ }))
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(6))

    fireEvent.click(screen.getByRole('button', { name: 'Clear browse: Genre: Rock' }))
    // Back to the Floor: shelf of 5 + Browse all of 14 = 19 cards.
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(19))
    expect(screen.queryByRole('button', { name: /Clear browse/ })).not.toBeInTheDocument()
  })

  it('composes the aisle filter with search', async () => {
    api.listItems.mockResolvedValue(makeItems(14))
    const { container } = renderCollection()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    const dialog = openBrowse()
    fireEvent.click(within(dialog).getByRole('button', { name: /Jazz/ }))
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(6))

    // "Album 7" is a Jazz item — searching narrows the Jazz bin to just it.
    fireEvent.change(screen.getByPlaceholderText('Search your crate…'), { target: { value: 'Album 7' } })
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(screen.getByText('Album 7')).toBeInTheDocument()
  })
})
