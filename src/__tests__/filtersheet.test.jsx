import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import FilterSheet from '../components/FilterSheet'
import { recordsCatalog } from '../catalog'

const copy = recordsCatalog.copy

function renderSheet(overrides = {}) {
  const props = {
    copy,
    formats: recordsCatalog.formats,
    activeFormats: [],
    toggleFormat: vi.fn(),
    genres: ['Jazz', 'Rock', 'Funk'],
    activeGenres: [],
    toggleGenre: vi.fn(),
    genreLabel: recordsCatalog.genreLabel,
    artists: ['Miles Davis', 'Nina Simone', 'John Coltrane'],
    activeArtist: '',
    setActiveArtist: vi.fn(),
    artistLabel: recordsCatalog.artistLabel,
    artistPlaceholder: recordsCatalog.artistPlaceholder,
    onClear: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  return render(<FilterSheet {...props} />)
}

describe('FilterSheet', () => {
  it('is a modal dialog titled "Filters" that moves focus to Close on open', () => {
    renderSheet()
    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('toggles format chips with aria-pressed and applies them immediately', () => {
    const toggleFormat = vi.fn()
    renderSheet({ activeFormats: ['LP'], toggleFormat })

    const lp = screen.getByRole('button', { name: 'LP' })
    const cd = screen.getByRole('button', { name: 'CD' })
    expect(lp).toHaveAttribute('aria-pressed', 'true')
    expect(cd).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(cd)
    expect(toggleFormat).toHaveBeenCalledWith('CD')
  })

  it('toggles genre chips and applies them immediately', () => {
    const toggleGenre = vi.fn()
    renderSheet({ activeGenres: ['Jazz'], toggleGenre })

    expect(screen.getByRole('button', { name: 'Jazz' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Rock' }))
    expect(toggleGenre).toHaveBeenCalledWith('Rock')
  })

  it('only shows Reset when a filter is active, and Reset clears filters', () => {
    const onClear = vi.fn()
    const { unmount } = renderSheet({ onClear })
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    unmount()

    renderSheet({ activeGenres: ['Jazz'], onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('closes via Done', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('filters the artist combobox as you type and selects an artist', () => {
    const setActiveArtist = vi.fn()
    renderSheet({ setActiveArtist })

    const combo = screen.getByRole('combobox', { name: 'Filter by artist' })
    expect(combo).toHaveAttribute('aria-expanded', 'false')

    fireEvent.change(combo, { target: { value: 'ni' } })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('option', { name: 'Nina Simone' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Miles Davis' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'Nina Simone' }))
    expect(setActiveArtist).toHaveBeenCalledWith('Nina Simone')
  })

  it('shows a removable chip for the selected artist', () => {
    const setActiveArtist = vi.fn()
    renderSheet({ activeArtist: 'Miles Davis', setActiveArtist })

    expect(screen.getByText('Miles Davis')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear artist filter' }))
    expect(setActiveArtist).toHaveBeenCalledWith('')
  })

  it('shows the On loan switch only when lending is enabled', () => {
    const { unmount } = renderSheet()
    expect(screen.queryByRole('switch', { name: /On loan/ })).not.toBeInTheDocument()
    unmount()

    renderSheet({ lendingEnabled: true })
    expect(screen.getByRole('switch', { name: /On loan/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('reflects activeLending on the On loan switch and toggles it', () => {
    const onToggleLending = vi.fn()
    renderSheet({ lendingEnabled: true, activeLending: true, onToggleLending })

    const sw = screen.getByRole('switch', { name: /On loan/ })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(onToggleLending).toHaveBeenCalledTimes(1)
  })
})
