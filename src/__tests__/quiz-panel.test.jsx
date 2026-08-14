import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import QuizPanel from '../components/QuizPanel'
import { recordsCatalog } from '../catalog'
import { buildQuiz, revealDate } from '../utils/quiz'
import { readLedger, recordQuizResult } from '../utils/progressionLedger'
import { setTrackingEnabled } from '../utils/track'

const EVENTS_KEY = 'runout.events'
// A fixed local "now" so the day-seeded quiz is deterministic in tests.
const TODAY = new Date(2026, 5, 15) // local June 15, 2026 → '2026-06-15'
const DAY_KEY = '2026-06-15'

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

// 6 records covering all five question types (5 artists, 4 years, 6 days).
function fullCrate() {
  return [
    record('r1', { title: 'Nina Simone - Pastel Blues', year: 1965, dateAdded: '2026-01-01T12:00:00' }),
    record('r2', { title: 'Miles Davis - Kind of Blue', year: 1959, dateAdded: '2026-01-02T12:00:00' }),
    record('r3', { title: 'John Coltrane - A Love Supreme', year: 1965, dateAdded: '2026-01-03T12:00:00' }),
    record('r4', { title: 'Billie Holiday - Lady in Satin', year: 1958, dateAdded: '2026-01-04T12:00:00' }),
    record('r5', { title: 'The Beatles - Revolver', year: 1966, dateAdded: '2026-01-05T12:00:00' }),
    record('r6', { title: 'Nina Simone - Wild Is the Wind', year: 1966, dateAdded: '2026-01-06T12:00:00' }),
  ]
}

function renderPanel(items, catalog = recordsCatalog, today = TODAY) {
  return render(
    <LocaleProvider>
      <QuizPanel items={items} catalog={catalog} today={today} />
    </LocaleProvider>
  )
}

/** Answer every question correctly and advance to the summary. */
function answerAllCorrect(quiz) {
  for (let i = 0; i < quiz.questions.length; i += 1) {
    const q = quiz.questions[i]
    if (q.type === 'sortShelf') {
      for (const id of q.answerIds) {
        const opt = q.options.find((o) => o.itemId === id)
        fireEvent.click(screen.getByRole('button', { name: opt.title }))
      }
    } else {
      fireEvent.click(screen.getByRole('button', { name: q.options[q.answerIndex] }))
    }
    fireEvent.click(screen.getByRole('button', { name: /Next question|Day complete!/ }))
  }
}

/** Answer the first question WRONG to force the teaching reveal. */
function answerFirstWrong(quiz) {
  const q = quiz.questions[0]
  if (q.type === 'sortShelf') {
    for (const id of [...q.answerIds].reverse()) {
      const opt = q.options.find((o) => o.itemId === id)
      fireEvent.click(screen.getByRole('button', { name: opt.title }))
    }
  } else {
    const wrongIdx = q.answerIndex === 0 ? 1 : 0
    fireEvent.click(screen.getByRole('button', { name: q.options[wrongIdx] }))
  }
}

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

describe('QuizPanel (release 1.3 — Crate Quiz)', () => {
  it('shows the locked "scan a few more first" state below 3 items', () => {
    renderPanel([record('a'), record('b')])
    expect(screen.getByText('Not enough items yet')).toBeInTheDocument()
    expect(screen.getByText(/Scan a few more records first/)).toBeInTheDocument()
  })

  it('starts from an intro and advances one question at a time', () => {
    renderPanel(fullCrate())
    expect(screen.getByText('The Crate Quiz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the quiz' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    expect(screen.getByText(/Question 1 of \d/)).toBeInTheDocument()
  })

  it('is stable within a day — the same collection + same day shows the same first prompt', () => {
    const items = fullCrate()
    const first = renderPanel(items)
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    const promptA = screen.getByText(/Question 1 of \d/).textContent
    first.unmount()

    renderPanel(items)
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    expect(screen.getByText(/Question 1 of \d/).textContent).toBe(promptA)
  })

  it('a perfect day lands in the ledger: +10 XP per correct, the play day, and a perfect day', () => {
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })
    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerAllCorrect(quiz)

    // Day-complete summary.
    expect(screen.getByText('Day complete!')).toBeInTheDocument()
    expect(screen.getByText('Perfect round! That\'s a streak worth bragging about.')).toBeInTheDocument()
    expect(screen.getByText(`You got ${quiz.questions.length} of ${quiz.questions.length} right.`)).toBeInTheDocument()
    expect(screen.getByText(/1-day streak/)).toBeInTheDocument()

    // Ledger: quiz XP + play day + perfect day, so progression reads it.
    const ledger = readLedger('records')
    expect(ledger.quizXp).toBe(quiz.questions.length * 10)
    expect(ledger.quizDays).toContain(DAY_KEY)
    expect(ledger.perfectDays).toContain(DAY_KEY)
  })

  it('a wrong answer reveals the real answer + the item story (date + notes)', () => {
    const items = fullCrate().map((it) => ({ ...it, notes: `note-${it.id}` }))
    const quiz = buildQuiz(items, { day: TODAY, catalog: recordsCatalog })
    const reveal = quiz.questions[0].reveal

    renderPanel(items)
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerFirstWrong(quiz)

    // The teaching reveal names the item, its add date, and its notes.
    const line = screen.getByText(/Wrong/)
    expect(line.textContent).toContain(reveal.title)
    expect(line.textContent).toContain(revealDate(reveal.dateAdded))
    expect(line.textContent).toContain(`note-${reveal.itemId}`)
  })

  it('shows the date-only variant when the reveal item has no notes (never fabricates)', () => {
    // All notes empty → the wrong-answer line carries the date, not a notes quote.
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })
    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerFirstWrong(quiz)

    const reveal = quiz.questions[0].reveal
    const line = screen.getByText(/Wrong/)
    expect(line.textContent).toContain(revealDate(reveal.dateAdded))
    expect(line.textContent).not.toContain('Your notes say')
  })

  it('records the play day and continues the streak across days (1-day grace via currentStreak)', () => {
    // Yesterday already played → completing today makes it a 2-day streak.
    recordQuizResult('records', { day: '2026-06-14', correct: 2, total: 3 })
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })

    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerAllCorrect(quiz)

    expect(screen.getByText(/2-day streak/)).toBeInTheDocument()
    expect(readLedger('records').quizDays).toContain(DAY_KEY)
  })

  it('does not replay an already-played day — shows the summary instead (no double XP)', () => {
    recordQuizResult('records', { day: DAY_KEY, correct: 2, total: 3 })
    const before = readLedger('records').quizXp // 20

    renderPanel(fullCrate())
    // No intro / start — straight to the already-played summary.
    expect(screen.queryByRole('button', { name: 'Start the quiz' })).not.toBeInTheDocument()
    expect(screen.getByText(/done today's quiz/i)).toBeInTheDocument()
    expect(screen.getByText(/1-day streak/)).toBeInTheDocument()

    // XP is untouched — replaying cannot double-grant.
    expect(readLedger('records').quizXp).toBe(before)
  })

  it('emits gamif_quiz_answered per answer and gamif_quiz_streak on completion', () => {
    setTrackingEnabled(true)
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })
    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerAllCorrect(quiz)

    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    const answered = events.filter((e) => e.event === 'gamif_quiz_answered')
    expect(answered).toHaveLength(quiz.questions.length)
    for (const e of answered) {
      expect(e.props.kind).toBe('records')
      expect(e.props.correct).toBe(true)
      expect(e.props.day).toBe(DAY_KEY)
    }
    expect(events.some((e) => e.event === 'gamif_quiz_streak' && e.props.kind === 'records' && e.props.streak === 1)).toBe(true)
  })

  it('emits gamif_quiz_streak reflecting consecutive days when tracking is on', () => {
    setTrackingEnabled(true)
    recordQuizResult('records', { day: '2026-06-14', correct: 2, total: 3 })
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })

    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerAllCorrect(quiz)

    const events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    expect(events.some((e) => e.event === 'gamif_quiz_streak' && e.props.streak === 2)).toBe(true)
  })

  it('is fully offline — no network access during a full playthrough', () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })

    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerAllCorrect(quiz)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('reveals the correct order on a sortShelf miss through the panel', () => {
    const items = fullCrate()
    const quiz = buildQuiz(items, { day: TODAY, catalog: recordsCatalog })
    const sortIdx = quiz.questions.findIndex((q) => q.type === 'sortShelf')
    expect(sortIdx).toBeGreaterThanOrEqual(0)

    renderPanel(items)
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))

    // Answer every question before the sortShelf correctly.
    for (let i = 0; i < sortIdx; i += 1) {
      const q = quiz.questions[i]
      fireEvent.click(screen.getByRole('button', { name: q.options[q.answerIndex] }))
      fireEvent.click(screen.getByRole('button', { name: /Next question|Day complete!/ }))
    }

    // Miss the sortShelf: tap the options in REVERSE order.
    const q = quiz.questions[sortIdx]
    for (const id of [...q.answerIds].reverse()) {
      const opt = q.options.find((o) => o.itemId === id)
      fireEvent.click(screen.getByRole('button', { name: opt.title }))
    }

    // The teaching reveal spells out the correct year order.
    const order = q.reveal.ordered.map((o) => `${o.title} (${o.year})`).join(' · ')
    expect(screen.getByText(`Correct order: ${order}`)).toBeInTheDocument()
    expect(screen.getByText(/Wrong/)).toBeInTheDocument()
  })

  it('resets the streak after two missed days — the next play starts a fresh 1-day streak', () => {
    // Last played 3 days ago (two+ missed days) → the old run has reset.
    recordQuizResult('records', { day: '2026-06-12', correct: 2, total: 3 })
    const quiz = buildQuiz(fullCrate(), { day: TODAY, catalog: recordsCatalog })

    renderPanel(fullCrate())
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerAllCorrect(quiz)

    // A fresh 1-day streak — the two-day gap broke the old one.
    expect(screen.getByText(/1-day streak/)).toBeInTheDocument()
    expect(screen.queryByText(/2-day streak|3-day streak/)).not.toBeInTheDocument()
  })

  it('never renders barcodes, ISBNs, access codes, or admin keys anywhere in the quiz UI', () => {
    const items = fullCrate().map((it) => ({
      ...it,
      barcode: `01234567890${it.id}`,
      isbn: `978-3-16-148410-${it.id}`,
      accessCode: 'RU-1234-5678-9012',
      adminKey: 'hunter2',
      notes: `note-${it.id}`,
    }))
    const quiz = buildQuiz(items, { day: TODAY, catalog: recordsCatalog })

    renderPanel(items)
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))
    answerFirstWrong(quiz)

    // The teaching reveal shows the item's own notes (allowed)…
    const reveal = quiz.questions[0].reveal
    expect(screen.getByText(/Wrong/).textContent).toContain(`note-${reveal.itemId}`)

    // …but planted secrets never appear anywhere in the rendered quiz.
    const body = document.body.textContent
    expect(body).not.toContain('RU-1234-5678-9012')
    expect(body).not.toContain('hunter2')
    expect(body).not.toContain('978-3-16-148410-')
    expect(body).not.toContain('01234567890')
  })
})
