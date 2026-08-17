import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { saveSession } from '../utils/session'
import { submitFeedback } from '../api/feedback'

// Mock the feedback client so the App-level flow never hits the network.
vi.mock('../api/feedback', () => ({
  submitFeedback: vi.fn(),
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
  submitFeedback.mockResolvedValue({ id: '12345678-abcd-4000-8000-000000000000', type: 'suggestion', status: 'open' })
})

describe('Feedback from Settings (feat/feedback #82, epic #74)', () => {
  it('opens the feedback modal from Settings and shows a reference id after submit', async () => {
    mockSignedIn(MEMBER)
    render(<App />)

    // Account menu → Settings.
    const avatar = await screen.findByRole('button', { name: 'Account: Ada' })
    fireEvent.click(avatar)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()

    // Tap the Feedback card → the sheet swaps to the feedback form.
    fireEvent.click(screen.getByRole('button', { name: /Feedback/ }))
    expect(await screen.findByRole('dialog', { name: 'Feedback' })).toBeInTheDocument()

    // Type a suggestion and submit → confirmation with the reference id.
    const textarea = screen.getByLabelText(/your message/i)
    fireEvent.change(textarea, { target: { value: 'Love the crate view — could we get a light theme?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(await screen.findByText('#fb-12345678')).toBeInTheDocument()
    expect(submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'suggestion', message: 'Love the crate view — could we get a light theme?' })
    )
  })
})
