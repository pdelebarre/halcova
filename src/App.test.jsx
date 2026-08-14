import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'
import { saveSession } from './utils/session'

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

const ITEM = { id: 'r1', title: 'Miles Davis - Kind of Blue', year: 1959, label: 'Columbia', genre: ['Jazz'], dateAdded: '2026-01-01T00:00:00Z' }

// Route mock fetches: /auth returns the user (session revalidation), /collection returns one item.
function mockSignedIn(user, code = 'RU-AAAA-BBBB-CCCC') {
  saveSession({ user, code })
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/functions/auth')) return Promise.resolve(res(200, { user }))
    if (String(url).includes('/functions/collection')) return Promise.resolve(res(200, { items: [ITEM] }))
    return Promise.resolve(res(404, { error: 'not found' }))
  })
}

describe('App auth gating', () => {
  beforeEach(() => {
    saveSession(null)
  })

  it('shows the sign-in screen when signed out', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'I have an access code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
  })

  it('shows both collections for a member with records + books', async () => {
    mockSignedIn({ id: 'u1', name: 'Ada', role: 'member', collections: { records: true, books: true } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Records' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Books' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin panel' })).not.toBeInTheDocument()
  })

  it('hides collections the member is not entitled to', async () => {
    mockSignedIn({ id: 'u2', name: 'Bob', role: 'member', collections: { records: false, books: true } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Books' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Records' })).not.toBeInTheDocument()
  })

  it('shows the admin panel entry only for the admin', async () => {
    mockSignedIn({ id: 'owner', name: 'Admin', role: 'admin', collections: { records: true, books: true } })
    render(<App />)

    const avatar = await screen.findByRole('button', { name: 'Account: Admin' })
    fireEvent.click(avatar)
    expect(screen.getByRole('menuitem', { name: 'Admin panel' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows a friendly message when a signed-in user has no collections', async () => {
    mockSignedIn({ id: 'u3', name: 'Noop', role: 'member', collections: { records: false, books: false } })
    render(<App />)
    expect(await screen.findByText(/doesn't include any collections yet/)).toBeInTheDocument()
  })

  // Gamification (Phase 1 § Play): the Play entry is a per-account entitlement
  // (`features.games`), admin-granted — not a compile-time flag.
  it('shows the Play entry for a member with the games entitlement', async () => {
    mockSignedIn({ id: 'u1', name: 'Ada', role: 'member', collections: { records: true, books: true }, features: { games: true } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('hides the Play entry without the games entitlement', async () => {
    // Has lending but NOT games — the Play surface must stay hidden.
    mockSignedIn({ id: 'u1', name: 'Ada', role: 'member', collections: { records: true, books: true }, features: { lending: true } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Records' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument()
  })
})
