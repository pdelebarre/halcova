import { describe, expect, it } from 'vitest'
import {
  computeBadges,
  computeLevel,
  computeProgression,
  computeXp,
  LEVEL_THRESHOLDS,
} from './progression'
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
    dateAdded: '2026-03-14T12:00:00',
    notes: '',
    barcode: `1234567890${id}`,
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

/** n records, each with its own notes. */
function notedCrate(n) {
  return Array.from({ length: n }, (_, i) => record(`n${i}`, { notes: 'pressing details' }))
}

/** 10 records landing on the same local day. */
function impulseDayCrate() {
  return Array.from({ length: 10 }, (_, i) => record(`imp${i}`, {
    dateAdded: `2026-06-02T0${i}:00:00`,
    genre: ['Rock'],
    year: 1990,
  }))
}

/** 4 records by 4 distinct artists — every artist appears once. */
function oneTimerCrate() {
  return [
    record('a', { title: 'Nina Simone - Pastel Blues', genre: ['Jazz'], year: 1965 }),
    record('b', { title: 'Miles Davis - Kind of Blue', genre: ['Jazz'], year: 1959 }),
    record('c', { title: 'John Coltrane - A Love Supreme', genre: ['Jazz'], year: 1965 }),
    record('d', { title: 'Billie Holiday - Lady in Satin', genre: ['Jazz'], year: 1958 }),
  ]
}

/** Two pressings of the same album. */
function variantCrate() {
  return [
    record('v1', { title: 'Pink Floyd - Dark Side of the Moon', year: 1973, barcode: '111' }),
    record('v2', { title: 'Pink Floyd - Dark Side of the Moon', year: 2016, barcode: '222' }),
  ]
}

// --- XP -------------------------------------------------------------------

describe('computeXp', () => {
  it('yields 0 for an empty collection', () => {
    const xp = computeXp([], recordsCatalog)
    expect(xp.total).toBe(0)
    expect(xp.breakdown).toEqual({ owned: 0, notes: 0, firstLend: 0, quizXp: 0 })
  })

  it('awards +10 per owned item (add vs manual is not stored — every owned item counts as one add)', () => {
    const xp = computeXp([record('1'), record('2'), record('3')], recordsCatalog)
    expect(xp.breakdown.owned).toBe(3)
    expect(xp.total).toBe(30)
  })

  it('awards +5 per item with non-empty notes', () => {
    const xp = computeXp(notedCrate(4), recordsCatalog)
    expect(xp.breakdown.notes).toBe(4)
    expect(xp.total).toBe(4 * 10 + 4 * 5)
  })

  it('awards +15 once for the first lend (lending history)', () => {
    const items = [
      record('1', { lendingHistory: [{ borrower: 'Sam', lentOn: '2026-01-01', returnedOn: '2026-01-10' }] }),
      record('2', { lendingHistory: [{ borrower: 'Alex', lentOn: '2026-02-01', returnedOn: '2026-02-10' }] }),
    ]
    const xp = computeXp(items, recordsCatalog)
    expect(xp.breakdown.firstLend).toBe(1)
    expect(xp.total).toBe(2 * 10 + 15)
  })

  it('treats a currently-out item as a lend too', () => {
    const xp = computeXp([record('1', { lending: { borrower: 'Sam', lentOn: '2026-01-01' } })], recordsCatalog)
    expect(xp.breakdown.firstLend).toBe(1)
  })

  it('adds quiz XP from the ledger (0 when absent)', () => {
    expect(computeXp([], recordsCatalog, {}).breakdown.quizXp).toBe(0)
    expect(computeXp([], recordsCatalog, { quizXp: 40 }).breakdown.quizXp).toBe(40)
    expect(computeXp([], recordsCatalog, { quizXp: 40 }).total).toBe(40)
  })

  it('never throws on weird item shapes', () => {
    expect(() => computeXp([null, undefined, {}, { id: 1 }, { id: 2, notes: 3 }], recordsCatalog)).not.toThrow()
    expect(() => computeXp('nope', recordsCatalog)).not.toThrow()
  })
})

// --- Levels ---------------------------------------------------------------

describe('computeLevel', () => {
  const copy = { levels: recordsCatalog.copy.gamif.progression.levels }

  it('maps XP to the level ladder from copy-bank.md §4', () => {
    expect(computeLevel(0, copy).level).toBe(1)
    expect(computeLevel(0, copy).title).toBe('Crate Sprout')
    expect(computeLevel(99, copy).level).toBe(1)
    expect(computeLevel(100, copy).level).toBe(2)
    expect(computeLevel(100, copy).title).toBe('Crate Nerd')
    expect(computeLevel(300, copy).level).toBe(3)
    expect(computeLevel(750, copy).level).toBe(4)
    expect(computeLevel(1500, copy).level).toBe(5)
    expect(computeLevel(5000, copy).level).toBe(5)
  })

  it('reports nextThreshold and progress toward it', () => {
    const at100 = computeLevel(100, copy)
    expect(at100.nextThreshold).toBe(LEVEL_THRESHOLDS[2]) // 300
    expect(at100.progress).toBeCloseTo(0, 1)

    const mid = computeLevel(200, copy)
    expect(mid.nextThreshold).toBe(300)
    expect(mid.progress).toBeCloseTo(0.5, 1)
  })

  it('is capped at max level with progress 1', () => {
    const max = computeLevel(1500, copy)
    expect(max.nextThreshold).toBeNull()
    expect(max.progress).toBe(1)
  })

  it('uses the books ladder for books', () => {
    const bcopy = { levels: booksCatalog.copy.gamif.progression.levels }
    expect(computeLevel(100, bcopy).title).toBe('Shelf Stacker')
    expect(computeLevel(0, bcopy).title).toBe('Page Turner')
  })

  it('falls back gracefully when copy.levels is missing', () => {
    expect(computeLevel(120, {}).title).toBe('Level 2')
    expect(computeLevel('nope', {}).level).toBe(1)
  })
})

// --- Badges ---------------------------------------------------------------

describe('computeBadges', () => {
  it('keeps every badge for the kind, with no impossible ones (req §7.3)', () => {
    const badges = computeBadges([record('1')], recordsCatalog)
    const ids = badges.map((b) => b.id)
    expect(ids).toEqual(expect.arrayContaining([
      'digger', 'genre-tourist', 'time-traveler', 'impulse-buyer',
      'sleeve-sleuth', 'one-timer', 'variant-hoarder', 'friend-of-crate',
    ]))
    // Deferred badges are present but honestly marked — never unlockable today.
    for (const b of badges) {
      if (b.deferred) {
        expect(b.unlocked).toBe(false)
        expect(b.reason).toBeTypeOf('string')
      }
    }
    expect(badges.some((b) => b.id === 'completist' && b.deferred)).toBe(true)
    expect(badges.some((b) => b.id === 'balanced-diet' && b.deferred)).toBe(true)
    expect(badges.some((b) => b.id === 'quiz-whiz' && b.deferred)).toBe(true)
  })

  it('unlocks digger at 50 records and pageturner at 25 books', () => {
    const digger = computeBadges(Array.from({ length: 50 }, (_, i) => record(`d${i}`)), recordsCatalog)
    expect(digger.find((b) => b.id === 'digger').unlocked).toBe(true)
    const notYet = computeBadges(Array.from({ length: 49 }, (_, i) => record(`d${i}`)), recordsCatalog)
    expect(notYet.find((b) => b.id === 'digger').unlocked).toBe(false)

    const books = Array.from({ length: 25 }, (_, i) => book(`p${i}`))
    const badges = computeBadges(books, booksCatalog)
    expect(badges.find((b) => b.id === 'pageturner').unlocked).toBe(true)
    // Records never see the books-only badge.
    expect(computeBadges([record('1')], recordsCatalog).some((b) => b.id === 'pageturner')).toBe(false)
  })

  it('unlocks genre-tourist at 10+ genres', () => {
    const genres = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    const items = genres.map((g, i) => record(`g${i}`, { genre: [g] }))
    expect(computeBadges(items, recordsCatalog).find((b) => b.id === 'genre-tourist').unlocked).toBe(true)
  })

  it('unlocks time-traveler at items from 5+ decades', () => {
    const items = [1960, 1970, 1980, 1990, 2000].map((y, i) => record(`y${i}`, { year: y }))
    expect(computeBadges(items, recordsCatalog).find((b) => b.id === 'time-traveler').unlocked).toBe(true)
    const three = [1960, 1970, 1980].map((y, i) => record(`y${i}`, { year: y }))
    expect(computeBadges(three, recordsCatalog).find((b) => b.id === 'time-traveler').unlocked).toBe(false)
  })

  it('unlocks impulse-buyer at 10 items added in one local day (dateAdded bucketing)', () => {
    const badges = computeBadges(impulseDayCrate(), recordsCatalog)
    expect(badges.find((b) => b.id === 'impulse-buyer').unlocked).toBe(true)
  })

  it('unlocks sleeve-sleuth at notes on 10 items', () => {
    expect(computeBadges(notedCrate(10), recordsCatalog).find((b) => b.id === 'sleeve-sleuth').unlocked).toBe(true)
    expect(computeBadges(notedCrate(9), recordsCatalog).find((b) => b.id === 'sleeve-sleuth').unlocked).toBe(false)
  })

  it('unlocks one-timer when every artist appears exactly once in a 4+ collection', () => {
    expect(computeBadges(oneTimerCrate(), recordsCatalog).find((b) => b.id === 'one-timer').unlocked).toBe(true)
    const repeated = [record('1', { title: 'X - A' }), record('2', { title: 'X - B' }), record('3', { title: 'X - C' }), record('4', { title: 'X - D' })]
    expect(computeBadges(repeated, recordsCatalog).find((b) => b.id === 'one-timer').unlocked).toBe(false)
  })

  it('unlocks variant-hoarder at two pressings of one album', () => {
    expect(computeBadges(variantCrate(), recordsCatalog).find((b) => b.id === 'variant-hoarder').unlocked).toBe(true)
  })

  it('unlocks friend-of-crate only after a lend has returned', () => {
    const returned = computeBadges([
      record('1', { lendingHistory: [{ borrower: 'Sam', lentOn: '2026-01-01', returnedOn: '2026-01-10' }] }),
    ], recordsCatalog)
    expect(returned.find((b) => b.id === 'friend-of-crate').unlocked).toBe(true)

    const stillOut = computeBadges([
      record('1', { lending: { borrower: 'Sam', lentOn: '2026-01-01' } }),
    ], recordsCatalog)
    expect(stillOut.find((b) => b.id === 'friend-of-crate').unlocked).toBe(false)
  })

  it('never throws on an empty or malformed collection', () => {
    expect(() => computeBadges([], recordsCatalog)).not.toThrow()
    expect(() => computeBadges(null, recordsCatalog)).not.toThrow()
    const badges = computeBadges([], recordsCatalog)
    expect(badges.every((b) => b.unlocked === false)).toBe(true)
  })

  it('is idempotent — same input, same output', () => {
    const items = impulseDayCrate()
    expect(computeBadges(items, recordsCatalog)).toEqual(computeBadges(items, recordsCatalog))
  })
})

// --- bundle ---------------------------------------------------------------

describe('computeProgression', () => {
  it('bundles xp + level + badges', () => {
    const prog = computeProgression(impulseDayCrate(), recordsCatalog)
    expect(prog.kind).toBe('records')
    expect(prog.xp.total).toBe(100)
    expect(prog.level.level).toBe(2) // 10 items → 100 XP → Crate Nerd
    expect(prog.badges.find((b) => b.id === 'impulse-buyer').unlocked).toBe(true)
  })

  it('works for books and honors the books ladder', () => {
    const prog = computeProgression(Array.from({ length: 10 }, (_, i) => book(`b${i}`)), booksCatalog)
    expect(prog.kind).toBe('books')
    expect(prog.xp.total).toBe(100)
    expect(prog.level.title).toBe('Shelf Stacker')
  })

  it('never throws on empty input', () => {
    expect(() => computeProgression([], recordsCatalog)).not.toThrow()
    expect(computeProgression([], recordsCatalog).level.level).toBe(1)
  })
})
