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
// the scan-to-add flow can drive onDetected directly. `data-active` mirrors
// the real component's `active` prop (C1.3 warm camera) for keep-mounted
// assertions: the same node flips true/false instead of remounting.
vi.mock('../components/ScannerModal', () => ({
  default: ({ onDetected, onClose, active = true }) => (
    <div role="dialog" aria-label="Scan barcode" data-active={String(active)}>
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

    // The scan-result sheet appears with the looked-up record. The primary is
    // "Add & scan next" (C1.1); the plain "Add" demotes to a ghost.
    expect(await screen.findByRole('button', { name: 'Add & scan next' })).toBeInTheDocument()
    expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to crate' }).className).toContain('btn-ghost')

    // Add (the demoted plain add) → the ~0.8s busy state → persisted via the
    // collection API.
    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })
    expect(collectionApi.addItem.mock.calls[0][0]).toMatchObject({
      title: 'Miles Davis - Kind of Blue',
      barcode: '0767325734129',
    })

    // The momentum toast announces the add with the per-session count (C1.4).
    expect(await screen.findByText('Added — 1 today')).toBeInTheDocument()
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

  it('"Add & scan next" persists the add and re-opens the warm scanner (C1.1 + C1.3)', async () => {
    collectionApi.listItems.mockResolvedValue([EXISTING])
    collectionApi.addItem.mockImplementation(async (item) => ({ ...item, id: 'new1' }))
    discogs.searchByBarcode.mockResolvedValue([KIND_OF_BLUE])

    render(<App />)

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    // C1.3: the scanner stays MOUNTED (hidden, camera-off) while the result
    // sheet is up — capture the node so we can prove it isn't remounted.
    // (There is a brief 'pick' loading step between detect and result where the
    // scanner unmounts — wait for the result sheet first.)
    await screen.findByRole('button', { name: 'Add & scan next' })
    const scanner = screen.getByRole('dialog', { name: 'Scan barcode' })
    expect(scanner.getAttribute('data-active')).toBe('false')

    fireEvent.click(await screen.findByRole('button', { name: 'Add & scan next' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })

    // The SAME mounted node flips back to active — no remount / getUserMedia
    // churn — and the result sheet is gone.
    await waitFor(() => expect(scanner.getAttribute('data-active')).toBe('true'))
    expect(screen.queryByRole('button', { name: 'Add & scan next' })).not.toBeInTheDocument()
    expect(await screen.findByText('Added — 1 today')).toBeInTheDocument()
  })

  it('increments the per-session "added today" count across the scan loop (C1.4)', async () => {
    collectionApi.listItems.mockResolvedValue([EXISTING])
    collectionApi.addItem.mockImplementation(async (item) => ({ ...item, id: 'new1' }))
    discogs.searchByBarcode.mockResolvedValue([KIND_OF_BLUE])
    // restoreAllMocks() doesn't clear vi.fn() call history, and this file's
    // earlier tests already called addItem — reset so the counts are per-test.
    collectionApi.addItem.mockClear()

    render(<App />)

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))

    // First scan → add & scan next → "1 today".
    fireEvent.click(await screen.findByText('simulate scan'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add & scan next' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(await screen.findByText('Added — 1 today')).toBeInTheDocument()

    // Warm scanner is active again. The same barcode is now OWNED, so the
    // result shows C1.2's owned layout — "Add anyway" ghost still counts
    // toward the session → "2 today".
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Scan barcode' }).getAttribute('data-active')).toBe('true'))
    fireEvent.click(screen.getByText('simulate scan'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(await screen.findByText('Added — 2 today')).toBeInTheDocument()
  })

  it('keeps the plain add toast (no momentum count) for a manual add', async () => {
    collectionApi.listItems.mockResolvedValue([EXISTING])
    collectionApi.addItem.mockImplementation(async (item) => ({ ...item, id: 'new1' }))

    render(<App />)

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('add manually'))

    // Manual entry → candidate is NOT scan-sourced → plain "Add" primary.
    fireEvent.click(screen.getByText('Skip search — add it by hand'))
    fireEvent.change(screen.getByLabelText('Title is required'), { target: { value: 'Kind of Blue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))

    expect(await screen.findByRole('button', { name: 'Add to crate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add & scan next' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })
    expect(await screen.findByText('Added to your crate')).toBeInTheDocument()
    expect(screen.queryByText(/Added — \d+ today/)).not.toBeInTheDocument()
  })
})
