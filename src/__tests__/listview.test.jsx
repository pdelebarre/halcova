import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CollectionView from '../CollectionView'
import ListView from '../components/ListView'
import { recordsCatalog } from '../catalog'

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

const ITEMS = [
  { id: 'r1', title: 'Miles Davis - Kind of Blue', year: 1959, formatType: 'LP', label: 'Columbia', genre: ['Jazz'], dateAdded: '2026-01-01T00:00:00Z' },
  { id: 'r2', title: 'Nina Simone - Little Girl Blue', year: 1958, formatType: 'LP', label: 'Bethlehem', genre: ['Jazz'], dateAdded: '2026-01-02T00:00:00Z' },
]

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  api.listItems.mockResolvedValue(ITEMS)
})

describe('ListView', () => {
  it('renders one button per item with an accessible label', () => {
    render(
      <ListView
        items={ITEMS}
        sortBy="added"
        copy={recordsCatalog.copy}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Miles Davis — Kind of Blue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nina Simone — Little Girl Blue' })).toBeInTheDocument()
  })

  it('groups rows under sticky letter headers with a jump rail for artist sort', () => {
    const { container } = render(
      <ListView
        items={ITEMS}
        sortBy="artist"
        copy={recordsCatalog.copy}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Jump to M' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to N' })).toBeInTheDocument()
    expect(container.querySelectorAll('.list-group-header')).toHaveLength(2)
  })
})

describe('Grid|List view toggle', () => {
  it('switches from the grid to the list and remembers the choice per kind', async () => {
    render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />)

    await screen.findByRole('button', { name: 'List view' })

    // Grid is the default: one card per item.
    expect(screen.getAllByRole('button', { name: /Kind of Blue|Little Girl Blue/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Miles Davis — Kind of Blue' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    // Dense list rows replace the grid cards.
    expect(screen.getByRole('button', { name: 'Miles Davis — Kind of Blue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nina Simone — Little Girl Blue' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Kind of Blue|Little Girl Blue/ })).toHaveLength(2)

    // The choice is remembered per kind.
    expect(localStorage.getItem('runout.view.records')).toBe('list')
  })

  it('announces "Showing N of M" to screen readers', async () => {
    render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />)

    await screen.findByRole('button', { name: 'List view' })
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2')
  })
})

describe('letterOf — accented characters', () => {
  const ACCENTED_ITEMS = [
    { id: 'a1', title: 'Édith Piaf - La Vie en Rose', year: 1946, formatType: 'LP' },
    { id: 'a2', title: 'Ástor Piazzolla - Libertango', year: 1974, formatType: 'LP' },
    { id: 'a3', title: 'Özdemir Erdoğan - Aşk', year: 1970, formatType: 'LP' },
    { id: 'a4', title: 'Ümit Aksu - Dönüş', year: 1980, formatType: 'LP' },
    { id: 'a5', title: 'Çiğdem Aslan - Mortissa', year: 2013, formatType: 'LP' },
    { id: 'a6', title: 'Miles Davis - Kind of Blue', year: 1959, formatType: 'LP' },
  ]

  it('groups accented first letters under their own headers (É, Á, Ö, Ü, Ç)', () => {
    // Use fewer items (4) so all headers render within the windowed viewport.
    const items = [
      { id: 'a1', title: 'Édith Piaf - La Vie en Rose', year: 1946, formatType: 'LP' },
      { id: 'a2', title: 'Ástor Piazzolla - Libertango', year: 1974, formatType: 'LP' },
      { id: 'a3', title: 'Özdemir Erdoğan - Aşk', year: 1970, formatType: 'LP' },
      { id: 'a4', title: 'Ümit Aksu - Dönüş', year: 1980, formatType: 'LP' },
    ]

    const { container } = render(
      <ListView
        items={items}
        sortBy="artist"
        copy={recordsCatalog.copy}
        onOpen={vi.fn()}
      />
    )

    const headers = container.querySelectorAll('.list-group-header')
    const headerLabels = Array.from(headers).map((h) => h.textContent)
    expect(headerLabels).toEqual(['É', 'Á', 'Ö', 'Ü'])
  })

  it('renders jump rail buttons for accented letters', () => {
    render(
      <ListView
        items={ACCENTED_ITEMS}
        sortBy="artist"
        copy={recordsCatalog.copy}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Jump to É' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to Á' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to Ö' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to Ü' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to Ç' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to M' })).toBeInTheDocument()
  })
})
