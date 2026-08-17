import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import FeedbackModal from './FeedbackModal'
import * as feedbackApi from '../api/feedback'

// Mock the client so no network is hit (testing skill: component tests mock the
// api module, not fetch).
vi.mock('../api/feedback', () => ({
  submitFeedback: vi.fn(),
}))

const CREATED = { id: 'c3f9a2b1-0000-4000-8000-000000000000', type: 'bug', status: 'open' }

function typeMessage(text) {
  fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: text } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  feedbackApi.submitFeedback.mockResolvedValue(CREATED)
})

describe('FeedbackModal — member-facing form (feat/feedback #82, epic #74)', () => {
  it('renders as a bottom-sheet dialog with the feedback title', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Feedback')
    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeInTheDocument()
  })

  it('defaults the type toggle to Suggestion', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Suggestion' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Report a problem' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('preselects "Report a problem" when opened with initialType="bug" — the ErrorBoundary path', () => {
    render(<FeedbackModal onClose={vi.fn()} initialType="bug" />)

    expect(screen.getByRole('button', { name: 'Report a problem' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Suggestion' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches the toggle when the other segment is tapped', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(screen.getByRole('button', { name: 'Report a problem' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Suggestion' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders all localized category chips', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    for (const name of ['Records', 'Books', 'Scanner', 'Account', 'Billing', 'Games', 'Lending', 'Other']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('toggles a category chip off when tapped again', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    const chip = screen.getByRole('button', { name: 'Scanner' })
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a live character counter as the user types', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    expect(screen.getByText('0 / 4000')).toBeInTheDocument()
    typeMessage('hello')
    expect(screen.getByText('5 / 4000')).toBeInTheDocument()
  })

  it('clamps the message to the 4000-char cap even when a huge value is set', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    typeMessage('x'.repeat(5000))
    expect(screen.getByText('4000 / 4000')).toBeInTheDocument()
    expect(screen.getByLabelText(/your message/i).value).toHaveLength(4000)
  })

  it('keeps submit disabled until there is a non-empty message', () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
    typeMessage('   ')
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
    typeMessage('hi')
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
  })

  it('submits and shows the reference id on success', async () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    typeMessage('The scanner froze on iOS.')
    submit()

    expect(await screen.findByText('#fb-c3f9a2b1')).toBeInTheDocument()
    expect(screen.getByText(/Thanks — we got it/)).toBeInTheDocument()
    expect(feedbackApi.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'suggestion', category: 'other', message: 'The scanner froze on iOS.' })
    )
  })

  it('sends the picked type and category with the submit', async () => {
    render(<FeedbackModal onClose={vi.fn()} initialType="bug" />)

    fireEvent.click(screen.getByRole('button', { name: 'Scanner' }))
    typeMessage('scan broken')
    submit()

    await screen.findByText('#fb-c3f9a2b1')
    expect(feedbackApi.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bug', category: 'scanner' })
    )
  })

  it('includes the route and app version by default (auto-context pre-checked)', async () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    typeMessage('hi')
    submit()

    await screen.findByText('#fb-c3f9a2b1')
    const payload = feedbackApi.submitFeedback.mock.calls[0][0]
    expect(payload.url).toBeTruthy()
    expect(payload.appVersion).toBe('0.1.0')
  })

  it('omits the auto-context when the checkbox is unchecked', async () => {
    render(<FeedbackModal onClose={vi.fn()} />)

    const checkbox = screen.getByRole('checkbox', { name: /include app info/i })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    typeMessage('hi')
    submit()

    await screen.findByText('#fb-c3f9a2b1')
    const payload = feedbackApi.submitFeedback.mock.calls[0][0]
    expect(payload.url).toBeUndefined()
    expect(payload.appVersion).toBeUndefined()
  })

  it('shows a friendly error and keeps the form for a retry on a coded failure', async () => {
    const err = new Error('Too many submissions')
    err.code = 'RATE_LIMITED'
    feedbackApi.submitFeedback.mockRejectedValue(err)
    render(<FeedbackModal onClose={vi.fn()} />)

    typeMessage('hi')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/sent a lot recently/)
    // The form is still up, submit re-enabled — nothing was confirmed.
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
    expect(screen.queryByText('#fb-')).not.toBeInTheDocument()
  })

  it('maps a NO_TOKEN failure to the friendly sign-in line', async () => {
    const err = new Error('Sign in to send feedback.')
    err.code = 'NO_TOKEN'
    feedbackApi.submitFeedback.mockRejectedValue(err)
    render(<FeedbackModal onClose={vi.fn()} />)

    typeMessage('hi')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Sign in to send feedback/)
  })

  it('degrades to generic copy for an unknown failure (never throws uncaught)', async () => {
    feedbackApi.submitFeedback.mockRejectedValue(new Error('boom'))
    render(<FeedbackModal onClose={vi.fn()} />)

    typeMessage('hi')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/check your connection/)
  })

  it('closes via the close button from both the form and the confirmation state', async () => {
    const onClose = vi.fn()
    render(<FeedbackModal onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    // After a successful submit, the Done button also closes.
    typeMessage('done here')
    submit()
    const done = await screen.findByRole('button', { name: 'Done' })
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
