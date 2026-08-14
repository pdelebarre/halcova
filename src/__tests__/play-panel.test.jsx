import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import PlayPanel from '../components/PlayPanel'
import { recordsCatalog, booksCatalog } from '../catalog'
import { buildQuiz } from '../utils/quiz'
import { readLedger } from '../utils/progressionLedger'

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

// 6 books: 5 distinct authors, 5 distinct years, 6 distinct add dates, all
// with covers — every quiz question type is available to the books catalog,
// so the books path exercises the same playthrough as the records path.
function book(id, overrides = {}) {
  return {
    id,
    title: `Author ${id} - Book ${id}`,
    year: 2000,
    genre: [],
    coverImage: `https://books.google.com/${id}.jpg`,
    dateAdded: '2026-01-01T12:00:00',
    notes: '',
    barcode: `978000000000${id}`,
    ...overrides,
  }
}

function bookCrate() {
  return [
    book('b1', { title: 'Ursula K. Le Guin - A Wizard of Earthsea', year: 1968, dateAdded: '2026-01-01T12:00:00' }),
    book('b2', { title: 'Gabriel García Márquez - One Hundred Years of Solitude', year: 1967, dateAdded: '2026-01-02T12:00:00' }),
    book('b3', { title: 'J.R.R. Tolkien - The Fellowship of the Ring', year: 1954, dateAdded: '2026-01-03T12:00:00' }),
    book('b4', { title: 'Toni Morrison - Beloved', year: 1987, dateAdded: '2026-01-04T12:00:00' }),
    book('b5', { title: 'George Orwell - Nineteen Eighty-Four', year: 1949, dateAdded: '2026-01-05T12:00:00' }),
    book('b6', { title: 'Ursula K. Le Guin - The Tombs of Atuan', year: 1971, dateAdded: '2026-01-06T12:00:00' }),
  ]
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

  it('shows the books-flavored empty state (kind-specific copy)', () => {
    renderPanel([], booksCatalog)
    // The persona empty state interpolates the catalog entity: book, not record.
    expect(screen.getByText('Add a book first')).toBeInTheDocument()
  })

  it('shows the books-flavored quiz locked copy below 3 books', () => {
    renderPanel(bookCrate().slice(0, 2), booksCatalog)
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }))

    expect(screen.getByText('Not enough items yet')).toBeInTheDocument()
    expect(screen.getByText('Scan a few more books first — the quiz needs at least three to read your shelf.')).toBeInTheDocument()
  })

  it('runs a books-flavored quiz playthrough end-to-end (kind copy + books ledger)', () => {
    const books = bookCrate()
    // Rebuild the same day-seeded quiz the panel deals (same local day).
    const quiz = buildQuiz(books, { day: new Date(), catalog: booksCatalog })

    renderPanel(books, booksCatalog)
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start the quiz' }))

    // Answer the first question correctly → the books (shelf) praise line.
    const q0 = quiz.questions[0]
    if (q0.type === 'sortShelf') {
      for (const id of q0.answerIds) {
        const opt = q0.options.find((o) => o.itemId === id)
        fireEvent.click(screen.getByRole('button', { name: opt.title }))
      }
    } else {
      fireEvent.click(screen.getByRole('button', { name: q0.options[q0.answerIndex] }))
    }
    // correct[0] interpolates the books collectionLabel: shelf, not crate.
    expect(screen.getByText('You remembered. The shelf is proud.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next question|Day complete!/ }))

    // Finish the rest correctly.
    for (let i = 1; i < quiz.questions.length; i += 1) {
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

    expect(screen.getByText('Day complete!')).toBeInTheDocument()

    // The books play records into the BOOKS ledger (+10 XP per correct)…
    const ledger = readLedger('books')
    expect(ledger.quizDays).toHaveLength(1)
    expect(ledger.quizXp).toBe(quiz.questions.length * 10)
    // …and never touches the records ledger (per-kind isolation).
    expect(readLedger('records').quizXp).toBe(0)
  })
})
