import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from '../App'
import { saveSession } from '../utils/session'
import { submitFeedback } from '../api/feedback'

// Mock the feedback client so the report path never hits the network.
vi.mock('../api/feedback', () => ({
  submitFeedback: vi.fn(),
}))

// Crash the subtree the ErrorBoundary wraps (CollectionView) so the crash card
// — and its "Report a problem" path — actually renders in a real App tree.
vi.mock('../CollectionView', () => ({
  default: function CollectionView() { throw new Error('render crash') },
}))

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

const MEMBER = { id: 'u1', name: 'Ada', role: 'member', collections: { records: true, books: true } }

function mockSignedIn(user) {
  saveSession({ user, code: 'RU-AAAA-BBBB-CCCC' })
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/functions/auth')) return Promise.resolve(res(200, { user }))
    if (u.includes('/functions/collection')) return Promise.resolve(res(200, { items: [] }))
    return Promise.resolve(res(404, { error: 'not found' }))
  })
}

beforeEach(() => {
  saveSession(null)
  vi.clearAllMocks()
  submitFeedback.mockResolvedValue({ id: '12345678-abcd-4000-8000-000000000000', type: 'bug', status: 'open' })
  // React logs caught boundary errors to console.error — silence it.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary crash card → "Report a problem" submits type=bug (feat/feedback #82, epic #74)', () => {
  it('reports a crash through the feedback sheet pre-filled as a bug', async () => {
    mockSignedIn(MEMBER)
    render(<App />)

    // The boundary swapped the crashed collection for the crash card (no dark
    // screen), and the old false "this error has been reported" copy is gone.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByText(/this error has been reported/i)).not.toBeInTheDocument()

    // "Report a problem" opens the feedback sheet pre-filled as a bug report.
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    const dialog = await screen.findByRole('dialog', { name: 'Feedback' })
    expect(within(dialog).getByRole('button', { name: 'Report a problem' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Suggestion' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: 'The records tab crashed on load.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    // The report is submitted as type=bug with a confirmation reference.
    expect(await screen.findByText('#fb-12345678')).toBeInTheDocument()
    expect(submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bug', message: 'The records tab crashed on load.' })
    )
  })
})
