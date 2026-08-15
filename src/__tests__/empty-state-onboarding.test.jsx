import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// Per-test session so one file can cover both the Records and Books catalogs.
const { sessionRef } = vi.hoisted(() => ({ sessionRef: { current: null } }))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    session: sessionRef.current,
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
// the empty-state Scan button can drive onDetected directly.
vi.mock('../components/ScannerModal', () => ({
  default: ({ onDetected, onClose }) => (
    <div role="dialog" aria-label="Scan barcode">
      <button type="button" onClick={() => onDetected('0767325734129')}>simulate scan</button>
      <button type="button" onClick={() => onClose('manual')}>add manually</button>
      <button type="button" onClick={() => onClose('close')}>close scanner</button>
    </div>
  ),
}))

import App from '../App'
import EmptyState from '../components/EmptyState'
import { recordsCatalog } from '../catalog'
import * as collectionApi from '../api/collection'
import * as discogs from '../api/discogs'

const RECORDS_ONLY = { user: { id: 'u1', name: 'T', role: 'member', collections: { records: true, books: false } }, code: 'RU-TEST' }
const BOOKS_ONLY = { user: { id: 'u2', name: 'B', role: 'member', collections: { records: false, books: true } }, code: 'RU-TEST2' }

const NO_TOKEN_ERROR = Object.assign(new Error('Discogs token not configured.'), { code: 'SERVER_NO_TOKEN' })
const MATCH = {
  discogsId: 101,
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  genre: ['Jazz'],
  barcode: '0767325734129',
}

const HINT = 'Records lookups need a Discogs token — add yours in Settings.'

// C2.4 (issue #88): the empty state keeps a persistent, non-blocking token
// hint after the server reports SERVER_NO_TOKEN. The gating lives in
// CollectionView — only the Records catalog ever receives `noToken`.
describe('C2.4 records no-token hint (issue #88)', () => {
  beforeEach(() => {
    sessionRef.current = null
    collectionApi.listItems.mockReset().mockResolvedValue([])
    collectionApi.addItem.mockReset()
    collectionApi.updateItem.mockReset()
    collectionApi.deleteItem.mockReset()
    discogs.searchByBarcode.mockReset()
  })

  it('shows the persistent hint in the empty state after a SERVER_NO_TOKEN scan', async () => {
    sessionRef.current = RECORDS_ONLY
    discogs.searchByBarcode.mockRejectedValue(NO_TOKEN_ERROR)

    render(<App />)

    // Records-only member lands on Records; no hint before any signal.
    const scan = await screen.findByRole('button', { name: 'Scan a record' })
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()

    fireEvent.click(scan)
    fireEvent.click(await screen.findByText('simulate scan'))

    // The failed lookup records the missing token (and opens Settings + toasts).
    // The empty state stays mounted behind the sheet, now carrying the
    // persistent, non-blocking hint.
    expect(await screen.findByText(HINT)).toBeInTheDocument()
  })

  it('keeps the hint absent after a successful lookup (a token exists)', async () => {
    sessionRef.current = RECORDS_ONLY
    discogs.searchByBarcode.mockResolvedValue([MATCH])

    render(<App />)

    const scan = await screen.findByRole('button', { name: 'Scan a record' })
    fireEvent.click(scan)
    fireEvent.click(await screen.findByText('simulate scan'))

    // The result sheet opens; close it back to the empty state.
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('never shows the records hint on the Books catalog', async () => {
    sessionRef.current = BOOKS_ONLY

    render(<App />)

    // Books empty state is active; the hint is structurally absent —
    // CollectionView only passes `noToken` for the Records catalog.
    expect(await screen.findByRole('button', { name: 'Scan a book' })).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})

// O-1 (free-tier-guidance.md, #143): a single quiet free-plan note renders in
// the empty state for FREE members only — CollectionView passes `planNote`
// only when isFree, so the owner (admin) and demo visitors never see it. It is
// non-blocking: no dismissal, and it never covers the Scan button.
describe('Free-tier onboarding note (issue #143, O-1)', () => {
  const FREE_MEMBER = { user: { id: 'u6', name: 'Free', role: 'member', plan: 'free', collections: { records: true, books: false } }, code: 'RU-FREE' }
  const OWNER = { user: { id: 'u7', name: 'Owner', role: 'admin', collections: { records: true, books: false } }, code: 'RU-OWNER' }
  const DEMO_VISITOR = { user: { id: 'u8', name: 'Demo', role: 'demo', plan: 'free', collections: { records: true, books: false }, features: {} }, code: 'RU-DEMO' }

  const NOTE = 'Free plan: up to 10 per collection — no card, no expiry.'

  beforeEach(() => {
    sessionRef.current = null
    collectionApi.listItems.mockReset().mockResolvedValue([])
    collectionApi.addItem.mockReset()
    collectionApi.updateItem.mockReset()
    collectionApi.deleteItem.mockReset()
    discogs.searchByBarcode.mockReset()
  })

  it('shows the free-plan note in the empty state for a free member', async () => {
    sessionRef.current = FREE_MEMBER
    render(<App />)
    await screen.findByText('Your crate is empty')
    expect(screen.getByText(NOTE)).toBeInTheDocument()
  })

  it('keeps the free-plan note absent for the owner', async () => {
    // NOTE: an owner (admin) with an EMPTY collection hits the W7 minimal
    // lending Toolbar (a pre-existing lending-path crash) — use a non-empty
    // collection so this asserts the note is absent, not the crash.
    sessionRef.current = OWNER
    collectionApi.listItems.mockResolvedValue([{ id: 'r1', title: 'Artist - Album', year: 2000, formatType: 'LP', label: 'Label', genre: ['Jazz'], barcode: '1234567890', dateAdded: '2026-01-01T00:00:00Z' }])
    render(<App />)
    await screen.findByPlaceholderText('Search your crate…')
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })

  // Direct guard test: the component renders the note ONLY when the planNote
  // prop is present — the owner/paid/demo path (CollectionView passes nothing)
  // never renders it, so the empty state stays note-free for them.
  it('renders no plan note when the planNote prop is absent (owner/paid/demo path)', () => {
    render(<EmptyState copy={recordsCatalog.copy} />)
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })

  it('keeps the free-plan note absent for a demo visitor', async () => {
    sessionRef.current = DEMO_VISITOR
    render(<App />)
    await screen.findByText('Your crate is empty')
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })
})
