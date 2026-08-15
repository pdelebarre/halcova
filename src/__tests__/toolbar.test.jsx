import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Toolbar from '../components/Toolbar'
import { recordsCatalog } from '../catalog'

function renderToolbar(overrides = {}) {
  const props = {
    query: '',
    setQuery: vi.fn(),
    placeholder: recordsCatalog.searchPlaceholder,
    formats: recordsCatalog.formats,
    activeFormats: [],
    toggleFormat: vi.fn(),
    genres: ['Jazz', 'Rock'],
    activeGenres: [],
    toggleGenre: vi.fn(),
    genreLabel: recordsCatalog.genreLabel,
    artists: ['Miles Davis', 'Nina Simone'],
    activeArtist: '',
    setActiveArtist: vi.fn(),
    artistLabel: recordsCatalog.artistLabel,
    artistPlaceholder: recordsCatalog.artistPlaceholder,
    sortBy: 'added',
    setSortBy: vi.fn(),
    sortOptions: recordsCatalog.sortOptions,
    count: 0,
    onClearFilters: vi.fn(),
    onResetFilters: vi.fn(),
    view: 'grid',
    setView: vi.fn(),
    copy: recordsCatalog.copy,
    ...overrides,
  }
  return render(<Toolbar {...props} />)
}

describe('Toolbar (single-row redesign)', () => {
  it('updates the search query as you type', () => {
    const setQuery = vi.fn()
    renderToolbar({ setQuery })

    fireEvent.change(screen.getByRole('textbox', { name: 'Search collection' }), { target: { value: 'Miles' } })
    expect(setQuery).toHaveBeenCalledWith('Miles')
  })

  it('shows a ✕ clear that empties the query', () => {
    const setQuery = vi.fn()
    renderToolbar({ query: 'Miles', setQuery })

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(setQuery).toHaveBeenCalledWith('')
  })

  it('shows the result count in the search pill', () => {
    renderToolbar({ count: 12 })
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('opens the filter sheet from the Filter button', () => {
    renderToolbar({})

    const filterBtn = screen.getByRole('button', { name: 'Filter' })
    expect(filterBtn).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(filterBtn)
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })

  it('labels the Filter button with the active filter count', () => {
    renderToolbar({ activeFormats: ['LP'], activeGenres: ['Jazz'] })

    expect(screen.getByRole('button', { name: '2 active' })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('opens the sort menu and applies a selection', () => {
    const setSortBy = vi.fn()
    renderToolbar({ setSortBy })

    fireEvent.click(screen.getByRole('button', { name: 'Sort by: Recently added' }))
    const menu = screen.getByRole('menu', { name: 'Sort by' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Year' }))
    expect(setSortBy).toHaveBeenCalledWith('year')
    expect(menu).not.toBeInTheDocument()
  })

  it('toggles between Grid and List views with aria-pressed', () => {
    const setView = vi.fn()
    renderToolbar({ setView })

    const grid = screen.getByRole('button', { name: 'Grid view' })
    const list = screen.getByRole('button', { name: 'List view' })
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(list).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(list)
    expect(setView).toHaveBeenCalledWith('list')
  })

  it('counts the on-loan filter toward the active filter badge', () => {
    renderToolbar({ activeLending: true })

    expect(screen.getByRole('button', { name: '1 active' })).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders the On loan switch inside the filter sheet when lending is enabled', () => {
    const onToggleLending = vi.fn()
    renderToolbar({ lendingEnabled: true, activeLending: false, onToggleLending })

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const sw = screen.getByRole('switch', { name: /On loan/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(onToggleLending).toHaveBeenCalledTimes(1)
  })

  it('shows the Loans button without a count badge when lending is enabled', () => {
    const { container } = renderToolbar({ lendingEnabled: true })

    expect(screen.getByRole('button', { name: 'Loans' })).toBeInTheDocument()
    expect(container.querySelector('.loans-badge')).not.toBeInTheDocument()
  })

  it('announces the overdue count in the Loans button aria-label (P1-3)', () => {
    renderToolbar({ lendingEnabled: true, overdueCount: 3 })

    // The visual badge is a plain number span (not announced), so the count is
    // composed into the aria-label for screen readers.
    expect(screen.getByRole('button', { name: 'Loans — 3 overdue' })).toBeInTheDocument()
    // The visual badge still renders for sighted users.
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('hides the Loans button when lending is disabled', () => {
    renderToolbar({ lendingEnabled: false })

    expect(screen.queryByRole('button', { name: 'Loans' })).not.toBeInTheDocument()
    expect(screen.queryByText('Loans')).not.toBeInTheDocument()
  })

  it('opens the loans dashboard from the Loans button', () => {
    const onOpenLoans = vi.fn()
    renderToolbar({ lendingEnabled: true, onOpenLoans })

    fireEvent.click(screen.getByRole('button', { name: 'Loans' }))
    expect(onOpenLoans).toHaveBeenCalledTimes(1)
  })
})
