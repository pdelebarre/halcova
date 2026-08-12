import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AlbumGrid from '../components/AlbumGrid'
import BookGrid from '../components/BookGrid'
import CollectionView from '../CollectionView'
import { booksCatalog, recordsCatalog } from '../catalog'

// CollectionView integration tests drive the real useCollection hook against
// a mocked API (same pattern as fab.test.jsx).
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

const copy = recordsCatalog.copy
const DAY = 24 * 60 * 60 * 1000

function onLoan(overrides = {}) {
  return {
    id: 'r1',
    title: 'Miles Davis - Kind of Blue',
    formatType: 'LP',
    genre: ['Jazz'],
    lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z', ...overrides },
  }
}

describe('grid lending badge (W7)', () => {
  it('shows an On loan badge on a loaned item with no due date', () => {
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={vi.fn()} lendingEnabled copy={copy} />,
    )
    const badge = container.querySelector('.lending-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('On loan')
    expect(badge).not.toHaveClass('overdue')
  })

  it('still shows On loan when the due date is in the future', () => {
    const { container } = render(
      <AlbumGrid
        items={[onLoan({ dueOn: new Date(Date.now() + 30 * DAY).toISOString() })]}
        onOpen={vi.fn()}
        lendingEnabled
        copy={copy}
      />,
    )
    const badge = container.querySelector('.lending-badge')
    expect(badge.textContent).toBe('On loan')
    expect(badge).not.toHaveClass('overdue')
  })

  it('shows an Overdue badge when the due date is in the past', () => {
    const { container } = render(
      <AlbumGrid
        items={[onLoan({ dueOn: new Date(Date.now() - 30 * DAY).toISOString() })]}
        onOpen={vi.fn()}
        lendingEnabled
        copy={copy}
      />,
    )
    const badge = container.querySelector('.lending-badge')
    expect(badge.textContent).toBe('Overdue')
    expect(badge).toHaveClass('overdue')
  })

  it('renders no badge when lending is disabled', () => {
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={vi.fn()} lendingEnabled={false} copy={copy} />,
    )
    expect(container.querySelector('.lending-badge')).toBeNull()
  })

  it('shows the same badge on book cards', () => {
    const { container } = render(
      <BookGrid
        items={[{
          id: 'b1',
          title: 'Ursula K. Le Guin - A Wizard of Earthsea',
          lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z' },
        }]}
        onOpen={vi.fn()}
        lendingEnabled
        copy={booksCatalog.copy}
      />,
    )
    const badge = container.querySelector('.lending-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('On loan')
  })

  it('does not crash on weird item shapes', () => {
    const { container } = render(
      <AlbumGrid
        items={[{}, { id: 'r2', title: 'Nina Simone - Little Girl Blue', formatType: 'LP', lending: {} }]}
        onOpen={vi.fn()}
        lendingEnabled
        copy={copy}
      />,
    )
    expect(container.querySelectorAll('.album-card')).toHaveLength(2)
  })
})

const LOANED = onLoan()
const NOT_LOANED = { id: 'r2', title: 'Nina Simone - Little Girl Blue', year: 1958, formatType: 'LP', genre: ['Jazz'] }

describe('filter sheet — On loan toggle (W7)', () => {
  beforeEach(() => {
    api.listItems.mockResolvedValue([LOANED, NOT_LOANED])
  })

  it('shows the On loan switch and filters the grid to on-loan items only', async () => {
    const { container } = render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const sw = screen.getByRole('switch', { name: /On loan/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(sw)
    expect(screen.getByRole('switch', { name: /On loan/ })).toHaveAttribute('aria-checked', 'true')
    // Toolbar counts the on-loan filter as an active filter.
    expect(screen.getByRole('button', { name: '1 active' })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
  })

  it('resets the on-loan filter from the filter sheet Reset button', async () => {
    const { container } = render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('switch', { name: /On loan/ }))
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('switch', { name: /On loan/ })).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
  })

  it('clears the on-loan filter from the no-results empty state', async () => {
    api.listItems.mockResolvedValue([NOT_LOANED])
    const { container } = render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('switch', { name: /On loan/ }))

    // With no loaned items the empty state's Clear filters restores everything.
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(1))
  })

  it('does not show the On loan switch when lending is disabled', async () => {
    const { container } = render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />)
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.queryByRole('switch', { name: /On loan/ })).not.toBeInTheDocument()
  })
})
