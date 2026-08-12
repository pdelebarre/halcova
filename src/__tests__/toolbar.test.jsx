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
})
