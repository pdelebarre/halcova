import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import PlayPanel from '../components/PlayPanel'
import { recordsCatalog } from '../catalog'

function record(id, overrides = {}) {
  return {
    id,
    title: `Artist ${id} - Album ${id}`,
    year: 1980,
    genre: ['Rock'],
    style: [],
    formatType: 'LP',
    country: 'US',
    dateAdded: '2026-03-14T12:00:00',
    notes: '',
    barcode: `1234567890${id}`,
    ...overrides,
  }
}

// 8 records, 8 distinct genres + artists, spread years so the Stories tab has
// something to read and the Progress tab has real XP.
function playCrate() {
  const genres = ['Jazz', 'Rock', 'Soul', 'Funk', 'Reggae', 'Blues', 'Folk', 'Electronic']
  return genres.map((g, i) => record(`r${i}`, {
    genre: [g],
    year: 1960 + i * 5,
    dateAdded: `2026-03-${String(i + 1).padStart(2, '0')}T12:00:00`,
    notes: i % 2 === 0 ? 'a note' : '',
  }))
}

function renderPanel(items, catalog = recordsCatalog, onClose = vi.fn()) {
  return render(
    <LocaleProvider>
      <PlayPanel items={items} catalog={catalog} onClose={onClose} />
    </LocaleProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

describe('PlayPanel (Phase 1 § Play hub)', () => {
  it('renders the Play dialog with Persona / Progress / Stories tabs', () => {
    renderPanel(playCrate())

    expect(screen.getByRole('dialog', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Persona' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Progress' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stories' })).toBeInTheDocument()
  })

  it('defaults to the Persona tab (release 1.1 content)', () => {
    renderPanel(playCrate())
    expect(screen.getByRole('tab', { name: 'Persona' })).toHaveAttribute('aria-selected', 'true')
    // The persona share card is an SVG <img> with the archetype name.
    expect(screen.getByRole('img', { name: 'The Genre Tourist' })).toBeInTheDocument()
  })

  it('switches to the Progress tab (release 1.2)', () => {
    renderPanel(playCrate())
    fireEvent.click(screen.getByRole('tab', { name: 'Progress' }))
    expect(screen.getByRole('tab', { name: 'Progress' })).toHaveAttribute('aria-selected', 'true')
    // Level card + XP bar + badge grid.
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText('Badges')).toBeInTheDocument()
  })

  it('switches to the Stories tab (release 1.4)', () => {
    renderPanel(playCrate())
    fireEvent.click(screen.getByRole('tab', { name: 'Stories' }))
    expect(screen.getByRole('tab', { name: 'Stories' })).toHaveAttribute('aria-selected', 'true')
    // Story cards are <article>s; playCrate has enough to emit the facts tier.
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
  })

  it('switches to the Quiz tab (release 1.3) and shows the quiz intro', () => {
    renderPanel(playCrate())
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }))
    expect(screen.getByRole('tab', { name: 'Quiz' })).toHaveAttribute('aria-selected', 'true')
    // 8 items is enough for the quiz (not locked) — the intro shows.
    expect(screen.getByText('The Crate Quiz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the quiz' })).toBeInTheDocument()
  })

  it('shows the add-first empty state for an empty collection', () => {
    renderPanel([])
    expect(screen.getByText('Add a record first')).toBeInTheDocument()
  })

  it('calls onClose from the close button and supports Esc', () => {
    const onClose = vi.fn()
    renderPanel(playCrate(), recordsCatalog, onClose)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
