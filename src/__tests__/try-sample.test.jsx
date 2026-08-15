import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import ScanResult from '../components/ScanResult'
import EmptyState from '../components/EmptyState'
import { recordsCatalog, booksCatalog } from '../catalog'
import { SAMPLE_RECORD } from '../utils/sample'

// Same CollectionView integration harness as the other collection tests — the
// real useCollection hook runs against a mocked collection API.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

// Lookup APIs mocked so we can PROVE the sample flow never touches them —
// a sample is fed directly into the result flow (no Discogs/Google Books
// call, no token, no network). getReleaseDetail/getBookDetail are read by
// catalog.js at module load, so the mocks must provide them.
vi.mock('../api/discogs', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getReleaseDetail: vi.fn(),
}))

vi.mock('../api/books', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getBookDetail: vi.fn(),
}))

import * as collectionApi from '../api/collection'
import * as discogs from '../api/discogs'
import * as books from '../api/books'

const SAMPLE_NOTE = 'This is a sample — add your own item to start your collection.'

function renderCatalog(catalog, props = {}) {
  return render(<CollectionView catalog={catalog} onRequestSettings={() => {}} {...props} />)
}

async function openSample(catalog) {
  // The collection starts in the loading state — wait for the empty state
  // (and its "Try a sample" ghost) before tapping it.
  fireEvent.click(await screen.findByRole('button', { name: 'Try a sample' }))
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  localStorage.removeItem('runout.view.books')
  collectionApi.listItems.mockReset().mockResolvedValue([])
  collectionApi.addItem.mockReset()
  collectionApi.updateItem.mockReset()
  collectionApi.deleteItem.mockReset()
  discogs.searchByBarcode.mockReset()
  discogs.searchByText.mockReset()
  discogs.getReleaseDetail.mockReset()
  books.searchByBarcode.mockReset()
  books.searchByText.mockReset()
  books.getBookDetail.mockReset()
})

// C2.3 (issue #85, epic #84): "Try a sample" — a curated item fed straight
// into the result flow so a brand-new user sees a full result sheet in ~10s
// without owning anything, scanning, or configuring a Discogs token.
describe('C2.3 try-a-sample (issue #85)', () => {
  it('renders the "Try a sample" ghost in the empty state for records', async () => {
    renderCatalog(recordsCatalog)
    expect(await screen.findByRole('button', { name: 'Try a sample' })).toBeInTheDocument()
  })

  it('renders the "Try a sample" ghost in the empty state for books', async () => {
    renderCatalog(booksCatalog)
    expect(await screen.findByRole('button', { name: 'Try a sample' })).toBeInTheDocument()
  })

  it('opens a full result sheet with the curated record (title/year/label/cover)', async () => {
    const { container } = renderCatalog(recordsCatalog)
    await openSample(recordsCatalog)

    // Curated item rendered through the normal result sheet.
    expect(await screen.findByText('The Dark Side of the Moon')).toBeInTheDocument()
    expect(screen.getByText('Pink Floyd')).toBeInTheDocument()
    expect(screen.getByText(/1973/)).toBeInTheDocument()
    expect(screen.getByText(/Harvest/)).toBeInTheDocument()
    // The cover img carries the curated artwork (alt is empty = decorative,
    // so assert via the DOM, not the role query).
    expect(container.querySelector('.result-cover img')).toHaveAttribute('src', SAMPLE_RECORD.coverImage)

    // On-brand "Sample" pill marks it read-only.
    expect(screen.getByText('Sample')).toBeInTheDocument()

    // No lookup was attempted (no network, no token needed).
    expect(discogs.searchByBarcode).not.toHaveBeenCalled()
    expect(discogs.searchByText).not.toHaveBeenCalled()
  })

  it('opens a full result sheet with the curated book', async () => {
    renderCatalog(booksCatalog)
    await openSample(booksCatalog)

    expect(await screen.findByText('1984')).toBeInTheDocument()
    expect(screen.getByText('George Orwell')).toBeInTheDocument()
    expect(screen.getByText(/1949/)).toBeInTheDocument()
    expect(screen.getByText(/Secker & Warburg/)).toBeInTheDocument()

    // No Google Books lookup was attempted.
    expect(books.searchByBarcode).not.toHaveBeenCalled()
    expect(books.searchByText).not.toHaveBeenCalled()
  })

  it('never persists a sample — the safe primary shows the note, never an add', async () => {
    renderCatalog(recordsCatalog)
    await openSample(recordsCatalog)

    // The sample note is surfaced on the sheet.
    expect(await screen.findByText(SAMPLE_NOTE)).toBeInTheDocument()

    // The primary is the safe "That's the idea" — no Add, no wishlist, no
    // "Add & scan next" (source is 'sample', not 'scan').
    expect(screen.getByRole('button', { name: "That's the idea" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to crate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add & scan next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to wishlist' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scan next' })).not.toBeInTheDocument()

    // Tapping the safe primary surfaces the note again as a toast and NEVER
    // touches the collection API (no add / update / delete).
    fireEvent.click(screen.getByRole('button', { name: "That's the idea" }))
    await waitFor(() => expect(screen.getAllByText(SAMPLE_NOTE).length).toBeGreaterThan(1), { timeout: 2000 })
    expect(collectionApi.addItem).not.toHaveBeenCalled()
    expect(collectionApi.updateItem).not.toHaveBeenCalled()
    expect(collectionApi.deleteItem).not.toHaveBeenCalled()
  })

  it('renders the records sample with no Discogs token and no lookup', async () => {
    // No session/token is set up at all — the sample still renders, because
    // it never calls the (token-requiring) Discogs proxy.
    renderCatalog(recordsCatalog)
    await openSample(recordsCatalog)

    expect(await screen.findByText('The Dark Side of the Moon')).toBeInTheDocument()
    expect(discogs.searchByBarcode).not.toHaveBeenCalled()
    expect(discogs.searchByText).not.toHaveBeenCalled()
  })

  it('renders without crashing when the copy shape is missing keys (no error boundary)', async () => {
    // A catalog/copy that lacks trySampleNote/badge/cta must fall back to the
    // i18n dictionary — never throw (an uncaught render error blanks the app).
    render(
      <ScanResult
        candidate={SAMPLE_RECORD}
        ownedExact={null}
        wishlistExact={null}
        sameAlbum={[]}
        otherArtist={[]}
        onAdd={vi.fn()}
        onAddToWishlist={vi.fn()}
        onOpenItem={vi.fn()}
        onScanNext={vi.fn()}
        onClose={vi.fn()}
        copy={{}}
        isSample
        onSampleNote={vi.fn()}
      />,
    )

    expect(screen.getByText('The Dark Side of the Moon')).toBeInTheDocument()
    expect(screen.getByText(SAMPLE_NOTE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "That's the idea" })).toBeInTheDocument()
  })

  it('renders the empty-state ghost via the i18n fallback when copy has no trySample', () => {
    // EmptyState with a copy that has no `trySample` still renders the ghost
    // (falls back to catalog.trySample) without throwing.
    render(<EmptyState copy={{}} onTrySample={() => {}} />)
    expect(screen.getByRole('button', { name: 'Try a sample' })).toBeInTheDocument()
  })
})
