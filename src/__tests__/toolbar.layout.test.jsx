import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    expect(screen.getByRole('button', { name: 'Filter, 3 active' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
