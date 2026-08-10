import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.queryByLabelText('Admin panel')).not.toBeInTheDocument()
  })

  it('hides collections the member is not entitled to', async () => {
    mockSignedIn({ id: 'u2', name: 'Bob', role: 'member', collections: { records: false, books: true } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Books' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Records' })).not.toBeInTheDocument()
  })

  it('shows the admin panel button only for the admin', async () => {
    mockSignedIn({ id: 'owner', name: 'Admin', role: 'admin', collections: { records: true, books: true } })
    render(<App />)
    expect(await screen.findByLabelText('Admin panel')).toBeInTheDocument()
    expect(screen.getByLabelText(/Sign out Admin/)).toBeInTheDocument()
  })

  it('shows a friendly message when a signed-in user has no collections', async () => {
    mockSignedIn({ id: 'u3', name: 'Noop', role: 'member', collections: { records: false, books: false } })
    render(<App />)
    expect(await screen.findByText(/doesn't include any collections yet/)).toBeInTheDocument()
  })
})
