import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const ITEMS = [
  { id: 'r0', title: 'Nirvana - Nevermind', year: 1991, formatType: 'LP', label: 'DGC', genre: ['Grunge'], dateAdded: '2026-01-01T00:00:00Z' },
  { id: 'r1', title: 'Miles Davis - Kind of Blue', year: 1959, formatType: 'LP', label: 'Columbia', genre: ['Jazz'], dateAdded: '2026-01-02T00:00:00Z' },
  { id: 'r2', title: 'Café Tacuba - Re', year: 1994, formatType: 'LP', label: 'Warner', genre: ['Rock'], dateAdded: '2026-01-03T00:00:00Z' },
  { id: 'r3', title: 'John Coltrane - A Love Supreme', year: 1965, formatType: 'LP', label: 'Impulse!', genre: ['Jazz'], dateAdded: '2026-01-04T00:00:00Z' },
]

function renderCollection(items = ITEMS, props = {}) {
  api.listItems.mockResolvedValue(items)
  return render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} {...props} />)
}

function searchInput() {
  return screen.getByPlaceholderText('Search your crate…')
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  localStorage.removeItem('runout.recentSearches.records')
  api.listItems.mockReset()
  api.updateItem.mockReset().mockResolvedValue({ ok: true })
})

describe('CollectionView — The Catalog (§ Phase 3)', () => {
  it('matches a typo (extra character) in an artist name', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))

    fireEvent.change(searchInput(), { target: { value: 'Nirvanaa' } })
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(screen.getByText('Nevermind')).toBeInTheDocument()
  })

  it('matches diacritic-insensitively (Café ↔ cafe)', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))

    fireEvent.change(searchInput(), { target: { value: 'cafe' } })
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(screen.getByText('Re')).toBeInTheDocument()
  })

  it('ranks a title match above a genre match', async () => {
    const items = [
      { id: 'a', title: 'Jazz Butcher - Album A', year: 1984, formatType: 'LP', label: 'X', genre: ['Post-punk'], dateAdded: '2026-01-01T00:00:00Z' },
      { id: 'b', title: 'Other - Album B', year: 2000, formatType: 'LP', label: 'Y', genre: ['Jazz'], dateAdded: '2026-01-02T00:00:00Z' },
    ]
    const { container } = renderCollection(items)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    fireEvent.change(searchInput(), { target: { value: 'jazz' } })
    // Both items still match; wait for the debounced, ranked re-render.
    await waitFor(() => {
      const first = container.querySelector('.album-card-title')?.textContent
      expect(first).toBe('Album A')
    })
  })

  it('highlights the matched substring in results', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))

    fireEvent.change(searchInput(), { target: { value: 'blue' } })
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))

    const mark = container.querySelector('mark.search-hit')
    expect(mark).toBeTruthy()
    // Highlight preserves the original casing of the matched substring.
    expect(mark.textContent).toBe('Blue')
  })

  it('shows a results header with a match count and a Clear action', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))

    fireEvent.change(searchInput(), { target: { value: 'blue' } })
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(screen.getByText(/1 match for/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search results' }))
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))
  })

  it('suggests a did-you-mean for a near-miss that matches nothing', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))

    // "Nirvnaa" is 2 edits from "Nirvana" — past the single-typo search
    // tolerance, so the search finds nothing and offers a suggestion.
    fireEvent.change(searchInput(), { target: { value: 'Nirvnaa' } })
    const dym = await screen.findByRole('button', { name: 'nirvana' })
    expect(dym).toBeInTheDocument()

    fireEvent.click(dym)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
    expect(screen.getByText('Nevermind')).toBeInTheDocument()
  })

  it('remembers recent searches and lets you tap to re-run one', async () => {
    const { container } = renderCollection()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(4))

    const input = searchInput()
    fireEvent.change(input, { target: { value: 'blue' } })
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))

    // Blur commits the search to history; clearing + focusing shows it again.
    fireEvent.blur(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.focus(input)

    const recent = screen.getByRole('button', { name: 'blue' })
    expect(recent).toBeInTheDocument()

    fireEvent.click(recent)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
  })
})
