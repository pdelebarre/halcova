import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AlbumDetail from '../components/AlbumDetail'
import BookDetail from '../components/BookDetail'
import ReviewsSection from '../components/ReviewsSection'
import { booksCatalog, recordsCatalog } from '../catalog'

// AlbumDetail fetches a tracklist for items with a discogsId — stub it out.
vi.mock('../api/discogs', () => ({
  getReleaseDetail: vi.fn().mockResolvedValue({ tracklist: [] }),
}))

// The detail sheets mount the shared ReviewsSection — stub its hook so the
// mount tests never hit the network and the section renders a quiet empty
// state.
vi.mock('../hooks/useReviews', () => ({
  useReviews: vi.fn(() => ({
    reviews: [],
    mine: null,
    allReviews: [],
    aggregate: { avg: 0, count: 0 },
    status: 'ready',
    error: null,
    addOrUpdate: vi.fn().mockResolvedValue({ review: {} }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    signedIn: false,
  })),
}))

// Spy on the ReviewsSection mount so tests can assert the review thread is
// routed through catalog.reviewKey(item) and that showToast is forwarded.
vi.mock('../components/ReviewsSection', () => ({
  default: vi.fn(() => null),
}))

const RECORD = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  formatRaw: 'LP',
  label: 'Columbia',
  catno: 'CL 1355',
  country: 'US',
  genre: ['Jazz'],
  discogsId: 101,
  barcode: '0767325734129',
  notes: '',
}

function renderDetail(item = RECORD, overrides = {}) {
  const props = {
    item,
    catalog: recordsCatalog,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onSaveNotes: vi.fn(),
    ...overrides,
  }
  return render(<AlbumDetail {...props} />)
}

// Last props the (mocked) ReviewsSection was mounted with.
function lastReviewsProps() {
  const calls = ReviewsSection.mock.calls
  return calls[calls.length - 1][0]
}

describe('Detail sheet (records)', () => {
  it('saves notes via onSaveNotes and shows the saved state', async () => {
    const onSaveNotes = vi.fn().mockResolvedValue()
    renderDetail(RECORD, { onSaveNotes })

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(saveBtn).toBeDisabled() // nothing to save yet

    fireEvent.change(screen.getByPlaceholderText(/Condition/), { target: { value: 'Original pressing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveNotes).toHaveBeenCalledWith('Original pressing'))
    expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeInTheDocument()
  })

  it('asks for confirmation before removing, then deletes', () => {
    const onDelete = vi.fn()
    renderDetail(RECORD, { onDelete })

    fireEvent.click(screen.getByRole('button', { name: 'Remove from crate' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm remove?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove?' }))
    expect(onDelete).toHaveBeenCalledWith('r1')
  })

  it('shows the external Discogs link for items with an id', () => {
    renderDetail(RECORD)

    const link = screen.getByRole('link', { name: 'View on Discogs ↗' })
    expect(link).toHaveAttribute('href', 'https://www.discogs.com/release/101')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('omits the external link for manually added items', () => {
    renderDetail({ ...RECORD, discogsId: null })
    expect(screen.queryByRole('link', { name: /View on Discogs/ })).not.toBeInTheDocument()
  })

  it('mounts the community reviews section routed through catalog.reviewKey', () => {
    renderDetail(RECORD)
    const props = lastReviewsProps()
    expect(props.kind).toBe('records')
    expect(props.sourceId).toBe(101) // recordsCatalog.reviewKey(item) === item.discogsId
    expect(props.catalog).toBe(recordsCatalog)
  })

  it('passes a null thread id for manually added records (no provider id)', () => {
    renderDetail({ ...RECORD, discogsId: null })
    // reviewKey returns null for a record without an id — ReviewsSection
    // renders nothing in that case.
    expect(lastReviewsProps().sourceId).toBeNull()
  })

  it('routes the review thread through a catalog reviewKey override', () => {
    const customCatalog = { ...recordsCatalog, reviewKey: (it) => `custom-${it.discogsId}` }
    renderDetail(RECORD, { catalog: customCatalog })
    expect(lastReviewsProps().sourceId).toBe('custom-101')
  })

  it('falls back to the provider id when reviewKey is missing', () => {
    const bareCatalog = { ...recordsCatalog }
    delete bareCatalog.reviewKey
    renderDetail(RECORD, { catalog: bareCatalog })
    expect(lastReviewsProps().sourceId).toBe(101)
  })

  it('forwards showToast to the reviews section', () => {
    const showToast = vi.fn()
    renderDetail(RECORD, { showToast })
    expect(lastReviewsProps().showToast).toBe(showToast)
  })

  it('renders the community rating row when the item has one', () => {
    renderDetail({ ...RECORD, rating: 4.5, ratingCount: 128 })
    expect(screen.getByText('Community rating')).toBeInTheDocument()
    expect(screen.getByText('4.5')).toBeInTheDocument()
    expect(screen.getByText('128 ratings')).toBeInTheDocument()
  })

  it('renders nothing when the item has no rating (dark-screen safety)', () => {
    renderDetail(RECORD) // no rating fields
    expect(screen.queryByText('Community rating')).not.toBeInTheDocument()

    // Weird shapes must never crash or render a phantom row.
    renderDetail({ ...RECORD, rating: null, ratingCount: undefined })
    expect(screen.queryByText('Community rating')).not.toBeInTheDocument()
    renderDetail({ ...RECORD, rating: 0, ratingCount: 0 })
    expect(screen.queryByText('Community rating')).not.toBeInTheDocument()
  })
})

describe('Detail sheet (books)', () => {
  const BOOK = {
    id: 'b1',
    title: 'Ursula K. Le Guin - A Wizard of Earthsea',
    year: 1968,
    label: 'Parnassus Press',
    googleBooksId: 'abc123',
    infoLink: 'https://books.google.com/books?id=abc123',
    description: 'First Earthsea novel',
    notes: '',
  }

  it('shows a Google Books link for items with an id and none for manual items', () => {
    const { unmount } = render(
      <BookDetail item={BOOK} catalog={booksCatalog} onClose={() => {}} onDelete={() => {}} onSaveNotes={() => {}} />
    )
    expect(screen.getByRole('link', { name: 'View on Google Books ↗' })).toBeInTheDocument()
    unmount()

    render(
      <BookDetail
        item={{ id: 'b2', title: 'Manual - Book', googleBooksId: null, infoLink: '', notes: '' }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
      />
    )
    expect(screen.queryByRole('link', { name: /View on Google Books/ })).not.toBeInTheDocument()
  })

  it('saves notes via onSaveNotes', async () => {
    const onSaveNotes = vi.fn().mockResolvedValue()
    render(
      <BookDetail
        item={{ id: 'b2', title: 'Manual - Book', notes: '' }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={onSaveNotes}
      />
    )

    fireEvent.change(screen.getByPlaceholderText(/Condition/), { target: { value: 'Signed copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveNotes).toHaveBeenCalledWith('Signed copy'))
  })

  it('renders the community rating row when the item has one', () => {
    render(
      <BookDetail
        item={{ ...BOOK, rating: 4.1, ratingCount: 96 }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
      />
    )
    expect(screen.getByText('Community rating')).toBeInTheDocument()
    expect(screen.getByText('4.1')).toBeInTheDocument()
    expect(screen.getByText('96 ratings')).toBeInTheDocument()
  })

  it('omits the rating row for books without a rating', () => {
    render(
      <BookDetail item={BOOK} catalog={booksCatalog} onClose={() => {}} onDelete={() => {}} onSaveNotes={() => {}} />
    )
    expect(screen.queryByText('Community rating')).not.toBeInTheDocument()
  })

  it('mounts the community reviews section routed through catalog.reviewKey for books', () => {
    render(
      <BookDetail item={BOOK} catalog={booksCatalog} onClose={() => {}} onDelete={() => {}} onSaveNotes={() => {}} />
    )
    const props = lastReviewsProps()
    expect(props.kind).toBe('books')
    expect(props.sourceId).toBe('abc123') // booksCatalog.reviewKey(item) === item.googleBooksId
    expect(props.catalog).toBe(booksCatalog)
  })

  it('passes a null thread id for manually added books (no provider id)', () => {
    render(
      <BookDetail
        item={{ id: 'b2', title: 'Manual - Book', googleBooksId: null, infoLink: '', notes: '' }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
      />
    )
    expect(lastReviewsProps().sourceId).toBeNull()
  })

  // A5.6 (#117) deep-link on BOOKS — the parallel path to AlbumDetail's,
  // which the grid-lending-badge integration tests only exercise for records.
  // The book card's loan icon deep-links straight to the lend card, so the
  // BookDetail scroll+focus effect must move focus into the lending section
  // (not the close button) and never throw (no error boundary).
  it('deep-links a loaned book to the lend card: focuses the lending section', () => {
    // Fire the rAF the deep-link effect uses synchronously so the focus
    // assertion is deterministic (same pattern as loans-dashboard.test).
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { container } = render(
      <BookDetail
        item={{
          id: 'b1',
          title: 'Ursula K. Le Guin - A Wizard of Earthsea',
          lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z' },
        }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
        lendingEnabled
        focusSection="lending"
      />,
    )
    const section = container.querySelector('.lending')
    expect(section).toBeInTheDocument()
    // The deep-link moves focus to the lending section, not the close button.
    expect(section).toHaveFocus()
    expect(container.querySelector('.sheet-close')).not.toHaveFocus()
  })

  it('falls back to the close-button focus when the lending section is absent (A5.6 dark-screen safety)', () => {
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { container } = render(
      <BookDetail
        item={{ id: 'b2', title: 'Manual - Book', notes: '' }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
        // lendingEnabled is false → LendingControls renders nothing, so the
        // deep-link must be a safe no-op and the sheet opens focused normally.
        focusSection="lending"
      />,
    )
    expect(container.querySelector('.lending')).toBeNull()
    expect(container.querySelector('.sheet-close')).toHaveFocus()
  })
})
