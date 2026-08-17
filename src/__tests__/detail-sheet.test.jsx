import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AlbumDetail from '../components/AlbumDetail'
import BookDetail from '../components/BookDetail'
import ReviewsSection from '../components/ReviewsSection'
import { booksCatalog, recordsCatalog } from '../catalog'
import * as discogsApi from '../api/discogs'
import * as booksApi from '../api/books'
import * as collectionApi from '../api/collection'

// AlbumDetail fetches a tracklist for items with a discogsId — stub it out.
vi.mock('../api/discogs', () => ({
  getReleaseDetail: vi.fn().mockResolvedValue({ tracklist: [] }),
}))

// (FEAT-EPIC-5, #276) BookDetail fetches the volume detail to backfill the
// Phase-A enrichment fields — stub the books API so mount tests stay hermetic.
vi.mock('../api/books', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getBookDetail: vi.fn(),
}))

// (FEAT-EPIC-5, #276) The detail sheets persist enrichment backfills through
// the collection PUT — stub it so merge tests can assert the write without
// hitting the network.
vi.mock('../api/collection', () => ({
  updateItem: vi.fn(),
}))

// (FEAT-EPIC-5, #276) Safe defaults for the detail-fetch + enrichment mocks,
// reset per test so a mockResolvedValue override never leaks across tests.
beforeEach(() => {
  discogsApi.getReleaseDetail.mockReset().mockResolvedValue({ tracklist: [] })
  booksApi.getBookDetail.mockReset().mockResolvedValue({})
  collectionApi.updateItem.mockReset().mockResolvedValue({})
})

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

  // (FEAT-EPIC-5, #276) Phase A blob enrichment: after the release-detail
  // fetch resolves, changed content-bearing fields are PUT back onto the
  // stored item — the lazy, self-healing backfill.
  it('merges release enrichment fields onto the stored item (FEAT-EPIC-5 #276)', async () => {
    const detail = {
      artists: [{ id: 9, name: 'Miles Davis', role: 'Main' }],
      masterId: 201,
      tracklist: [{ position: 'A1', title: 'So What', duration: '9:22' }],
      released: '1959-08-17',
    }
    discogsApi.getReleaseDetail.mockResolvedValue(detail)
    const { unmount } = renderDetail(RECORD)
    await waitFor(() => expect(collectionApi.updateItem).toHaveBeenCalled())
    expect(collectionApi.updateItem).toHaveBeenCalledWith('r1', detail, 'records')
    unmount()
  })

  it('does not PUT enrichment when the item already carries the same fields (FEAT-EPIC-5 #276)', async () => {
    const detail = {
      artists: [{ id: 9, name: 'Miles Davis' }],
      masterId: 201,
      tracklist: [{ position: 'A1', title: 'So What' }],
      released: '1959-08-17',
    }
    discogsApi.getReleaseDetail.mockResolvedValue(detail)
    renderDetail({ ...RECORD, ...detail })
    // Let the detail fetch resolve + the merge settle.
    await waitFor(() => expect(discogsApi.getReleaseDetail).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(collectionApi.updateItem).not.toHaveBeenCalled()
  })

  it('swallows a failed enrichment PUT — the sheet stays interactive (FEAT-EPIC-5 #276)', async () => {
    discogsApi.getReleaseDetail.mockResolvedValue({
      artists: [{ id: 9, name: 'Miles Davis' }],
      masterId: 201,
      tracklist: [{ position: 'A1', title: 'So What' }],
      released: '1959-08-17',
    })
    collectionApi.updateItem.mockRejectedValue(new Error('offline'))
    const { unmount } = renderDetail(RECORD)
    await waitFor(() => expect(collectionApi.updateItem).toHaveBeenCalled())
    // The rejected PUT was swallowed — the sheet is still mounted.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    unmount()
  })

  // (FEAT-EPIC-5, #276) F1: a detail with masterId: 0 must not send masterId
  // in the PUT (the server validator rejects 0 and would drop the whole
  // backfill); the sheet stays interactive.
  it('does not PUT masterId when the detail reports masterId 0 (F1)', async () => {
    discogsApi.getReleaseDetail.mockResolvedValue({
      artists: [{ id: 9, name: 'Miles Davis' }],
      masterId: 0,
      tracklist: [{ position: 'A1', title: 'So What' }],
      released: '1959-08-17',
    })
    const { unmount } = renderDetail(RECORD)
    await waitFor(() => expect(collectionApi.updateItem).toHaveBeenCalled())
    // masterId must not appear in the PUT payload (0 is the invalid seam).
    expect(collectionApi.updateItem).not.toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ masterId: 0 }),
      'records',
    )
    const payload = collectionApi.updateItem.mock.calls[0][1]
    expect(payload.masterId).toBeUndefined()
    // Enrichment still happens for the other fields, and the sheet is alive.
    expect(payload.artists).toEqual([{ id: 9, name: 'Miles Davis' }])
    expect(payload.tracklist).toEqual([{ position: 'A1', title: 'So What' }])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    unmount()
  })

  it('skips the enrichment merge for demo items (nothing is persisted) (FEAT-EPIC-5 #276)', async () => {
    discogsApi.getReleaseDetail.mockResolvedValue({
      artists: [{ id: 9, name: 'Miles Davis' }],
      masterId: 201,
      tracklist: [{ position: 'A1', title: 'So What' }],
      released: '1959-08-17',
    })
    renderDetail(RECORD, { isDemo: true })
    await waitFor(() => expect(discogsApi.getReleaseDetail).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(collectionApi.updateItem).not.toHaveBeenCalled()
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

  // (FEAT-EPIC-5, #276) Phase A blob enrichment: BookDetail backfills the
  // content-bearing fields through the collection PUT after the detail fetch.
  it('merges book enrichment fields onto the stored item (FEAT-EPIC-5 #276)', async () => {
    booksApi.getBookDetail.mockResolvedValue({
      description: 'Full desc',
      pageCount: 300,
      authorsList: [{ name: 'Ursula K. Le Guin' }],
      subtitle: 'A Wizard of Earthsea',
      series: 'Earthsea Cycle',
      mainCategory: 'Fantasy',
      snippet: 'A boy learns magic.',
    })
    const { unmount } = render(
      <BookDetail item={BOOK} catalog={booksCatalog} onClose={() => {}} onDelete={() => {}} onSaveNotes={() => {}} />
    )
    await waitFor(() => expect(collectionApi.updateItem).toHaveBeenCalled())
    expect(collectionApi.updateItem).toHaveBeenCalledWith('b1', {
      authorsList: [{ name: 'Ursula K. Le Guin' }],
      subtitle: 'A Wizard of Earthsea',
      series: 'Earthsea Cycle',
      mainCategory: 'Fantasy',
      snippet: 'A boy learns magic.',
    }, 'books')
    unmount()
  })

  it('does not fetch the volume detail when the book is already fully enriched (FEAT-EPIC-5 #276)', async () => {
    render(
      <BookDetail
        item={{
          ...BOOK,
          authorsList: [{ name: 'Ursula K. Le Guin' }],
          subtitle: 'A Wizard of Earthsea',
          series: 'Earthsea Cycle',
          mainCategory: 'Fantasy',
          snippet: 'A boy learns magic.',
        }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
      />
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(booksApi.getBookDetail).not.toHaveBeenCalled()
    expect(collectionApi.updateItem).not.toHaveBeenCalled()
  })

  it('swallows a failed book enrichment PUT — the sheet stays interactive (FEAT-EPIC-5 #276)', async () => {
    booksApi.getBookDetail.mockResolvedValue({
      authorsList: [{ name: 'Ursula K. Le Guin' }],
      subtitle: 'A Wizard of Earthsea',
      series: 'Earthsea Cycle',
      mainCategory: 'Fantasy',
      snippet: 'A boy learns magic.',
    })
    collectionApi.updateItem.mockRejectedValue(new Error('offline'))
    const { unmount } = render(
      <BookDetail item={BOOK} catalog={booksCatalog} onClose={() => {}} onDelete={() => {}} onSaveNotes={() => {}} />
    )
    await waitFor(() => expect(collectionApi.updateItem).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    unmount()
  })
})
