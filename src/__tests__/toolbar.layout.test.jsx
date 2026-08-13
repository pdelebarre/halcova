import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Toolbar from '../components/Toolbar'

function renderToolbar(overrides = {}) {
  const props = {
    query: '',
    setQuery: vi.fn(),
    placeholder: 'Search your collection…',
    formats: ['LP', 'CD'],
    activeFormats: [],
    toggleFormat: vi.fn(),
    genres: ['Jazz'],
    activeGenres: [],
    toggleGenre: vi.fn(),
    genreLabel: 'Genre',
    artists: ['Miles Davis'],
    activeArtist: '',
    setActiveArtist: vi.fn(),
    artistLabel: 'artist',
    artistPlaceholder: 'All artists',
    sortBy: 'added',
    setSortBy: vi.fn(),
    sortOptions: [
      { value: 'added', label: 'Recently added' },
      { value: 'artist', label: 'Artist A–Z' },
      { value: 'year', label: 'Year' },
    ],
    count: 0,
    onClearFilters: vi.fn(),
    onResetFilters: vi.fn(),
    view: 'grid',
    setView: vi.fn(),
    copy: {},
    ...overrides,
  }
  return render(<Toolbar {...props} />)
}

describe('Toolbar layout (redesign)', () => {
  it('keeps the toolbar to a single row: search, Filter, sort, view toggle', () => {
    const { container } = renderToolbar({ count: 4 })

    const toolbar = container.querySelector('.toolbar')
    expect(toolbar).toBeTruthy()
    expect(toolbar.querySelector('.toolbar-search')).toBeTruthy()
    expect(toolbar.querySelector('.filter-btn')).toBeTruthy()
    expect(toolbar.querySelector('.sort-btn')).toBeTruthy()
    expect(toolbar.querySelector('.view-toggle')).toBeTruthy()
  })

  it('keeps classification chips out of the toolbar (they moved to the filter sheet)', () => {
    renderToolbar()

    expect(screen.queryByRole('button', { name: 'LP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Jazz' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('badges the Filter pill with the number of active filters', () => {
    renderToolbar({ activeFormats: ['LP'], activeGenres: ['Jazz'], activeArtist: 'Miles Davis' })

    expect(screen.getByRole('button', { name: '3 active' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

describe('Toolbar search-mode takeover (architect spec)', () => {
  it('adds the search-active class when the search input is focused', () => {
    const { container } = renderToolbar()
    const toolbar = container.querySelector('.toolbar')
    const input = screen.getByRole('textbox', { name: 'Search collection' })

    expect(toolbar).not.toHaveClass('search-active')
    fireEvent.focus(input)
    expect(toolbar).toHaveClass('search-active')
  })

  it('adds the search-active class when a query is set (no focus needed)', () => {
    const { container } = renderToolbar({ query: 'Miles' })
    expect(container.querySelector('.toolbar')).toHaveClass('search-active')
  })

  it('always mounts the Done pill, tabbing and exposing it only while search is active', () => {
    const { container } = renderToolbar()
    const exit = container.querySelector('.search-exit')

    expect(exit).toBeTruthy()
    expect(exit).toHaveTextContent('Done')
    expect(exit).toHaveAttribute('tabindex', '-1')
    expect(exit).toHaveAttribute('aria-hidden', 'true')

    fireEvent.focus(screen.getByRole('textbox', { name: 'Search collection' }))
    expect(exit).toHaveAttribute('tabindex', '0')
    expect(exit).toHaveAttribute('aria-hidden', 'false')
  })

  it('removes the sibling controls from the tab order while search is active', () => {
    renderToolbar({ query: 'Miles' })

    const siblings = [
      screen.getByRole('button', { name: 'Browse' }),
      screen.getByRole('button', { name: 'Filter' }),
      screen.getByRole('button', { name: /Sort by:/ }),
      screen.getByRole('button', { name: 'Grid view' }),
      screen.getByRole('button', { name: 'List view' }),
    ]
    for (const btn of siblings) {
      expect(btn).toHaveAttribute('tabindex', '-1')
    }
  })

  it('removes the Loans button from the tab order while search is active', () => {
    renderToolbar({ query: 'Miles', lendingEnabled: true })
    expect(screen.getByRole('button', { name: 'Loans' })).toHaveAttribute('tabindex', '-1')
  })

  it('keeps the sibling controls in the tab order while search is inactive', () => {
    renderToolbar()

    expect(screen.getByRole('button', { name: 'Browse' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('tabindex', '0')
  })

  it('Escape blurs and deactivates an empty focused search', () => {
    const onSearchBlur = vi.fn()
    const { container } = renderToolbar({ onSearchBlur })
    const input = screen.getByRole('textbox', { name: 'Search collection' })
    const toolbar = container.querySelector('.toolbar')

    fireEvent.focus(input)
    expect(toolbar).toHaveClass('search-active')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSearchBlur).toHaveBeenCalled()
    expect(toolbar).not.toHaveClass('search-active')
  })

  it('Escape does not clear an active query on the first press', () => {
    const onSearchBlur = vi.fn()
    const { container } = renderToolbar({ query: 'Miles', onSearchBlur })
    const input = screen.getByRole('textbox', { name: 'Search collection' })
    const toolbar = container.querySelector('.toolbar')

    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSearchBlur).toHaveBeenCalled()
    expect(input).toHaveValue('Miles')
    // A non-empty query is still an active search, so the pill stays expanded.
    expect(toolbar).toHaveClass('search-active')
  })
})
