import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Mutable user so each test can pick a plan/role. Held in vi.hoisted because
// the useAuth mock factory below is hoisted above module-level `let`s.
const { currentUser } = vi.hoisted(() => ({
  currentUser: {
    id: 'u1',
    name: 'Member',
    role: 'member',
    collections: { records: true, books: false },
    plan: 'free',
  },
}))

// Signed-in member so App renders the Records collection.
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    session: { user: currentUser, code: 'RU-TEST' },
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

vi.mock('../api/discogs', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getReleaseDetail: vi.fn(),
}))

// The scanner decodes WASM camera frames — not runnable in jsdom. Stub it so
// the scan-to-add flow can drive onDetected directly.
vi.mock('../components/ScannerModal', () => ({
  default: ({ onDetected }) => (
    <div role="dialog" aria-label="Scan barcode">
      <button type="button" onClick={() => onDetected('0767325734129')}>simulate scan</button>
    </div>
  ),
}))

import App from '../App'
import * as collectionApi from '../api/collection'
import * as discogs from '../api/discogs'

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    title: `Artist ${i} - Album ${i}`,
    year: 2000 + i,
    formatType: 'LP',
    label: 'Label',
    genre: ['Jazz'],
    barcode: `0000000000${i}`,
    dateAdded: '2026-01-01T00:00:00Z',
  }))
}

const KIND_OF_BLUE = {
  discogsId: 101,
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  genre: ['Jazz'],
  barcode: '0767325734129',
}

beforeEach(() => {
  currentUser.role = 'member'
  currentUser.plan = 'free'
})

describe('Free-tier UX', () => {
  it('shows the x / 10 counter for a free member', async () => {
    collectionApi.listItems.mockResolvedValue(makeItems(3))
    render(<App />)
    expect(await screen.findByText('3 of 10 items added')).toBeInTheDocument()
  })

  it('omits the counter for an unlimited member', async () => {
    currentUser.plan = 'unlimited'
    collectionApi.listItems.mockResolvedValue(makeItems(3))
    render(<App />)

    // The toolbar renders once the collection is loaded — if the counter were
    // shown it would sit right above it.
    await screen.findByPlaceholderText('Search your crate…')
    expect(screen.queryByText(/items added/)).not.toBeInTheDocument()
  })

  it('omits the counter for the owner (admin)', async () => {
    currentUser.role = 'admin'
    collectionApi.listItems.mockResolvedValue(makeItems(3))
    render(<App />)

    await screen.findByPlaceholderText('Search your crate…')
    expect(screen.queryByText(/items added/)).not.toBeInTheDocument()
  })

  it('disables the FAB add flow once a free member hits the cap', async () => {
    collectionApi.listItems.mockResolvedValue(makeItems(10))
    render(<App />)

    expect(await screen.findByText('10 of 10 items added')).toBeInTheDocument()
    expect(screen.getByText(/free-plan limit/)).toBeInTheDocument()

    const fab = screen.getByRole('button', { name: /Free plan full/ })
    fireEvent.click(fab)

    // No add menu opens; instead the S6 paywall bottom sheet appears (the old
    // "ask the admin" toast is replaced by the self-serve upgrade path, #57).
    expect(screen.queryByRole('menu', { name: 'Add options' })).not.toBeInTheDocument()
    const dialog = await screen.findByRole('dialog', { name: 'Your crate is full' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Maybe later' })).toBeInTheDocument()
  })

  it('shows the upgrade prompt when the server rejects an add with PLAN_LIMIT', async () => {
    collectionApi.listItems.mockResolvedValue(makeItems(5))
    collectionApi.addItem.mockRejectedValue(Object.assign(
      new Error("You've reached the free plan limit of 10 items. Ask the admin to upgrade your plan."),
      { code: 'PLAN_LIMIT' },
    ))
    discogs.searchByBarcode.mockResolvedValue([KIND_OF_BLUE])

    render(<App />)

    // FAB → Scan barcode → stubbed scanner fires onDetected.
    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    // Add → the server rejects with PLAN_LIMIT → the upgrade prompt appears.
    fireEvent.click(await screen.findByRole('button', { name: 'Add to crate' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })
    expect(await screen.findByText(/Free-plan limit reached/)).toBeInTheDocument()
  })
})
