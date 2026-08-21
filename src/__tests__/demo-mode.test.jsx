import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// Demo visitor profile — mirrors the server's constant identity (ADR-0001):
// role 'demo', both collections, no features (no lending), read-only space.
const { DEMO_USER } = vi.hoisted(() => ({
  DEMO_USER: { id: 'demo', name: 'Demo', role: 'demo', collections: { records: true, books: true }, features: {} },
}))

// Stateful useAuth so "Leave demo" really signs out and App falls back to the
// auth screen. Async factory so the same React (useState) instance is used.
vi.mock('../hooks/useAuth', async () => {
  const { useState } = await import('react')
  return {
    useAuth: () => {
      const [session, setSession] = useState({ user: DEMO_USER, code: 'RUNOUT-DEMO-0000' })
      return {
        session,
        ready: true,
        login: vi.fn(async () => DEMO_USER),
        logout: vi.fn(() => setSession(null)),
        requestAccess: vi.fn(),
        setSession,
        refresh: vi.fn(),
      }
    },
  }
})

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

// M2 #320: default to Browse tab for collection-view tests
beforeEach(() => {
  localStorage.setItem('runout.navTab', 'browse')
})

vi.mock('../api/discogs', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getReleaseDetail: vi.fn(),
}))

// The scanner decodes WASM camera frames — not runnable in jsdom. Stub it so
// choosing "Scan barcode" from the FAB is safe (demo hides the FAB, but keep
// the module importable for the shared flow).
vi.mock('../components/ScannerModal', () => ({
  default: () => <div role="dialog" aria-label="Scan barcode">scanner stub</div>,
}))

import App from '../App'
import * as collectionApi from '../api/collection'

const ITEM = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  genre: ['Jazz'],
  barcode: '0767325734129',
  notes: 'Original pressing',
  dateAdded: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  collectionApi.listItems.mockResolvedValue([ITEM])
})

describe('Demo mode', () => {
  it('renders the read-only banner and hides every add flow for a demo visitor', async () => {
    render(<App />)

    expect(await screen.findByText(/read-only demo collection/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave demo' })).toBeInTheDocument()

    // No FAB, no add menu, no manual/scan entry points.
    expect(screen.queryByRole('button', { name: 'Scan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'Add options' })).not.toBeInTheDocument()
  })

  it('hides delete and makes notes read-only in the detail sheet', async () => {
    render(<App />)
    await screen.findByText(/read-only demo collection/)

    // Browsing still works: open the item's detail.
    fireEvent.click(screen.getByRole('button', { name: /Kind of Blue/ }))
    await screen.findByRole('dialog', { name: 'Kind of Blue' })

    // No delete / remove action in the demo.
    expect(screen.queryByRole('button', { name: /Remove from crate/ })).not.toBeInTheDocument()

    // Notes are read-only with a hint instead of a Save action.
    expect(screen.getByText('Notes are read-only in the demo.')).toBeInTheDocument()
    const notes = screen.getByPlaceholderText(/Condition/)
    expect(notes).toHaveAttribute('readonly')
    expect(notes).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('leaving the demo signs out and returns to the auth screen', async () => {
    render(<App />)
    await screen.findByText(/read-only demo collection/)

    fireEvent.click(screen.getByRole('button', { name: 'Leave demo' }))

    expect(await screen.findByRole('button', { name: 'I have an access code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try the free demo' })).toBeInTheDocument()
  })
})
