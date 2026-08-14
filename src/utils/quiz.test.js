import { describe, expect, it } from 'vitest'
import { buildQuiz, gradeAnswer, MIN_ITEMS, revealDate } from './quiz'
import { recordsCatalog, booksCatalog } from '../catalog'

// --- fixtures -------------------------------------------------------------

function record(id, overrides = {}) {
  return {
    id,
    title: `Artist ${id} - Album ${id}`,
    year: 1980,
    genre: ['Rock'],
    coverImage: `https://img.discogs.com/${id}.jpg`,
    dateAdded: '2026-01-01T12:00:00',
    notes: '',
    barcode: `1234567890${id}`,
    ...overrides,
  }
}

// 6 records covering all five question types: 5 distinct artists, 4 distinct
// years, 6 distinct add days, every item with a cover + year.
function fullCrate() {
  return [
    record('r1', { title: 'Nina Simone - Pastel Blues', year: 1965, dateAdded: '2026-01-01T12:00:00', notes: 'impulse buy at a fair' }),
    record('r2', { title: 'Miles Davis - Kind of Blue', year: 1959, dateAdded: '2026-01-02T12:00:00' }),
    record('r3', { title: 'John Coltrane - A Love Supreme', year: 1965, dateAdded: '2026-01-03T12:00:00' }),
    record('r4', { title: 'Billie Holiday - Lady in Satin', year: 1958, dateAdded: '2026-01-04T12:00:00' }),
    record('r5', { title: 'The Beatles - Revolver', year: 1966, dateAdded: '2026-01-05T12:00:00' }),
    record('r6', { title: 'Nina Simone - Wild Is the Wind', year: 1966, dateAdded: '2026-01-06T12:00:00' }),
  ]
}

const DAY = '2026-06-15'

// --- locked state ----------------------------------------------------------

describe('buildQuiz', () => {
  it('locks the quiz below 3 items (the "scan a few more first" state)', () => {
    expect(buildQuiz([], { day: DAY, catalog: recordsCatalog }).locked).toBe(true)
    expect(buildQuiz([record('a'), record('b')], { day: DAY, catalog: recordsCatalog }).locked).toBe(true)
    expect(MIN_ITEMS).toBe(3)
  })

  it('is not locked at exactly 3 items', () => {
    const quiz = buildQuiz([record('a'), record('b'), record('c')], { day: DAY, catalog: recordsCatalog })
    expect(quiz.locked).toBe(false)
    expect(quiz.questions.length).toBeGreaterThanOrEqual(3)
  })

  // --- determinism / day stability ---------------------------------------

  it('is stable within a day — the same collection + same day yield the same quiz', () => {
    const items = fullCrate()
    const a = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    const b = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    expect(a.questions).toEqual(b.questions)
    expect(a.day).toBe('2026-06-15')
  })

  it('accepts a Date object as the day and still seeds from the local day', () => {
    const items = fullCrate()
    const asDate = buildQuiz(items, { day: new Date(2026, 5, 15), catalog: recordsCatalog })
    const asKey = buildQuiz(items, { day: '2026-06-15', catalog: recordsCatalog })
    expect(asDate.questions).toEqual(asKey.questions)
  })

  it('seeds independently per catalog kind (records vs books)', () => {
    const items = fullCrate()
    const records = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    const books = buildQuiz(items, { day: DAY, catalog: booksCatalog })
    // A different kind gets a different seed — different question set.
    expect(JSON.stringify(records.questions)).not.toBe(JSON.stringify(books.questions))
  })

  it('honors an injected rng (test hook) deterministically', () => {
    const items = fullCrate()
    const fixed = () => 0.5
    const a = buildQuiz(items, { day: DAY, catalog: recordsCatalog, rng: fixed })
    const b = buildQuiz(items, { day: DAY, catalog: recordsCatalog, rng: fixed })
    expect(a.questions).toEqual(b.questions)
  })

  it('deals 3–5 questions', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    expect(quiz.questions.length).toBeGreaterThanOrEqual(3)
    expect(quiz.questions.length).toBeLessThanOrEqual(5)
  })

  // --- data sufficiency (requirements §4.2) ------------------------------

  it('never proposes a question with insufficient data — pools exclude what they need', () => {
    // 4 items; c and d have no cover; d has no year. Question pools must only
    // draw on items that carry the field each type needs.
    const items = [
      record('a', { year: 1980 }),
      record('b', { year: 1985 }),
      { id: 'c', title: 'C - No Cover', year: 1990, coverImage: '', dateAdded: '2026-01-03T12:00:00' },
      { id: 'd', title: 'D - No Cover Year', year: null, coverImage: '', dateAdded: '2026-01-04T12:00:00' },
    ]
    const quiz = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    expect(quiz.locked).toBe(false)

    const withCover = new Set(['a', 'b'])
    for (const q of quiz.questions) {
      // Cover-backed questions only ever use a+b (the only covered items).
      if (q.type === 'guessYear' || q.type === 'nameThatArtist' || q.type === 'stillYours') {
        expect(withCover.has(q.itemId)).toBe(true)
      }
      // guessYear only uses items that ALSO have a year.
      if (q.type === 'guessYear') {
        const item = items.find((it) => it.id === q.itemId)
        expect(item?.year).toBeTruthy()
      }
    }
  })

  it('drops nameThatArtist when there are not enough distinct owned artists for decoys', () => {
    // 3 items but only 2 distinct artists → only one decoy available, so the
    // type is never proposed (data sufficiency).
    const items = [
      record('a', { title: 'Nina Simone - One' }),
      record('b', { title: 'Nina Simone - Two' }),
      record('c', { title: 'Miles Davis - Blue' }),
    ]
    const quiz = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    expect(quiz.questions.every((q) => q.type !== 'nameThatArtist')).toBe(true)
  })

  it('drops newestOrOldest when items lack distinct add dates', () => {
    const items = [
      record('a', { dateAdded: '2026-01-01T12:00:00' }),
      record('b', { dateAdded: '2026-01-01T12:00:00' }),
      record('c', { dateAdded: '2026-01-01T12:00:00' }),
    ]
    const quiz = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    expect(quiz.questions.every((q) => q.type !== 'newestOrOldest')).toBe(true)
  })

  it('drops sortShelf when fewer than 3 distinct years exist', () => {
    const items = [
      record('a', { year: 1980 }),
      record('b', { year: 1980 }),
      record('c', { year: 1980 }),
    ]
    const quiz = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    expect(quiz.questions.every((q) => q.type !== 'sortShelf')).toBe(true)
  })

  it('never throws on malformed input or weird item shapes', () => {
    expect(() => buildQuiz(null, { day: DAY, catalog: recordsCatalog })).not.toThrow()
    expect(() => buildQuiz(undefined, { day: DAY })).not.toThrow()
    expect(() => buildQuiz('nope', { day: DAY })).not.toThrow()
    expect(() => buildQuiz([null, undefined, {}, { id: 1 }, { id: 2 }], { day: DAY, catalog: recordsCatalog })).not.toThrow()
  })

  // --- per-type shape + correctness --------------------------------------

  it('builds well-formed guessYear questions (cover + two years, one correct)', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'guessYear')
    expect(q).toBeTruthy()
    expect(q.options).toHaveLength(2)
    expect(q.answerIndex).toBeGreaterThanOrEqual(0)
    expect(q.answerIndex).toBeLessThan(2)
    expect(q.cover).toMatch(/^https?:\/\//)
    // The correct option is the item's real year.
    const item = fullCrate().find((it) => it.id === q.itemId)
    expect(Number(q.options[q.answerIndex])).toBe(item.year)
  })

  it('builds nameThatArtist with decoys that are other artists you own', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'nameThatArtist')
    expect(q).toBeTruthy()
    expect(q.options).toHaveLength(3)
    expect(new Set(q.options).size).toBe(3)
    const item = fullCrate().find((it) => it.id === q.itemId)
    expect(q.options[q.answerIndex]).toBe(item.title.split(' - ')[0])
  })

  it('builds newestOrOldest pointing at the item added first', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'newestOrOldest')
    expect(q).toBeTruthy()
    expect(q.itemIds).toHaveLength(2)
    expect(q.options).toHaveLength(2)
    const items = fullCrate()
    const earlier = items.find((it) => it.id === q.itemIds[0])
    const later = items.find((it) => it.id === q.itemIds[1])
    expect(new Date(earlier.dateAdded).getTime()).toBeLessThan(new Date(later.dateAdded).getTime())
  })

  it('builds stillYours as yes/no with the correct answer always "yes"', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'stillYours')
    expect(q).toBeTruthy()
    expect(q.options).toHaveLength(2)
    expect(q.options).toEqual(expect.arrayContaining(['Yes', 'No']))
    expect(q.options[q.answerIndex]).toBe('Yes')
  })

  it('builds sortShelf with a year-ascending answer order', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'sortShelf')
    expect(q).toBeTruthy()
    expect(q.options).toHaveLength(3)
    expect(q.answerIds).toHaveLength(3)
    const items = fullCrate()
    const years = q.answerIds.map((id) => items.find((it) => it.id === id).year)
    expect([...years].sort((a, b) => a - b)).toEqual(years)
  })

  // --- leak safety --------------------------------------------------------

  it('keeps question payloads leak-safe — ids + covers + labels only, secrets only in reveal', () => {
    const items = fullCrate().map((it) => ({ ...it, barcode: `RU-${it.id}-SECRET`, isbn: '978-0-00-SECRET', adminKey: 'hunter2' }))
    const quiz = buildQuiz(items, { day: DAY, catalog: recordsCatalog })
    for (const q of quiz.questions) {
      const top = Object.keys(q)
      for (const forbidden of ['barcode', 'isbn', 'adminKey', 'notes', 'dateAdded']) {
        expect(top).not.toContain(forbidden)
      }
      // Reveal carries ONLY the teaching data (title + dateAdded + notes).
      const revealKeys = Object.keys(q.reveal || {}).filter((k) => k !== 'ordered')
      expect(revealKeys.sort()).toEqual(['dateAdded', 'itemId', 'notes', 'title'])
      expect(JSON.stringify(q)).not.toMatch(/SECRET/)
    }
  })
})

// --- grading ---------------------------------------------------------------

describe('gradeAnswer', () => {
  it('grades a choice question by option index', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'guessYear')
    expect(gradeAnswer(q, q.answerIndex).correct).toBe(true)
    expect(gradeAnswer(q, 1 - q.answerIndex).correct).toBe(false)
  })

  it('grades sortShelf by the exact tapped order', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'sortShelf')
    expect(gradeAnswer(q, q.answerIds).correct).toBe(true)
    expect(gradeAnswer(q, [...q.answerIds].reverse()).correct).toBe(false)
    expect(gradeAnswer(q, q.answerIds.slice(0, 2)).correct).toBe(false)
  })

  it('grades newestOrOldest against the earlier-added item', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'newestOrOldest')
    expect(gradeAnswer(q, q.answerIndex).correct).toBe(true)
  })

  it('grades stillYours — only the yes option is correct', () => {
    const quiz = buildQuiz(fullCrate(), { day: DAY, catalog: recordsCatalog })
    const q = quiz.questions.find((x) => x.type === 'stillYours')
    expect(gradeAnswer(q, q.answerIndex).correct).toBe(true)
    expect(gradeAnswer(q, 1 - q.answerIndex).correct).toBe(false)
  })

  it('never throws and returns false for garbage', () => {
    expect(gradeAnswer(null, 0).correct).toBe(false)
    expect(gradeAnswer(undefined, []).correct).toBe(false)
    expect(gradeAnswer({}, 'nope').correct).toBe(false)
    expect(gradeAnswer({ type: 'sortShelf' }, []).correct).toBe(false)
  })
})

// --- reveal date -----------------------------------------------------------

describe('revealDate', () => {
  it('formats an ISO timestamp as "Month Year"', () => {
    expect(revealDate('2024-03-15T10:00:00')).toBe('March 2024')
    expect(revealDate('2026-06-02')).toBe('June 2026')
  })

  it('returns an empty string for unparseable input (never a fabricated date)', () => {
    expect(revealDate('')).toBe('')
    expect(revealDate(null)).toBe('')
    expect(revealDate('garbage')).toBe('')
    expect(revealDate(undefined)).toBe('')
  })
})
