import { describe, expect, it } from 'vitest'
import { computePersona } from './persona'
import { recordsCatalog, booksCatalog } from '../catalog'

// --- fixtures -------------------------------------------------------------

function record(id, overrides = {}) {
  return {
    id,
    title: `Artist ${id} - Album ${id}`,
    year: 1980,
    genre: ['Rock'],
    style: [],
    formatType: 'LP',
    country: 'US',
    dateAdded: '2026-03-14T12:00:00Z',
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
    dateAdded: '2026-03-14T12:00:00Z',
    ...overrides,
  }
}

// 8 records, 8 distinct genres + artists, same year — clean Genre Tourist.
function wideGenreCrate() {
  const genres = ['Jazz', 'Rock', 'Soul', 'Funk', 'Reggae', 'Blues', 'Folk', 'Electronic']
  return genres.map((g, i) => record(`r${i}`, { genre: [g], year: 1980 }))
}

// 8 records, 6 by one artist, same year — clean Completist.
function completistCrate() {
  const items = []
  for (let i = 0; i < 6; i += 1) items.push(record(`m${i}`, { title: `Miles Davis - Kind of Blue ${i}`, genre: ['Jazz'], year: 1965 }))
  items.push(record('o1', { title: 'Nina Simone - Pastel Blues', genre: ['Jazz'], year: 1965 }))
  items.push(record('o2', { title: 'John Coltrane - A Love Supreme', genre: ['Jazz'], year: 1965 }))
  return items
}

// 10 records landing on the same local day — clean Impulse Buyer.
function impulseDayCrate() {
  const items = []
  for (let i = 0; i < 10; i += 1) {
    items.push(record(`imp${i}`, {
      dateAdded: `2026-06-02T0${i}:00:00Z`,
      genre: ['Rock'],
      year: 1990,
    }))
  }
  return items
}

// 10 records, 7 from the 1960s, spanning 1960–2000 — clean Time Traveler.
// Each item gets its own add day so the burst rule (10-in-one-day) can't fire.
function timeTravelerCrate() {
  const items = []
  for (let i = 0; i < 7; i += 1) items.push(record(`t${i}`, { genre: [`Genre${i}`], year: 1965, dateAdded: `2026-01-0${i + 1}T12:00:00Z` }))
  items.push(record('t7', { genre: ['Gap1'], year: 1975, dateAdded: '2026-02-01T12:00:00Z' }))
  items.push(record('t8', { genre: ['Gap2'], year: 1985, dateAdded: '2026-02-02T12:00:00Z' }))
  items.push(record('t9', { genre: ['Gap3'], year: 2000, dateAdded: '2026-02-03T12:00:00Z' }))
  return items
}

// 4 books: two distinct single-book series + two standalone titles.
function seriesStarterShelf() {
  return [
    book('s1', { title: 'Ursula K. Le Guin - Earthsea - A Wizard of Earthsea', genre: ['Fantasy'], year: 1968 }),
    book('s2', { title: 'Frank Herbert - Dune - Dune', genre: ['Sci-Fi'], year: 1965 }),
    book('s3', { title: 'George Orwell - Nineteen Eighty-Four', genre: ['Fiction'], year: 1949 }),
    book('s4', { title: 'Aldous Huxley - Brave New World', genre: ['Fiction'], year: 1932 }),
  ]
}

// 5 books each with pageCount — clean Page Counter.
function pageCounterShelf() {
  const items = []
  for (let i = 0; i < 5; i += 1) {
    items.push(book(`p${i}`, { genre: ['Fiction'], year: 1990, pageCount: 700 }))
  }
  return items
}

// 8 books, 8 distinct categories + authors — clean Genre Hedonist.
function hedonistShelf() {
  const cats = ['Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'History', 'Poetry', 'Biography', 'Self-Help']
  return cats.map((c, i) => book(`b${i}`, { genre: [c], year: 2000 }))
}

// --- tests ----------------------------------------------------------------

describe('computePersona', () => {
  it('returns null for an empty collection', () => {
    expect(computePersona([], recordsCatalog)).toBeNull()
    expect(computePersona(null, recordsCatalog)).toBeNull()
  })

  it('resolves the young-collection fallback for fewer than 4 items', () => {
    const small = [record('a'), record('b'), record('c')]
    const persona = computePersona(small, recordsCatalog)
    expect(persona.archetypeId).toBe('fallback')
    expect(persona.title).toBe('A Young Collection')
    expect(persona.verdict).toMatch(/young/i)
    // Fallback shows a single count stat.
    expect(persona.stats).toHaveLength(1)
    expect(persona.stats[0].value).toBe('3')
  })

  it('renders from a realistic mixed collection without throwing', () => {
    const items = [
      record('1', { genre: ['Jazz'], year: 1959 }),
      record('2', { genre: ['Rock'], year: 1973, formatType: 'CD' }),
      record('3', { genre: ['Soul'], year: 1971 }),
      record('4', { genre: ['Funk'], year: 1978 }),
      record('5', { genre: ['Jazz'], year: 1965 }),
      record('6', { genre: ['Blues'], year: 1962 }),
      record('7', { genre: ['Reggae'], year: 1974 }),
      record('8', { genre: ['Electronic'], year: 1991 }),
    ]
    expect(() => computePersona(items, recordsCatalog)).not.toThrow()
    const persona = computePersona(items, recordsCatalog)
    expect(persona).toBeTruthy()
    expect(persona.title).toBeTypeOf('string')
    expect(persona.verdict).toBeTypeOf('string')
    expect(Array.isArray(persona.stats)).toBe(true)
    expect(persona.stats.length).toBeGreaterThanOrEqual(1)
  })

  it('never throws when records-only fields are missing', () => {
    // No year/genre/formatType/style/country/dateAdded — degraded data path.
    const sparse = [
      { id: '1', title: 'A - B' },
      { id: '2', title: 'C - D' },
      { id: '3', title: 'E - F' },
      { id: '4', title: 'G - H' },
    ]
    expect(() => computePersona(sparse, recordsCatalog)).not.toThrow()
    expect(computePersona(sparse, recordsCatalog)).toBeTruthy()
  })

  it('never throws on malformed items and treats an all-invalid collection as empty', () => {
    expect(() => computePersona([null, undefined, {}, { id: 1, title: 'A - B' }], recordsCatalog)).not.toThrow()
    expect(computePersona([null, undefined], recordsCatalog)).toBeNull()
  })

  it('resolves Genre Tourist for a wide-genre crate', () => {
    const persona = computePersona(wideGenreCrate(), recordsCatalog)
    expect(persona.archetypeId).toBe('genre-tourist')
    expect(persona.title).toBe('The Genre Tourist')
    expect(persona.stats).toHaveLength(3)
    expect(persona.stats.map((s) => s.label)).toEqual(['Genres', 'Labels', 'Countries'])
    expect(persona.stats[0].value).toBe('8')
  })

  it('resolves Completist when one artist dominates and interpolates the artist name', () => {
    const persona = computePersona(completistCrate(), recordsCatalog)
    expect(persona.archetypeId).toBe('completist')
    expect(persona.verdict).toContain('Miles Davis')
  })

  it('resolves Impulse Buyer when 10 land on one day and interpolates the burst', () => {
    const persona = computePersona(impulseDayCrate(), recordsCatalog)
    expect(persona.archetypeId).toBe('impulse-buyer')
    expect(persona.verdict).toContain('10')
  })

  it('resolves Time Traveler on a decade bias and interpolates the decade year', () => {
    const persona = computePersona(timeTravelerCrate(), recordsCatalog)
    expect(persona.archetypeId).toBe('time-traveler')
    expect(persona.verdict).toContain('1960')
    expect(persona.stats[0].label).toBe('From the 1960s')
    expect(persona.stats[0].value).toBe('70%')
  })

  it('changes archetype when the collection meaningfully changes', () => {
    const tourist = computePersona(wideGenreCrate(), recordsCatalog)
    const completist = computePersona(completistCrate(), recordsCatalog)
    const impulse = computePersona(impulseDayCrate(), recordsCatalog)
    expect(tourist.archetypeId).not.toBe(completist.archetypeId)
    expect(completist.archetypeId).not.toBe(impulse.archetypeId)
    expect(impulse.archetypeId).not.toBe(tourist.archetypeId)
  })

  it('keeps records and books archetypes separate by kind', () => {
    const recordPersona = computePersona(wideGenreCrate(), recordsCatalog)
    const recordIds = ['impulse-buyer', 'completist', 'variant-collector', 'time-traveler', 'sophisticate', 'genre-tourist', 'crate-digger', 'one-timer', 'fallback']
    expect(recordIds).toContain(recordPersona.archetypeId)

    const bookPersona = computePersona(hedonistShelf(), booksCatalog)
    const bookIds = ['series-starter', 'one-series-wonder', 'page-counter', 'genre-hedonist', 'first-edition-idealist', 'couch-intellectual', 'fallback']
    expect(bookIds).toContain(bookPersona.archetypeId)

    // Same-shaped spread resolves to a records archetype vs a books archetype.
    expect(bookPersona.archetypeId).not.toBe(recordPersona.archetypeId)
  })

  it('resolves Genre Hedonist for a wide-category shelf', () => {
    const persona = computePersona(hedonistShelf(), booksCatalog)
    expect(persona.archetypeId).toBe('genre-hedonist')
    expect(persona.title).toBe('The Genre Hedonist')
    expect(persona.stats).toHaveLength(3)
  })

  it('resolves Series Starter from unfinished series and interpolates the series name', () => {
    const persona = computePersona(seriesStarterShelf(), booksCatalog)
    expect(persona.archetypeId).toBe('series-starter')
    expect(persona.verdict).toContain('Earthsea')
  })

  it('resolves Page Counter when ≥5 items carry pageCount and sums pages', () => {
    const persona = computePersona(pageCounterShelf(), booksCatalog)
    expect(persona.archetypeId).toBe('page-counter')
    const pagesStat = persona.stats.find((s) => s.key === 'pages')
    expect(pagesStat.value).toBe('3,500')
  })

  it('falls back to author + year when books have no categories', () => {
    const noCategories = [0, 1, 2, 3, 4, 5].map((i) => book(`n${i}`, { genre: [], year: 1990 + i }))
    expect(() => computePersona(noCategories, booksCatalog)).not.toThrow()
    const persona = computePersona(noCategories, booksCatalog)
    expect(persona).toBeTruthy()
    // Six distinct authors → Couch Intellectual (no category signal needed).
    expect(persona.archetypeId).toBe('couch-intellectual')
  })

  it('produces 2–3 labelled stats for each resolved archetype', () => {
    for (const [items, catalog] of [
      [wideGenreCrate(), recordsCatalog],
      [completistCrate(), recordsCatalog],
      [timeTravelerCrate(), recordsCatalog],
      [impulseDayCrate(), recordsCatalog],
      [hedonistShelf(), booksCatalog],
      [pageCounterShelf(), booksCatalog],
      [seriesStarterShelf(), booksCatalog],
    ]) {
      const persona = computePersona(items, catalog)
      expect(persona.stats.length).toBeGreaterThanOrEqual(2)
      expect(persona.stats.length).toBeLessThanOrEqual(3)
      for (const stat of persona.stats) {
        expect(typeof stat.label).toBe('string')
        expect(stat.label.length).toBeGreaterThan(0)
        expect(typeof stat.value).toBe('string')
      }
    }
  })
})
