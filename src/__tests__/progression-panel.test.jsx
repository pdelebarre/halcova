import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import ProgressionPanel from '../components/ProgressionPanel'
import { recordsCatalog } from '../catalog'
import { setTrackingEnabled } from '../utils/track'

const EVENTS_KEY = 'runout.events'

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

// 10 records, notes on all, spread across 10 days → ONLY sleeve-sleuth unlocks
// (10 notes), so the toast/share assertions are unambiguous.
function sleeveSleuthCrate() {
  return Array.from({ length: 10 }, (_, i) => record(`n${i}`, {
    notes: 'pressing details',
    dateAdded: `2026-03-${String(i + 1).padStart(2, '0')}T12:00:00`,
  }))
}

function renderPanel(items, catalog = recordsCatalog) {
  return render(
    <LocaleProvider>
      <ProgressionPanel items={items} catalog={catalog} />
    </LocaleProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
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

describe('ProgressionPanel (release 1.2)', () => {
  it('shows the add-first empty state for an empty collection', () => {
    renderPanel([])
    expect(screen.getByText('No items yet')).toBeInTheDocument()
  })

  it('renders the level card with title, XP bar, and total XP', () => {
    renderPanel(sleeveSleuthCrate())
    // 10 items (100 XP) + 10 notes (50 XP) = 150 XP → Level 2, Crate Nerd.
    expect(screen.getByText('Crate Nerd')).toBeInTheDocument()
    expect(screen.getByText('Level 2')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText('150 XP')).toBeInTheDocument()
  })

  it('renders the badge grid with locked and unlocked badges', () => {
    renderPanel(sleeveSleuthCrate())
    expect(screen.getByText('Sleeve Sleuth')).toBeInTheDocument()
    // The unlocked badge's joke line appears (on the tile, and in the toast).
    expect(screen.getAllByText('Ten notes. The collection finally has opinions.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0)
    // Deferred badges are marked "coming soon", not "locked" (no impossible badges).
    expect(screen.getAllByText('Coming in a later phase').length).toBeGreaterThan(0)
  })

  it('emits gamif_level_up and gamif_badge_unlocked once on first view', () => {
    setTrackingEnabled(true)
    renderPanel(sleeveSleuthCrate())

    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_level_up' && e.props.level === 2 && e.props.kind === 'records')).toBe(true)
    expect(events.some((e) => e.event === 'gamif_badge_unlocked' && e.props.badgeId === 'sleeve-sleuth')).toBe(true)
  })

  it('does not re-toast or re-emit unlocks on subsequent views', () => {
    setTrackingEnabled(true)
    renderPanel(sleeveSleuthCrate())
    const first = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')

    renderPanel(sleeveSleuthCrate())
    const second = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(second.filter((e) => e.event === 'gamif_badge_unlocked')).toHaveLength(
      first.filter((e) => e.event === 'gamif_badge_unlocked').length,
    )
    expect(second.filter((e) => e.event === 'gamif_level_up')).toHaveLength(
      first.filter((e) => e.event === 'gamif_level_up').length,
    )
  })

  it('shows the badge unlock toast with the badge name and joke', () => {
    renderPanel(sleeveSleuthCrate())
    // The toast kicker is unique to the toast; the joke appears on the toast
    // and the unlocked tile.
    expect(screen.getByText('Badge unlocked: Sleeve Sleuth')).toBeInTheDocument()
    expect(screen.getAllByText('Ten notes. The collection finally has opinions.').length).toBeGreaterThanOrEqual(2)
  })

  it('exports a leak-safe SVG badge card (headline + badge + aggregate stats only)', async () => {
    const getBlob = stubExport()
    const items = sleeveSleuthCrate()
    // Deliberately plant secrets on items — they must never reach the card.
    items[0].barcode = '0123456789017'
    items[0].isbn = '9783161484100'
    items[0].notes = 'RU-1234-5678-9012 admin-key hunter2'
    items[0].title = 'SECRET-ALBUM-TITLE - SECRET-SONG'

    renderPanel(items)
    // Click the unlocked tile's share button (the toast has one too).
    const tile = screen.getByText('Sleeve Sleuth').closest('li')
    fireEvent.click(within(tile).getByRole('button', { name: 'Share card' }))

    const blob = getBlob()
    expect(blob).toBeTruthy()
    const svg = await blob.text()

    // Allowed content present.
    expect(svg).toContain('Halcova')
    expect(svg).toContain('Unlocked: Sleeve Sleuth')
    expect(svg).toContain('Sleeve Sleuth')
    expect(svg).toContain('#WhatsInYourHalcova')

    // Forbidden content absent: barcodes, ISBNs, access codes, admin keys,
    // notes, and item titles never leak into the exported artifact.
    expect(svg).not.toContain('0123456789017')
    expect(svg).not.toContain('9783161484100')
    expect(svg).not.toContain('RU-1234-5678-9012')
    expect(svg).not.toContain('hunter2')
    expect(svg).not.toContain('SECRET-ALBUM-TITLE')
  })

  it('interpolates {artist} on the exported badge share card — no raw token', async () => {
    const getBlob = stubExport()
    // 4 records by 4 different artists → the one-timer badge unlocks, and its
    // line carries a {artist} token ("One {artist}. Bold. Mysterious.").
    const items = Array.from({ length: 4 }, (_, i) => record(`ot${i}`, {
      title: `Artist${i} - Album ${i}`,
      dateAdded: `2026-03-${String(i + 1).padStart(2, '0')}T12:00:00`,
    }))
    renderPanel(items)

    const tile = screen.getByText('One-Timer').closest('li')
    fireEvent.click(within(tile).getByRole('button', { name: 'Share card' }))

    const blob = getBlob()
    expect(blob).toBeTruthy()
    const svg = await blob.text()
    // The single most-collected artist name is interpolated in place of the
    // token (4 distinct artists → mode() keeps the first: "Artist0").
    expect(svg).not.toContain('{artist}')
    expect(svg).toContain('One Artist0. Bold. Mysterious.')
  })

  it('emits gamif_share_exported with the badge id when sharing', () => {
    stubExport()
    setTrackingEnabled(true)
    renderPanel(sleeveSleuthCrate())

    const tile = screen.getByText('Sleeve Sleuth').closest('li')
    fireEvent.click(within(tile).getByRole('button', { name: 'Share card' }))
    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_share_exported' && e.props.cardType === 'badge' && e.props.badgeId === 'sleeve-sleuth')).toBe(true)
  })

  it('fires the level-up toast once on a level unlock, then never re-toasts', () => {
    // 10 items, no notes, 2 artists / 2 genres / 2 decades / ≤2 per day →
    // exactly Level 2 (100 XP) and NO badge unlocks, so only the level toast.
    const items = Array.from({ length: 10 }, (_, i) => record(`l${i}`, {
      title: `${i % 2 === 0 ? 'Artist A' : 'Artist B'} - Album ${i}`,
      genre: [i % 2 === 0 ? 'Rock' : 'Jazz'],
      year: 1980 + (i % 2) * 10,
      dateAdded: `2026-03-${String((i % 5) + 1).padStart(2, '0')}T12:00:00`,
    }))
    const first = renderPanel(items)

    // The level toast carries the level title + the kind's tail copy.
    expect(screen.getByText('Level up: Crate Nerd')).toBeInTheDocument()
    expect(screen.getByText('Your crate salutes you.')).toBeInTheDocument()

    first.unmount()

    // Unlock-once: re-mounting with the same state never re-toasts the level-up.
    renderPanel(items)
    expect(screen.queryByText('Level up: Crate Nerd')).not.toBeInTheDocument()
  })

  it('re-rendering yields identical XP/level/badges — no double-counting', () => {
    const items = sleeveSleuthCrate()
    const { rerender } = render(
      <LocaleProvider>
        <ProgressionPanel items={items} catalog={recordsCatalog} />
      </LocaleProvider>
    )

    expect(screen.getByText('150 XP')).toBeInTheDocument()
    expect(screen.getByText('Crate Nerd')).toBeInTheDocument()

    rerender(
      <LocaleProvider>
        <ProgressionPanel items={items} catalog={recordsCatalog} />
      </LocaleProvider>
    )

    // XP is a pure derivation of items + ledger — a re-render never re-credits.
    expect(screen.getByText('150 XP')).toBeInTheDocument()
    expect(screen.getByText('Crate Nerd')).toBeInTheDocument()
  })

  it('pauses the toast auto-dismiss on hover/focus so the Share can\'t be missed', () => {
    vi.useFakeTimers()
    try {
      renderPanel(sleeveSleuthCrate())
      expect(screen.getByRole('status')).toBeInTheDocument()

      // Hover pauses the 6s auto-dismiss — the toast (and its Share) stays up.
      fireEvent.mouseEnter(screen.getByRole('status'))
      act(() => { vi.advanceTimersByTime(6000) })
      expect(screen.getByRole('status')).toBeInTheDocument()

      // Leaving resumes the timer → it dismisses after the 6s.
      fireEvent.mouseLeave(screen.getByRole('status'))
      act(() => { vi.advanceTimersByTime(6000) })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
