import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { booksCatalog } from '../catalog'

// Same CollectionView harness as the other collection tests — the real
// useCollection hook runs against a mocked collection API.
vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

// Google Books lookup mocked; getBookDetail is read by catalog.js at load.
vi.mock('../api/books', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getBookDetail: vi.fn(),
}))

// The scanner decodes WASM camera frames — not runnable in jsdom. Stub it so
// the scan-to-add flow can drive onDetected directly.
vi.mock('../components/ScannerModal', () => ({
  default: ({ onDetected }) => (
    <div role="dialog" aria-label="Scan barcode">
      <button type="button" onClick={() => onDetected('9780140349434')}>simulate scan</button>
    </div>
  ),
}))

import * as collectionApi from '../api/collection'
import * as books from '../api/books'

const ISBN = '9780140349434'

// A legacy stored book with STRING year and empty-string pageCount — exactly
// the shape that used to 400 on "Add anyway".
const LEGACY_STORED = {
  id: 'b0',
  googleBooksId: 'vol1',
  title: 'Ursula K. Le Guin - A Wizard of Earthsea',
  year: '1968',
  pageCount: '',
  barcode: ISBN,
  dateAdded: '2024-01-01T00:00:00.000Z',
  notes: 'old note',
}

// A freshly looked-up book whose year/pageCount arrive as strings (the
// pre-fix normalizer shape) — proves the add POST still conforms.
const LOOKED_UP = {
  googleBooksId: 'vol1',
  title: 'Ursula K. Le Guin - A Wizard of Earthsea',
  year: '1968',
  pageCount: '205',
  barcode: ISBN,
}

function renderBooks() {
  return render(<CollectionView catalog={booksCatalog} onRequestSettings={() => {}} />)
}

beforeEach(() => {
  localStorage.removeItem('runout.view.books')
  localStorage.removeItem('runout.browse.books')
  collectionApi.listItems.mockReset().mockResolvedValue([])
  collectionApi.addItem.mockReset()
  collectionApi.updateItem.mockReset()
  collectionApi.deleteItem.mockReset()
  books.searchByBarcode.mockReset()
  books.searchByText.mockReset()
  books.getBookDetail.mockReset()
})

describe('Books scan-to-add — year/pageCount contract (#363)', () => {
  it('normalizes a brand-new scanned book\'s year/pageCount before the POST', async () => {
    collectionApi.addItem.mockImplementation(async (item) => ({ ...item, id: 'new1' }))
    books.searchByBarcode.mockResolvedValue([LOOKED_UP])

    renderBooks()

    // Empty shelf → the empty state's "Scan a book" opens the (stubbed) scanner.
    fireEvent.click(await screen.findByRole('button', { name: 'Scan a book' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    fireEvent.click(await screen.findByRole('button', { name: 'Add to shelf' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })

    expect(collectionApi.addItem.mock.calls[0][0]).toMatchObject({
      title: 'Ursula K. Le Guin - A Wizard of Earthsea',
      year: 1968,
      pageCount: 205,
      barcode: ISBN,
    })
  })

  it('still succeeds on "Add anyway" for a stored item carrying a string year', async () => {
    collectionApi.listItems.mockResolvedValue([LEGACY_STORED])
    collectionApi.addItem.mockImplementation(async (item) => ({ ...item, id: 'new2' }))

    renderBooks()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    fireEvent.click(await screen.findByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })

    const payload = collectionApi.addItem.mock.calls[0][0]
    expect(payload).toMatchObject({
      title: 'Ursula K. Le Guin - A Wizard of Earthsea',
      year: 1968,
      barcode: ISBN,
    })
    expect(payload.pageCount).toBeUndefined()
    expect(payload.id).toBeUndefined()
    expect(payload.dateAdded).toBeUndefined()
    expect(payload.notes).toBe('')
  })

  it('keeps client-side duplicate protection for an unconfirmed duplicate (no auto-add)', async () => {
    collectionApi.listItems.mockResolvedValue([LEGACY_STORED])

    renderBooks()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    // The owned banner + "Add anyway" are shown, but nothing is persisted
    // until the user explicitly confirms.
    expect(await screen.findByRole('button', { name: 'Add anyway' })).toBeInTheDocument()
    expect(screen.getByText('Already on your shelf')).toBeInTheDocument()
    expect(collectionApi.addItem).not.toHaveBeenCalled()
  })
})
