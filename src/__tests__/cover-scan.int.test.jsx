import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

// Records lookup mocked; getReleaseDetail is read by catalog.js at module load.
vi.mock('../api/discogs', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getReleaseDetail: vi.fn(),
}))

// CoverScanModal is lazy + camera-backed; stub it so onCaptured can be driven
// directly (the real camera can't run in jsdom). It mirrors the real modal's
// OCR state surface: busy → "Reading the cover…", busyError → the error, all
// while the modal stays mounted inside the cover flow.
vi.mock('../components/CoverScanModal', () => ({
  default: ({ onCaptured, onClose, busy, busyError }) => (
    <div role="dialog" aria-label="Scan a cover">
      {busy && <div role="status">Reading the cover…</div>}
      {busyError && <div role="alert">{busyError}</div>}
      <button type="button" onClick={() => onCaptured(new Blob(['cover'], { type: 'image/jpeg' }))}>simulate cover</button>
      <button type="button" onClick={() => onClose()}>close cover</button>
    </div>
  ),
}))

// The on-device Tesseract worker can't run in jsdom — stub recognizeImage and
// let the REAL extractSearchQuery turn our fake lines into query/barcode.
vi.mock('../utils/ocr', () => ({
  recognizeImage: vi.fn(),
}))

import * as api from '../api/collection'
import * as discogs from '../api/discogs'
import * as ocr from '../utils/ocr'

const EXISTING = { id: 'r0', title: 'Some Other - Album', year: 2001, formatType: 'LP', barcode: '1234567890123' }
const KIND_OF_BLUE = {
  discogsId: 101,
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  genre: ['Jazz'],
  barcode: '0767325734129',
}

// Build a fake Tesseract line; bbox area drives the ranking.
function line(text, { confidence = 85, area = 1000 } = {}) {
  const side = Math.sqrt(area)
  return { text, confidence, bbox: { x0: 0, y0: 0, x1: side, y1: side, width: side, height: side } }
}

beforeEach(() => {
  // setup.js's afterEach only restores spies — vi.fn() call history from a
  // previous test leaks otherwise (e.g. a barcode lookup would still "have
  // been called" in the no-search test). Clear history per test.
  vi.clearAllMocks()
  api.listItems.mockResolvedValue([EXISTING])
})

async function openCoverScan() {
  const fab = await screen.findByRole('button', { name: 'Scan' })
  fireEvent.click(fab)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Scan cover' }))
  fireEvent.click(await screen.findByText('simulate cover'))
}

describe('Cover-scan-to-add integration', () => {
  it('reads a barcode off the cover and looks it up by barcode', async () => {
    ocr.recognizeImage.mockResolvedValue({
      text: 'Kind of Blue\n0 76732-57341-2 9',
      lines: [line('Kind of Blue', { area: 3000 }), line('0 76732-57341-2 9', { area: 900 })],
    })
    discogs.searchByBarcode.mockResolvedValue([KIND_OF_BLUE])
    const onRequestSettings = vi.fn()

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={onRequestSettings} />)
    await openCoverScan()

    await waitFor(() => expect(discogs.searchByBarcode).toHaveBeenCalledWith('0767325734129'))
    expect(discogs.searchByText).not.toHaveBeenCalled()
    // One result lands straight on the result sheet.
    expect(await screen.findByRole('button', { name: 'Add to crate' })).toBeInTheDocument()
  })

  it('reads artist/title text and searches by text when no barcode shows', async () => {
    ocr.recognizeImage.mockResolvedValue({
      text: 'Miles Davis\nKind of Blue',
      lines: [line('Miles Davis', { area: 5000 }), line('Kind of Blue', { area: 3000 })],
    })
    discogs.searchByText.mockResolvedValue([KIND_OF_BLUE])

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={vi.fn()} />)
    await openCoverScan()

    await waitFor(() => expect(discogs.searchByText).toHaveBeenCalledWith('Miles Davis Kind of Blue'))
    expect(discogs.searchByBarcode).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Add to crate' })).toBeInTheDocument()
  })

  it('shows the no-match picker with a manual fallback when the search returns nothing', async () => {
    ocr.recognizeImage.mockResolvedValue({
      text: 'Obscure Artist\nObscure LP',
      lines: [line('Obscure Artist', { area: 5000 }), line('Obscure LP', { area: 3000 })],
    })
    discogs.searchByText.mockResolvedValue([])

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={vi.fn()} />)
    await openCoverScan()

    expect(await screen.findByRole('dialog', { name: 'Is this it?' })).toBeInTheDocument()
    expect(screen.getByText('No matches found on Discogs.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument()
  })

  it('opens settings and shows the token toast on SERVER_NO_TOKEN', async () => {
    ocr.recognizeImage.mockResolvedValue({
      text: 'Miles Davis\nKind of Blue',
      lines: [line('Miles Davis', { area: 5000 }), line('Kind of Blue', { area: 3000 })],
    })
    discogs.searchByText.mockRejectedValue({ code: 'SERVER_NO_TOKEN' })
    const onRequestSettings = vi.fn()

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={onRequestSettings} />)
    await openCoverScan()

    await waitFor(() => expect(onRequestSettings).toHaveBeenCalled())
    expect(await screen.findByText(/lookups aren't configured yet/)).toBeInTheDocument()
  })

  it('shows a friendly no-text error inside the cover flow and never searches an unreadable cover', async () => {
    ocr.recognizeImage.mockResolvedValue({
      text: '',
      lines: [line('© 2024 All Rights Reserved', { confidence: 40, area: 4000 })],
    })
    const onRequestSettings = vi.fn()

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={onRequestSettings} />)
    await openCoverScan()

    // The error surfaces INSIDE the still-open cover modal (with Retry / pick
    // a photo again), never a blank picker.
    expect(await screen.findByText(/Couldn't read the cover/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Is this it?' })).not.toBeInTheDocument()
    expect(discogs.searchByBarcode).not.toHaveBeenCalled()
    expect(discogs.searchByText).not.toHaveBeenCalled()
  })

  it('shows a Reading the cover… progress inside the modal while OCR runs, then resolves', async () => {
    let resolveOcr
    ocr.recognizeImage.mockReturnValue(new Promise((res) => { resolveOcr = res }))
    discogs.searchByText.mockResolvedValue([KIND_OF_BLUE])

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={vi.fn()} />)
    await openCoverScan()

    // Bug 3: the cover modal stays mounted on a visible progress, not a jump
    // to the picker with zero feedback.
    expect(await screen.findByText('Reading the cover…')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Is this it?' })).not.toBeInTheDocument()

    resolveOcr({
      text: 'Miles Davis\nKind of Blue',
      lines: [line('Miles Davis', { area: 5000 }), line('Kind of Blue', { area: 3000 })],
    })

    await waitFor(() => expect(discogs.searchByText).toHaveBeenCalledWith('Miles Davis Kind of Blue'))
    // Only once the result is known do we leave the cover modal.
    expect(await screen.findByRole('button', { name: 'Add to crate' })).toBeInTheDocument()
  })

  // #365 regression: an OCR_TIMEOUT (wedged worker / hung wasm init) must
  // surface the timed-out copy INSIDE the still-open cover flow (retry / pick
  // again), never a fatal crash or a silent spinner, and never fire a lookup.
  it('shows timed-out copy inside the cover flow when OCR rejects with OCR_TIMEOUT', async () => {
    ocr.recognizeImage.mockRejectedValue(Object.assign(new Error('OCR timed out'), { code: 'OCR_TIMEOUT' }))

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={vi.fn()} />)
    await openCoverScan()

    expect(await screen.findByText(/took too long/i)).toBeTruthy()
    // Stays in the cover flow (Retry / pick again), never a blank picker.
    expect(screen.queryByRole('dialog', { name: 'Is this it?' })).not.toBeInTheDocument()
    expect(discogs.searchByBarcode).not.toHaveBeenCalled()
    expect(discogs.searchByText).not.toHaveBeenCalled()
  })

  // #365 regression: a generic OCR failure (e.g. camera/encode error) surfaces
  // the general error copy and keeps the cover modal open with retry.
  it('shows general error copy inside the cover flow on a non-timeout OCR failure', async () => {
    ocr.recognizeImage.mockRejectedValue(new Error('Could not encode image'))

    render(<CollectionView catalog={recordsCatalog} onRequestSettings={vi.fn()} />)
    await openCoverScan()

    expect(await screen.findByText(/could not encode image/i)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Is this it?' })).not.toBeInTheDocument()
    expect(discogs.searchByBarcode).not.toHaveBeenCalled()
  })
})
