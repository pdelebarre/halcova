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

describe('grid on-loan icon (A5.6 #117)', () => {
  it('renders a clickable loan icon (role=button) on a loaned item', () => {
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={vi.fn()} lendingEnabled copy={copy} />,
    )
    const icon = container.querySelector('.loan-icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('role', 'button')
    expect(icon).toHaveAttribute('tabindex', '0')
    expect(icon).toHaveAccessibleName('On loan to Alice — manage')
    expect(icon).not.toHaveClass('overdue')
    // The old text badge is gone.
    expect(container.querySelector('.lending-badge')).toBeNull()
  })

  it('deep-links to the lend card when the icon is activated', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={onOpen} lendingEnabled copy={copy} />,
    )
    fireEvent.click(container.querySelector('.loan-icon'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { focus: 'lending' })
  })

  it('activates the icon on Enter and Space (keyboard)', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={onOpen} lendingEnabled copy={copy} />,
    )
    const icon = container.querySelector('.loan-icon')

    fireEvent.keyDown(icon, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { focus: 'lending' })

    onOpen.mockClear()
    fireEvent.keyDown(icon, { key: ' ' })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('still opens the full detail (no focus hint) when the card body is tapped', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={onOpen} lendingEnabled copy={copy} />,
    )
    fireEvent.click(container.querySelector('.album-card'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))
  })

  it('still shows on-loan when the due date is in the future', () => {
    const { container } = render(
      <AlbumGrid
        items={[onLoan({ dueOn: new Date(Date.now() + 30 * DAY).toISOString() })]}
        onOpen={vi.fn()}
        lendingEnabled
        copy={copy}
      />,
    )
    const icon = container.querySelector('.loan-icon')
    expect(icon).toHaveAccessibleName('On loan to Alice — manage')
    expect(icon).not.toHaveClass('overdue')
  })

  it('shows the overdue affordance (class + aria-label) when the due date is in the past', () => {
    const { container } = render(
      <AlbumGrid
        items={[onLoan({ dueOn: new Date(Date.now() - 30 * DAY).toISOString() })]}
        onOpen={vi.fn()}
        lendingEnabled
        copy={copy}
      />,
    )
    const icon = container.querySelector('.loan-icon')
    expect(icon).toHaveClass('overdue')
    expect(icon).toHaveAccessibleName('Overdue — on loan to Alice — manage')
    // P1-1: the overdue affordance includes the alert dot (the filled-pill
    // styling lives in CSS — this class gates it, so overdue differs by
    // fill/area as well as hue, not hue alone).
    expect(container.querySelector('.loan-icon-dot')).toBeInTheDocument()
  })

  it('renders no icon when lending is disabled', () => {
    const { container } = render(
      <AlbumGrid items={[onLoan()]} onOpen={vi.fn()} lendingEnabled={false} copy={copy} />,
    )
    expect(container.querySelector('.loan-icon')).toBeNull()
  })

  it('shows the same icon on book cards', () => {
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
    const icon = container.querySelector('.loan-icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAccessibleName('On loan to Alice — manage')
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

describe('loan icon deep-link to the lend card (A5.6 #117)', () => {
  beforeEach(() => {
    api.listItems.mockResolvedValue([LOANED, NOT_LOANED])
  })

  it('opens the detail sheet focused on the LendingControls section from the icon', async () => {
    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />,
    )
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    fireEvent.click(container.querySelector('.loan-icon'))

    // The detail sheet opens with the lending section rendered…
    await waitFor(() => expect(container.querySelector('.lending')).toBeInTheDocument())
    // …and the deep-link moved focus into the sheet (not the close button).
    await waitFor(() => expect(container.querySelector('.lending')).toHaveFocus())
  })

  it('opens a normal detail (no lending deep-link) when the card body is tapped', async () => {
    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />,
    )
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    fireEvent.click(container.querySelectorAll('.album-card')[0])

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toBeInTheDocument()
    // Normal open focuses the sheet's close button (existing pattern).
    await waitFor(() => expect(sheet.querySelector('.sheet-close')).toHaveFocus())
  })

  it('self-corrects the deep-link scroll once async content settles (P2-4)', async () => {
    const scrollIntoView = vi.fn()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const { container } = render(
        <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />,
      )
      await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

      fireEvent.click(container.querySelector('.loan-icon'))

      await waitFor(() => expect(container.querySelector('.lending')).toBeInTheDocument())
      // The browser-native self-correction scrolls the lending section into
      // view (block: start) — from the RAF and again when async content
      // (tracklist / reviews) settles above LendingControls.
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' })))
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  })

  it('returns focus to the originating loan icon when the deep-linked sheet closes (P2-5)', async () => {
    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} lendingEnabled />,
    )
    await waitFor(() => expect(container.querySelectorAll('.album-card')).toHaveLength(2))

    const icon = container.querySelector('.loan-icon')
    // A real click on a tabIndex=0 element focuses it (fireEvent doesn't) —
    // that focused element is what CollectionView restores focus to on close.
    icon.focus()
    fireEvent.click(icon)

    await waitFor(() => expect(container.querySelector('.lending')).toHaveFocus())

    // Close the sheet (✕) — focus returns to the loan icon, not <body>.
    fireEvent.click(container.querySelector('.sheet-close'))
    await waitFor(() => expect(icon).toHaveFocus())
  })
})

// A5.4 empty-collection flow: an empty collection + lending enabled must keep
// the Loans button reachable (the global dashboard) via CollectionView's
// minimal toolbar — with the overdue badge/aria-label still wired up.
describe('empty collection + lending (W7 / A5.4)', () => {
  beforeEach(() => {
    api.listItems.mockResolvedValue([])
  })

  it('keeps the Loans button (with its overdue badge) reachable from an empty collection', async () => {
    const { container } = render(
      <CollectionView
        catalog={recordsCatalog}
        onRequestSettings={() => {}}
        lendingEnabled
        overdueCount={2}
      />,
    )

    // The empty state renders…
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try a sample' })).toBeInTheDocument())
    // …and the minimal toolbar still exposes the Loans button + overdue badge.
    expect(screen.getByRole('button', { name: 'Loans — 2 overdue' })).toBeInTheDocument()
    expect(container.querySelector('.loans-overdue-badge')).toHaveTextContent('2')
  })

  it('renders no Loans button on an empty collection when lending is disabled', async () => {
    render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Try a sample' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Loans' })).not.toBeInTheDocument()
  })
})
