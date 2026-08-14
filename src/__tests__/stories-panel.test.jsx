import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import StoriesPanel from '../components/StoriesPanel'
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
    ...overrides,
  }
}

// 6 records spanning 1960–2000 with a clear decade + country mix — enough for
// the facts tier AND an era-lesson (count >= 4).
function storyCrate() {
  return [
    record('r1', { title: 'Nina Simone - Pastel Blues', year: 1965, genre: ['Jazz', 'Soul'], country: 'US' }),
    record('r2', { title: 'Miles Davis - Bitches Brew', year: 1970, genre: ['Jazz'], country: 'US' }),
    record('r3', { title: 'Talking Heads - Remain in Light', year: 1980, genre: ['Rock', 'New Wave'], country: 'US' }),
    record('r4', { title: 'The Clash - Sandinista!', year: 1980, genre: ['Rock', 'Punk'], country: 'UK' }),
    record('r5', { title: 'Kate Bush - Hounds of Love', year: 1985, genre: ['Pop', 'Art Rock'], country: 'UK' }),
    record('r6', { title: 'Radiohead - Kid A', year: 2000, genre: ['Electronic', 'Rock'], country: 'UK' }),
  ]
}

function renderPanel(items, catalog = recordsCatalog) {
  return render(
    <LocaleProvider>
      <StoriesPanel items={items} catalog={catalog} />
    </LocaleProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

describe('StoriesPanel (release 1.4)', () => {
  it('shows the add-first empty state for an empty collection', () => {
    renderPanel([])
    expect(screen.getByText('No stories yet')).toBeInTheDocument()
  })

  it('renders story cards derived from the collection', () => {
    renderPanel(storyCrate())
    const cards = screen.getAllByRole('article')
    expect(cards.length).toBeGreaterThan(0)
    // The facts tier + era lesson are deterministic and data-grounded.
    expect(screen.getByText('The 1980s are your era')).toBeInTheDocument()
    expect(screen.getByText(/spans 35 years/)).toBeInTheDocument()
  })

  it('emits gamif_story_opened for the visible story when tracking is enabled', () => {
    setTrackingEnabled(true)
    renderPanel(storyCrate())
    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_story_opened' && e.props.kind === 'records')).toBe(true)
  })

  it('emits gamif_story_opened again when advancing to the next card', () => {
    setTrackingEnabled(true)
    renderPanel(storyCrate())

    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    const opened = events.filter((e) => e.event === 'gamif_story_opened')
    expect(opened.length).toBe(2)
    // Two distinct stories were opened.
    expect(new Set(opened.map((e) => e.props.storyId)).size).toBe(2)
  })

  it('offers the quest affordance on actionable stories, tracked and honest', () => {
    setTrackingEnabled(true)
    renderPanel(storyCrate())

    const questButtons = screen.getAllByRole('button', { name: 'Turn into a quest' })
    expect(questButtons.length).toBeGreaterThan(0)

    fireEvent.click(questButtons[0])
    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_quest_started' && e.props.storyId)).toBe(true)

    // A clearly-marked "Phase 2" note appears (quests are not built yet).
    expect(screen.getByText('Quest-building arrives in Phase 2')).toBeInTheDocument()
  })

  it('navigates via the pagination dots (accessible "Go to story N" buttons)', () => {
    renderPanel(storyCrate())
    const dots = screen.getAllByRole('button', { name: /Go to story/ })
    expect(dots.length).toBeGreaterThan(1)
    fireEvent.click(dots[1])
    expect(dots[1]).toHaveAttribute('aria-current', 'true')
  })

  it('steps back with the Previous story button and disables at the first card', () => {
    renderPanel(storyCrate())
    const dots = screen.getAllByRole('button', { name: /Go to story/ })
    const prev = screen.getByRole('button', { name: 'Previous story' })
    const next = screen.getByRole('button', { name: 'Next story' })

    // First card: Previous is disabled.
    expect(prev).toBeDisabled()
    expect(dots[0]).toHaveAttribute('aria-current', 'true')

    // Advance twice, then step back one at a time.
    fireEvent.click(next)
    fireEvent.click(next)
    expect(dots[2]).toHaveAttribute('aria-current', 'true')

    fireEvent.click(prev)
    expect(dots[1]).toHaveAttribute('aria-current', 'true')

    fireEvent.click(prev)
    expect(dots[0]).toHaveAttribute('aria-current', 'true')
    expect(prev).toBeDisabled()
  })

  it('shows only the facts tier for a small collection (<4 items) — no era lesson', () => {
    // 3 items, all 1980s → facts (span + decade bias) but no recommendations.
    const tiny = [
      record('t1', { title: 'Nina Simone - Pastel Blues', year: 1980, genre: ['Jazz'], country: 'US' }),
      record('t2', { title: 'Miles Davis - Kind of Blue', year: 1983, genre: ['Jazz'], country: 'US' }),
      record('t3', { title: 'The Clash - Sandinista!', year: 1985, genre: ['Rock'], country: 'UK' }),
    ]
    renderPanel(tiny)

    // Facts tier present.
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
    expect(screen.getByText('The 1980s are your era')).toBeInTheDocument()

    // Recommendations tier suppressed below 4 items (era-lesson + one-timer).
    expect(screen.queryByText(/Era lesson:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/teaser/i)).not.toBeInTheDocument()
  })
})
