import { describe, expect, it } from 'vitest'
import { computeStories } from './stories'
import { recordsCatalog, booksCatalog } from '../catalog'

// --- fixtures -------------------------------------------------------------

function record(id, overrides = {}) {
  return {
    id,
    title: `Artist ${id} - Album ${id}`,
    year: 1980,
    genre: ['Rock'],
    style: ['Heavy'],
    formatType: 'LP',
    country: 'US',
    dateAdded: '2026-03-14T12:00:00',
    notes: '',
    ...overrides,
  }
}

function book(id, overrides = {}) {
  return {
    id,
    title: `Author ${id} - Title ${id}`,
    year: 2000,
    genre: [],
    label: '',
    pageCount: '',
    dateAdded: '2026-03-14T12:00:00',
    ...overrides,
  }
}

/** 6 records spanning 1960–2000 with a clear 1980s bias + shared genres. */
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

function seriesShelf() {
  return [
    book('s1', { title: 'Frank Herbert - Dune - Dune', genre: ['Sci-Fi'], year: 1965, pageCount: 412 }),
    book('s2', { title: 'Frank Herbert - Dune - Dune Messiah', genre: ['Sci-Fi'], year: 1969, pageCount: 331 }),
    book('s3', { title: 'Ursula K. Le Guin - Earthsea - A Wizard of Earthsea', genre: ['Fantasy'], year: 1968, pageCount: 304 }),
  ]
}

function pageHeavyShelf() {
  return Array.from({ length: 6 }, (_, i) => book(`p${i}`, { year: 1990, pageCount: 500 + i * 10 }))
}

const ids = (stories) => stories.map((s) => s.id)

// --- facts tier -----------------------------------------------------------

describe('computeStories — facts tier', () => {
  it('returns [] for an empty collection', () => {
    expect(computeStories([], recordsCatalog)).toEqual([])
    expect(computeStories(null, recordsCatalog)).toEqual([])
  })

  it('computes the year span from min/max year', () => {
    const stories = computeStories(storyCrate(), recordsCatalog)
    const span = stories.find((s) => s.id === 'year-span')
    expect(span).toBeTruthy()
    expect(span.body).toContain('spans 35 years')
    expect(span.body).toContain('from 1965 to 2000')
  })

  it('reports the decade bias with a computed share', () => {
    const stories = computeStories(storyCrate(), recordsCatalog)
    const bias = stories.find((s) => s.id === 'decade-bias')
    expect(bias).toBeTruthy()
    expect(bias.body).toContain('1980')
    expect(bias.title).toContain('1980')
  })

  it('shows the country mix for records', () => {
    const stories = computeStories(storyCrate(), recordsCatalog)
    const mix = stories.find((s) => s.id === 'country-mix')
    expect(mix).toBeTruthy()
    expect(mix.body).toContain('US')
    expect(mix.body).toContain('UK')
  })

  it('detects series for books from author + title prefix', () => {
    const stories = computeStories(seriesShelf(), booksCatalog)
    const series = stories.find((s) => s.id === 'series')
    expect(series).toBeTruthy()
    expect(series.body).toContain('Dune')
    expect(series.body).toContain('2')
  })

  it('flags the one-timer for a single-item artist in a 4+ collection', () => {
    const items = [
      record('a', { title: 'Nina Simone - Pastel Blues' }),
      record('b', { title: 'Miles Davis - Kind of Blue' }),
      record('c', { title: 'John Coltrane - A Love Supreme' }),
      record('d', { title: 'Billie Holiday - Lady in Satin' }),
    ]
    const stories = computeStories(items, recordsCatalog)
    const oneTimer = stories.find((s) => s.id === 'one-timer')
    expect(oneTimer).toBeTruthy()
    expect(oneTimer.actionable).toBe(true)
  })

  it('reports notes coverage for records', () => {
    const items = storyCrate().map((r, i) => (i < 4 ? { ...r, notes: 'found it' } : r))
    const stories = computeStories(items, recordsCatalog)
    const notes = stories.find((s) => s.id === 'notes-coverage')
    expect(notes).toBeTruthy()
    expect(notes.body).toContain('4 of 6')
  })

  it('shows total pages only when 5+ books have a numeric pageCount', () => {
    const withPages = computeStories(pageHeavyShelf(), booksCatalog)
    const pages = withPages.find((s) => s.id === 'total-pages')
    expect(pages).toBeTruthy()
    expect(pages.body).toContain('pages')

    // Only 3 have pageCount → the fact is omitted (§6.2).
    const few = computeStories([
      book('a', { pageCount: 300 }), book('b', { pageCount: 400 }), book('c', { pageCount: 500 }),
      book('d', {}), book('e', {}), book('f', {}),
    ], booksCatalog)
    expect(few.find((s) => s.id === 'total-pages')).toBeUndefined()
  })

  it('omits records-only facts for books and vice versa', () => {
    const bookStories = computeStories(seriesShelf(), booksCatalog)
    expect(bookStories.find((s) => s.id === 'country-mix')).toBeUndefined()
    expect(bookStories.find((s) => s.id === 'notes-coverage')).toBeUndefined()

    const recordStories = computeStories(storyCrate(), recordsCatalog)
    expect(recordStories.find((s) => s.id === 'series')).toBeUndefined()
    expect(recordStories.find((s) => s.id === 'total-pages')).toBeUndefined()
  })
})

// --- recommendations tier -------------------------------------------------

describe('computeStories — era lessons', () => {
  it('gives era-lesson recommendations only for a 4+ collection (§6.2)', () => {
    const big = computeStories(storyCrate(), recordsCatalog)
    expect(big.find((s) => s.id === 'era-lesson')).toBeTruthy()

    const small = computeStories(storyCrate().slice(0, 3), recordsCatalog)
    expect(small.find((s) => s.id === 'era-lesson')).toBeUndefined()
  })

  it('recommends only items the member already owns (nearest-neighbor within the collection)', () => {
    const stories = computeStories(storyCrate(), recordsCatalog)
    const era = stories.find((s) => s.id === 'era-lesson')
    const ownedAlbums = storyCrate().map((r) => r.title.split(' - ')[1])
    // Parse the "Closest in spirit: …" list (regex literals, so \d works).
    const picksPart = (era.body.split('Closest in spirit: ')[1] || '').split(', ')
    const picks = picksPart.map((p) => p.replace(/ \(\d{4}\)\.?$/, '').trim()).filter(Boolean)
    expect(picks.length).toBeGreaterThan(0)
    // Every pick is one of the member's own albums — never an external pick.
    for (const pick of picks) {
      expect(ownedAlbums).toContain(pick)
    }
    // No leftover template placeholder leaks through.
    expect(era.body).not.toContain('{closest}')
  })

  it('falls back to author + year when books have no categories', () => {
    const shelf = [
      book('a', { title: 'Ursula K. Le Guin - The Dispossessed', year: 1974 }),
      book('b', { title: 'Ursula K. Le Guin - The Lathe of Heaven', year: 1971 }),
      book('c', { title: 'Ursula K. Le Guin - The Left Hand of Darkness', year: 1969 }),
      book('d', { title: 'Frank Herbert - Dune', year: 1965 }),
    ]
    const stories = computeStories(shelf, booksCatalog)
    const era = stories.find((s) => s.id === 'era-lesson')
    // 1970s is the dominant decade (3 of 4 books) → an era lesson with
    // owned-book picks, no categories needed.
    expect(era).toBeTruthy()
    expect(era.body).toContain('1970')
    expect(era.body).toContain('The Dispossessed')
  })

  it('is deterministic — same collection always yields the same stories', () => {
    expect(computeStories(storyCrate(), recordsCatalog)).toEqual(computeStories(storyCrate(), recordsCatalog))
    expect(ids(computeStories(storyCrate(), recordsCatalog))).toEqual(ids(computeStories(storyCrate(), recordsCatalog)))
  })
})

// --- guards ---------------------------------------------------------------

describe('computeStories — guards', () => {
  it('never throws on weird item shapes', () => {
    expect(() => computeStories([null, {}, { id: 1 }, { id: 2, genre: 'not-array' }], recordsCatalog)).not.toThrow()
  })

  it('handles a single item without exploding', () => {
    const stories = computeStories([record('1')], recordsCatalog)
    expect(Array.isArray(stories)).toBe(true)
  })
})
