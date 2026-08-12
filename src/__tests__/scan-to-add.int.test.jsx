import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// Signed-in member so App renders the Records collection.
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', name: 'T', collections: { records: true }, role: 'user' }, code: 'RU-TEST' },
    ready: true,
    login: vi.fn(),
    logout: vi.fn(),
    requestAccess: vi.fn(),
    setSession: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// Collection API mocked so the real useCollection hook runs against it.
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

// The scanner decodes WASM camera frames — not runnable in jsdom. Stub it so
// the scan-to-add flow can drive onDetected directly.
vi.mock('../components/ScannerModal', () => ({
  default: ({ onDetected, onClose }) => (
    <div role="dialog" aria-label="Scan barcode">
      <button type="button" onClick={() => onDetected('0767325734129')}>simulate scan</button>
      <button type="button" onClick={() => onClose('manual')}>add manually</button>
    </div>
  ),
}))

import App from '../App'
import * as collectionApi from '../api/collection'
import * as discogs from '../api/discogs'

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

describe('Scan-to-add integration', () => {
  it('scans a barcode, shows the result, and adds it to the crate', async () => {
    collectionApi.listItems.mockResolvedValue([EXISTING])
    collectionApi.addItem.mockImplementation(async (item) => ({ ...item, id: 'new1' }))
    discogs.searchByBarcode.mockResolvedValue([KIND_OF_BLUE])

    render(<App />)

    // FAB → Scan barcode → stubbed scanner fires onDetected.
    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    // The scan-result sheet appears with the looked-up record.
    expect(await screen.findByRole('button', { name: 'Add to crate' })).toBeInTheDocument()
    expect(screen.getByText('Kind of Blue')).toBeInTheDocument()

    // Add → the ~0.8s busy state → persisted via the collection API.
    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })
    expect(collectionApi.addItem.mock.calls[0][0]).toMatchObject({
      title: 'Miles Davis - Kind of Blue',
      barcode: '0767325734129',
    })

    // The toast announces the add.
    expect(await screen.findByText('Added to your crate')).toBeInTheDocument()
  })

  it('falls back to manual entry from the scanner', async () => {
    collectionApi.listItems.mockResolvedValue([EXISTING])

    render(<App />)

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('add manually'))

    expect(await screen.findByRole('dialog', { name: 'Find a record' })).toBeInTheDocument()
  })
})
