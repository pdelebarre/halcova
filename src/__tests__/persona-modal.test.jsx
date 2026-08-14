import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import PersonaModal from '../components/PersonaModal'
import { recordsCatalog } from '../catalog'
import { setTrackingEnabled } from '../utils/track'

const EVENTS_KEY = 'runout.events'

function record(id, overrides = {}) {
  return {
    id,
    title: `Artist ${id} - Album ${id}`,
    year: 1980,
    genre: ['Rock'],
    label: 'PressCo',
    formatType: 'LP',
    country: 'US',
    dateAdded: '2026-03-14T12:00:00Z',
    notes: '',
    barcode: `1234567890${id}`,
    ...overrides,
  }
}

// 8 records, 8 distinct genres + artists, same year — resolves Genre Tourist.
function wideGenreCrate() {
  const genres = ['Jazz', 'Rock', 'Soul', 'Funk', 'Reggae', 'Blues', 'Folk', 'Electronic']
  return genres.map((g, i) => record(`r${i}`, { genre: [g], year: 1980, barcode: `0123456789${i}` }))
}

function renderModal(items, catalog = recordsCatalog, onClose = vi.fn()) {
  return render(
    <LocaleProvider>
      <PersonaModal items={items} catalog={catalog} onClose={onClose} />
    </LocaleProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub the browser download path and return a getter for the captured blob. */
function stubExport() {
  let captured = null
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob) => { captured = blob; return 'blob:fake' }),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return () => captured
}

describe('PersonaModal (release 1.1 "Play")', () => {
  it('renders a dialog with the archetype card and stats for a real collection', () => {
    renderModal(wideGenreCrate())

    expect(screen.getByRole('dialog', { name: 'Your persona' })).toBeInTheDocument()
    // The archetype name lives on the SVG share card.
    expect(screen.getByRole('img', { name: 'The Genre Tourist' })).toBeInTheDocument()
    // Stat labels appear both on the card and in the accessible list below.
    expect(screen.getAllByText('Genres').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Labels').length).toBeGreaterThanOrEqual(2)
    // The export action is present.
    expect(screen.getByRole('button', { name: 'Export card' })).toBeInTheDocument()
  })

  it('shows the add-first empty state instead of a persona for an empty collection', () => {
    renderModal([])

    expect(screen.getByText('Add a record first')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export card' })).not.toBeInTheDocument()
  })

  it('calls onClose from the close button and supports Esc', () => {
    const onClose = vi.fn()
    renderModal(wideGenreCrate(), recordsCatalog, onClose)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('exports a leak-safe SVG card (headline + archetype + stats + tagline + hashtag only)', async () => {
    const getBlob = stubExport()
    const items = wideGenreCrate()
    // Deliberately plant secrets on items — they must never reach the card.
    items[0].barcode = '0123456789017'
    items[0].isbn = '9783161484100'
    items[0].notes = 'RU-1234-5678-9012 admin-key hunter2'
    items[0].title = 'SECRET-ALBUM-TITLE - SECRET-SONG'

    renderModal(items)
    fireEvent.click(screen.getByRole('button', { name: 'Export card' }))

    const blob = getBlob()
    expect(blob).toBeTruthy()
    const svg = await blob.text()

    // Allowed content present.
    expect(svg).toContain('Halcova')
    expect(svg).toContain('#WhatsInYourHalcova')
    expect(svg).toContain('The Genre Tourist')
    expect(svg).toContain('Catalog once. Play forever.')

    // Forbidden content absent: barcodes, ISBNs, access codes, admin keys,
    // notes, and item titles never leak into the exported artifact.
    expect(svg).not.toContain('0123456789017')
    expect(svg).not.toContain('9783161484100')
    expect(svg).not.toContain('RU-1234-5678-9012')
    expect(svg).not.toContain('hunter2')
    expect(svg).not.toContain('SECRET-ALBUM-TITLE')
  })

  it('shows a transient "Card exported" status after exporting', async () => {
    stubExport()
    renderModal(wideGenreCrate())

    fireEvent.click(screen.getByRole('button', { name: 'Export card' }))
    expect(screen.getByRole('status')).toHaveTextContent('Card exported ✓')
  })

  it('emits gamif_persona_generated on view when tracking is enabled', () => {
    setTrackingEnabled(true)
    renderModal(wideGenreCrate())

    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_persona_generated'
      && e.props.kind === 'records'
      && e.props.archetype === 'genre-tourist'
      && e.props.shared === false)).toBe(true)
  })

  it('emits gamif_share_exported when the card is exported and tracking is enabled', () => {
    stubExport()
    setTrackingEnabled(true)
    renderModal(wideGenreCrate())

    fireEvent.click(screen.getByRole('button', { name: 'Export card' }))
    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_share_exported' && e.props.kind === 'records')).toBe(true)
  })
})
