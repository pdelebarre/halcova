import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CollectionView from '../CollectionView'
import ListView from '../components/ListView'
import { recordsCatalog } from '../catalog'

// Same CollectionView integration harness as the other collection tests.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

const ITEMS = [
  { id: 'r1', title: 'Miles Davis - Kind of Blue', year: 1959, formatType: 'LP', genre: ['Jazz'], dateAdded: '2026-01-01T00:00:00Z' },
  { id: 'r2', title: 'Nina Simone - Little Girl Blue', year: 1958, formatType: 'LP', genre: ['Jazz'], dateAdded: '2026-01-02T00:00:00Z' },
  { id: 'r3', title: 'John Coltrane - A Love Supreme', year: 1965, formatType: 'LP', genre: ['Jazz'], dateAdded: '2026-01-03T00:00:00Z' },
  { id: 'r4', title: 'Aretha Franklin - I Never Loved a Man', year: 1967, formatType: 'LP', genre: ['Soul'], dateAdded: '2026-01-04T00:00:00Z' },
  { id: 'r5', title: 'Pink Floyd - The Dark Side of the Moon', year: 1973, formatType: 'LP', genre: ['Rock'], dateAdded: '2026-01-05T00:00:00Z' },
  { id: 'r6', title: 'Queen - A Night at the Opera', year: 1975, formatType: 'LP', genre: ['Rock'], dateAdded: '2026-01-06T00:00:00Z' },
]

function renderCollection(items = ITEMS, props = {}) {
  api.listItems.mockResolvedValue(items)
  return render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} {...props} />)
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  localStorage.removeItem('runout.browse.records')
  api.listItems.mockReset()
  api.updateItem.mockReset().mockResolvedValue({ ok: true })
})

describe('CollectionView — Index rails & jump-to-top (§ Phase 4)', () => {
  it('shows the mobile A–Z rail (horizontal strip) under 768px', () => {
    const { container } = render(
      <ListView items={ITEMS} sortBy="artist" copy={recordsCatalog.copy} onOpen={vi.fn()} />,
    )
    expect(container.querySelector('.jump-rail-mobile')).toBeInTheDocument()
    expect(container.querySelector('.jump-rail')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to M' })).toBeInTheDocument()
  })

  it('shows the vertical edge rail on desktop (≥768px)', () => {
    vi.stubGlobal('matchMedia', (query) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    const { container } = render(
      <ListView items={ITEMS} sortBy="artist" copy={recordsCatalog.copy} onOpen={vi.fn()} />,
    )
    expect(container.querySelector('.jump-rail')).toBeInTheDocument()
    expect(container.querySelector('.jump-rail-mobile')).not.toBeInTheDocument()
  })

  it('shows a jump-to-top button after deep scroll and scrolls the list back up', async () => {
    const { container } = renderCollection()
    await screen.findByRole('button', { name: 'List view' })
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    const scroller = container.querySelector('.list-scroller')
    expect(scroller).toBeTruthy()
    scroller.scrollTop = 600
    scroller.scrollTo = vi.fn()
    fireEvent.scroll(scroller)

    const jumpBtn = await screen.findByRole('button', { name: 'Back to top' })
    expect(jumpBtn).toBeInTheDocument()

    fireEvent.click(jumpBtn)
    expect(scroller.scrollTo).toHaveBeenCalled()
  })

  it('persists the browse path and restores it on a fresh mount', async () => {
    const items = Array.from({ length: 14 }, (_, i) => ({
      id: `r${i}`,
      title: `Artist ${i} - Album ${i}`,
      year: 1955 + i,
      formatType: 'LP',
      genre: i < 6 ? ['Rock'] : ['Jazz'],
      dateAdded: new Date(2026, 0, 1 + i).toISOString(),
    }))
    const { unmount, container } = renderCollection(items)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Browse all' })).toBeInTheDocument())

    // Pick the Rock bin via the aisle sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    const dialog = screen.getByRole('dialog', { name: 'Browse your crate' })
    fireEvent.click(within(dialog).getByRole('button', { name: /Rock/ }))
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(6))

    // Persisted.
    const saved = JSON.parse(localStorage.getItem('runout.browse.records'))
    expect(saved.activeAisle).toEqual({ axisId: 'genre', value: 'Rock' })

    unmount()
    api.listItems.mockClear()

    // A fresh mount restores the aisle filter.
    const second = renderCollection(items)
    await waitFor(() => expect(second.container.querySelectorAll('.album-card')).toHaveLength(6))
    expect(screen.getByRole('button', { name: 'Clear browse: Genre: Rock' })).toBeInTheDocument()
  })
})
