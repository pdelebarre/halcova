import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPanel from '../AdminPanel'
import * as authApi from '../api/auth'
import * as feedbackApi from '../api/feedback'

// Component tests mock the api modules (testing skill), never the network.
vi.mock('../api/auth', () => ({
  adminList: vi.fn(),
  adminApprove: vi.fn(),
  adminReject: vi.fn(),
  adminUpdateUser: vi.fn(),
  adminDeleteUser: vi.fn(),
  adminRotate: vi.fn(),
}))

vi.mock('../api/feedback', () => ({
  listFeedback: vi.fn(),
  updateFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
}))

// Newest-first fixture — the server sorts by created_at DESC. `open` items
// drive the unread badge (SUGGESTION + BUG = 2).
const SUGGESTION = {
  id: 'fb-1',
  type: 'suggestion',
  category: 'records',
  message: 'Please add a search box for the crate.',
  authorName: 'Ada',
  url: '/crate',
  appVersion: '0.1.0',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  status: 'open',
  adminNote: '',
  createdAt: '2026-08-10T10:00:00Z',
}

const BUG = {
  id: 'fb-2',
  type: 'bug',
  category: 'scanner',
  message: 'The scanner crashes on dark records.',
  authorName: 'Bob',
  url: '/scan',
  appVersion: '0.1.0',
  userAgent: 'Mozilla/5.0 (Android 14)',
  status: 'open',
  adminNote: 'Reproduced locally.',
  createdAt: '2026-08-11T10:00:00Z',
}

const DONE = {
  id: 'fb-3',
  type: 'suggestion',
  category: 'other',
  message: 'Wishlist for rare pressings.',
  authorName: 'Cat',
  url: '',
  appVersion: '',
  userAgent: '',
  status: 'done',
  adminNote: '',
  createdAt: '2026-08-09T10:00:00Z',
}

async function openFeedbackTab(user) {
  const tab = await screen.findByRole('tab', { name: /Feedback/ })
  await user.click(tab)
  return tab
}

beforeEach(() => {
  vi.clearAllMocks()
  authApi.adminList.mockResolvedValue({ requests: [], users: [] })
  // The server returns the inbox newest-first (created_at DESC) — the fixture
  // mirrors that: BUG (Aug 11) → SUGGESTION (Aug 10) → DONE (Aug 9).
  feedbackApi.listFeedback.mockResolvedValue([BUG, SUGGESTION, DONE])
  feedbackApi.updateFeedback.mockResolvedValue(SUGGESTION)
  feedbackApi.deleteFeedback.mockResolvedValue(undefined)
  // Two-step delete mirrors member delete: confirm() gates the call. Stubbed so
  // jsdom never has to implement it; each test can flip the return value.
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
})

describe('Admin feedback inbox (epic #74, T6 #75)', () => {
  it('shows an unread badge (open count) on the Feedback tab and lists newest first', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    // Badge loads with the inbox on mount, before the tab is even opened.
    const tab = screen.getByRole('tab', { name: /Feedback/ })
    await waitFor(() => expect(tab).toHaveTextContent('2'))

    await user.click(tab)
    const rows = await screen.findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('scanner crashes'),
      expect.stringContaining('Please add'),
      expect.stringContaining('Wishlist'),
    ])
  })

  it('filters the inbox by status', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    const statusGroup = screen.getByRole('group', { name: 'Filter by status' })
    await user.click(within(statusGroup).getByRole('button', { name: 'Done' }))

    expect(screen.getByText(/Wishlist/)).toBeInTheDocument()
    expect(screen.queryByText(/scanner crashes/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Please add/)).not.toBeInTheDocument()
  })

  it('filters the inbox by type', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    const typeGroup = screen.getByRole('group', { name: 'Filter by type' })
    await user.click(within(typeGroup).getByRole('button', { name: 'Bug' }))

    expect(screen.getByText(/scanner crashes/)).toBeInTheDocument()
    expect(screen.queryByText(/Please add/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Wishlist/)).not.toBeInTheDocument()
  })

  it('changes an item status via PATCH, reflects it, and drops the unread badge', async () => {
    feedbackApi.updateFeedback.mockResolvedValue({ ...SUGGESTION, status: 'in_progress' })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    await user.click(await screen.findByRole('button', { name: /Please add/ }))
    const actionGroup = screen.getByRole('group', { name: 'Change status' })
    await user.click(within(actionGroup).getByRole('button', { name: 'In progress' }))

    await waitFor(() => expect(feedbackApi.updateFeedback).toHaveBeenCalledWith({ id: 'fb-1', status: 'in_progress' }))
    // The item now shows the new status…
    const head = screen.getByRole('button', { name: /Please add/ })
    expect(head.textContent).toContain('In progress')
    // …and the unread badge drops from 2 to 1 (only the bug is still open).
    expect(screen.getByRole('tab', { name: /Feedback/ })).toHaveTextContent('1')
  })

  it('saves an admin note via PATCH and confirms it was persisted', async () => {
    feedbackApi.updateFeedback.mockResolvedValue({ ...SUGGESTION, adminNote: 'Follow up next week.' })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    await user.click(await screen.findByRole('button', { name: /Please add/ }))
    const note = screen.getByLabelText('Admin note')
    await user.clear(note)
    await user.type(note, 'Follow up next week.')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(feedbackApi.updateFeedback).toHaveBeenCalledWith({ id: 'fb-1', adminNote: 'Follow up next week.' }))
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
    expect(screen.getByLabelText('Admin note')).toHaveValue('Follow up next week.')
  })

  it('deletes a report after the two-step confirm', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    await user.click(await screen.findByRole('button', { name: /scanner crashes/ }))
    await user.click(screen.getByRole('button', { name: 'Delete report' }))

    expect(vi.mocked(window.confirm)).toHaveBeenCalled()
    await waitFor(() => expect(feedbackApi.deleteFeedback).toHaveBeenCalledWith('fb-2'))
    await waitFor(() => expect(screen.queryByText(/scanner crashes/)).not.toBeInTheDocument())
  })

  it('does not delete when the confirm is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    await user.click(await screen.findByRole('button', { name: /scanner crashes/ }))
    await user.click(screen.getByRole('button', { name: 'Delete report' }))

    expect(feedbackApi.deleteFeedback).not.toHaveBeenCalled()
    // The item (and its expandable head) is still on screen after the cancel.
    expect(screen.getByRole('button', { name: /scanner crashes/ })).toBeInTheDocument()
  })

  it('shows an empty state when the inbox has no feedback', async () => {
    feedbackApi.listFeedback.mockResolvedValue([])
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    expect(await screen.findByText(/No feedback yet/)).toBeInTheDocument()
  })

  it('shows an error state with retry when the inbox fails to load', async () => {
    feedbackApi.listFeedback.mockRejectedValueOnce(new Error('Boom'))
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    expect(await screen.findByText('Boom')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(feedbackApi.listFeedback).toHaveBeenCalledTimes(2))
  })

  it('renders a malformed feedback item (and its detail) without crashing', async () => {
    feedbackApi.listFeedback.mockResolvedValue([{ id: 'fb-x' }])
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openFeedbackTab(user)

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(1)

    // Expand it — the detail must render with guarded fallbacks, no dark screen.
    await user.click(within(rows[0]).getByRole('button', { expanded: false }))
    expect(screen.getByLabelText('Admin note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete report' })).toBeInTheDocument()
  })
})
