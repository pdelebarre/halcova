import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoansDashboard from '../components/LoansDashboard'

// Mock both API modules — the dashboard loads via listItems (both stores) and
// marks returns via returnItem. Never any real network.
vi.mock('../api/collection', () => ({ listItems: vi.fn() }))
vi.mock('../api/lending', () => ({ returnItem: vi.fn() }))

import * as api from '../api/collection'
import * as apiLending from '../api/lending'

const DAY = 24 * 60 * 60 * 1000

// Top-level overrides (id/title) go on the item; `lendingOverrides` go on the
// lending object (dueOn/lentOn/borrower).
function loanedRecord(overrides = {}, lendingOverrides = {}) {
  return {
    id: 'r1',
    title: 'Miles Davis - Kind of Blue',
    ...overrides,
    lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z', ...lendingOverrides },
  }
}

function loanedBook(overrides = {}) {
  return {
    id: 'b1',
    title: 'Ursula K. Le Guin - A Wizard of Earthsea',
    lending: { borrower: { name: 'Bob' }, lentOn: '2026-08-02T00:00:00Z', ...overrides },
  }
}

function renderDashboard(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onLoanReturned: vi.fn(),
    returnFocusRef: { current: null },
    ...overrides,
  }
  return render(<LoansDashboard {...props} />)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// The dashboard refocuses the search input via requestAnimationFrame on open;
// fire it synchronously in jsdom so focus assertions are deterministic.
function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

beforeEach(() => {
  stubRaf()
  api.listItems.mockReset().mockResolvedValue([])
  apiLending.returnItem.mockReset().mockResolvedValue({})
})

describe('LoansDashboard (W7)', () => {
  it('fetches records and books once on open and lists only on-loan items with kind tags', async () => {
    api.listItems.mockImplementation(async (kind) => {
      if (kind === 'records') return [loanedRecord(), { id: 'r2', title: 'Nina Simone - Little Girl Blue' }]
      return [loanedBook()]
    })

    renderDashboard()

    await screen.findByText('A Wizard of Earthsea')
    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(2))
    expect(api.listItems).toHaveBeenCalledWith('records')
    expect(api.listItems).toHaveBeenCalledWith('books')

    // Only the items carrying `item.lending` become rows; kind chips tag them.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Records')).toBeInTheDocument()
    expect(screen.getByText('Books')).toBeInTheDocument()
    expect(screen.queryByText('Little Girl Blue')).not.toBeInTheDocument()
  })

  it('shows a loading line, then the empty state when nothing is on loan', async () => {
    const d = deferred()
    api.listItems.mockReturnValue(d.promise)

    renderDashboard()
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    await act(async () => { d.resolve([]) })

    expect(await screen.findByText('Nothing on loan right now.')).toBeInTheDocument()
  })

  it('shows an error state and the retry button re-fetches', async () => {
    api.listItems.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([])

    renderDashboard()

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText('boom')).toBeInTheDocument()
    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(2))

    fireEvent.click(retry)

    expect(await screen.findByText('Nothing on loan right now.')).toBeInTheDocument()
    expect(api.listItems).toHaveBeenCalledTimes(4)
  })

  it('filters by title, artist, and borrower case-insensitively', async () => {
    api.listItems.mockImplementation(async (kind) =>
      kind === 'records' ? [loanedRecord()] : [loanedBook()],
    )

    renderDashboard()
    await screen.findByText('A Wizard of Earthsea')

    const search = screen.getByLabelText('Search loans…')

    // Title (case-insensitive).
    fireEvent.change(search, { target: { value: 'MILES' } })
    expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
    expect(screen.queryByText('A Wizard of Earthsea')).not.toBeInTheDocument()

    // Artist name.
    fireEvent.change(search, { target: { value: 'le guin' } })
    expect(screen.getByText('A Wizard of Earthsea')).toBeInTheDocument()
    expect(screen.queryByText('Kind of Blue')).not.toBeInTheDocument()

    // Borrower name.
    fireEvent.change(search, { target: { value: 'alice' } })
    expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
    expect(screen.queryByText('A Wizard of Earthsea')).not.toBeInTheDocument()
  })

  it('shows the no-matches line when search filters everything out', async () => {
    api.listItems.mockImplementation(async (kind) =>
      kind === 'records' ? [loanedRecord()] : [loanedBook()],
    )

    renderDashboard()
    await screen.findByText('A Wizard of Earthsea')

    fireEvent.change(screen.getByLabelText('Search loans…'), { target: { value: 'zzzz' } })

    expect(screen.getByText('Nothing matches')).toBeInTheDocument()
    expect(screen.getByText('Try a different search or clear the filters.')).toBeInTheDocument()
  })

  it('sorts overdue-first by default (promoted due sort — A5.4)', async () => {
    const older = loanedRecord({ id: 'r-old' }, { lentOn: '2026-01-01T00:00:00Z' })
    const newer = loanedRecord({ id: 'r-new', title: 'Nina Simone - Little Girl Blue' }, { lentOn: '2026-06-01T00:00:00Z' })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [older, newer] : []))

    const { container } = renderDashboard()
    await screen.findByText('Kind of Blue')

    // Default is the overdue-first 'due' sort; no due dates → title tiebreak.
    expect(screen.getByLabelText('Sort')).toHaveValue('due')
    const titles = Array.from(container.querySelectorAll('.loan-title-text')).map((el) => el.textContent)
    expect(titles).toEqual(['Kind of Blue', 'Little Girl Blue'])
  })

  it('sorts by lent date (newest first) when Lent sort is selected', async () => {
    const older = loanedRecord({ id: 'r-old' }, { lentOn: '2026-01-01T00:00:00Z' })
    const newer = loanedRecord({ id: 'r-new', title: 'Nina Simone - Little Girl Blue' }, { lentOn: '2026-06-01T00:00:00Z' })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [older, newer] : []))

    const { container } = renderDashboard()
    await screen.findByText('Kind of Blue')

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'lent' } })

    const titles = Array.from(container.querySelectorAll('.loan-title-text')).map((el) => el.textContent)
    expect(titles).toEqual(['Little Girl Blue', 'Kind of Blue'])
  })

  it('sorts by due date: overdue first, then soonest due, no-due last', async () => {
    const overdue = loanedRecord({ id: 'r-over' }, { dueOn: new Date(Date.now() - 30 * DAY).toISOString() })
    const soon = loanedRecord({ id: 'r-soon', title: 'A - Soon' }, { dueOn: new Date(Date.now() + 5 * DAY).toISOString() })
    const none = loanedRecord({ id: 'r-none', title: 'B - No due date' })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [overdue, soon, none] : []))

    const { container } = renderDashboard()
    await screen.findByText('Kind of Blue')

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'due' } })

    const titles = Array.from(container.querySelectorAll('.loan-title-text')).map((el) => el.textContent)
    expect(titles).toEqual(['Kind of Blue', 'Soon', 'No due date'])
  })

  it('sorts by borrower A–Z and title A–Z', async () => {
    const alice = loanedRecord({}, { borrower: { name: 'Alice' } })
    const bob = loanedRecord({ id: 'r2', title: 'Nina Simone - Little Girl Blue' }, { borrower: { name: 'Bob' } })
    const charlie = loanedRecord({ id: 'r3', title: 'John Coltrane - A Love Supreme' }, { borrower: { name: 'Charlie' } })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [alice, bob, charlie] : []))

    const { container } = renderDashboard()
    await screen.findByText('Kind of Blue')

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'borrower' } })
    let titles = Array.from(container.querySelectorAll('.loan-title-text')).map((el) => el.textContent)
    expect(titles).toEqual(['Kind of Blue', 'Little Girl Blue', 'A Love Supreme'])

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'title' } })
    titles = Array.from(container.querySelectorAll('.loan-title-text')).map((el) => el.textContent)
    expect(titles).toEqual(['A Love Supreme', 'Kind of Blue', 'Little Girl Blue'])
  })

  it('marks a loan returned via the two-step confirm and notifies the app', async () => {
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [loanedRecord()] : []))
    const onLoanReturned = vi.fn()
    const { container } = renderDashboard({ onLoanReturned })
    await screen.findByText('Kind of Blue')

    // First tap arms the confirm label without calling the API.
    fireEvent.click(screen.getByRole('button', { name: 'Mark returned' }))
    expect(screen.getByRole('button', { name: 'Confirm returned?' })).toBeInTheDocument()
    expect(apiLending.returnItem).not.toHaveBeenCalled()

    // Second tap performs the return for the right collection + item.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm returned?' }))
    expect(apiLending.returnItem).toHaveBeenCalledWith({ collection: 'records', itemId: 'r1' })

    // Success removes the row, notifies App, and shows the toast.
    await waitFor(() => expect(container.querySelectorAll('.loan-row')).toHaveLength(0))
    expect(onLoanReturned).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Marked returned')).toBeInTheDocument()
  })

  it('disables the return button while the return is pending', async () => {
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [loanedRecord()] : []))
    const d = deferred()
    apiLending.returnItem.mockReturnValue(d.promise)

    renderDashboard()
    await screen.findByText('Kind of Blue')

    fireEvent.click(screen.getByRole('button', { name: 'Mark returned' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm returned?' }))

    const busyBtn = screen.getByRole('button', { name: 'Mark returned' })
    expect(busyBtn).toBeDisabled()
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    await act(async () => { d.resolve({}) })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark returned' })).not.toBeInTheDocument())
  })

  it('keeps the row and shows an error notice when the return fails', async () => {
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [loanedRecord()] : []))
    apiLending.returnItem.mockRejectedValue(new Error('offline'))
    const { container } = renderDashboard()
    await screen.findByText('Kind of Blue')

    fireEvent.click(screen.getByRole('button', { name: 'Mark returned' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm returned?' }))

    expect(await screen.findByText('Could not save — check your connection')).toBeInTheDocument()
    expect(container.querySelectorAll('.loan-row')).toHaveLength(1)
    // The row can be returned again after the failure.
    expect(screen.getByRole('button', { name: 'Mark returned' })).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the Loans button', async () => {
    const onClose = vi.fn()
    const focus = vi.fn()
    renderDashboard({ onClose, returnFocusRef: { current: { focus } } })
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('renders a modal dialog and focuses the search input on open', async () => {
    renderDashboard()

    const dialog = await screen.findByRole('dialog', { name: 'On loan' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('Search loans…')).toHaveFocus()
  })

  it('re-fetches when reopened after being closed', async () => {
    const { rerender } = renderDashboard({ open: false })
    expect(api.listItems).not.toHaveBeenCalled()

    rerender(<LoansDashboard open onClose={vi.fn()} onLoanReturned={vi.fn()} returnFocusRef={{ current: null }} />)

    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(2))
  })
})

// ===========================================================================
// A5 lending polish (#90/#92): contact actions + Remind in rows, overdue
// count in the header. Default sort is now overdue-first (see above).
// ===========================================================================

describe('LoansDashboard — A5.4 overdue surfacing', () => {
  it('shows the overdue count in the header when > 0', async () => {
    const overdue = loanedRecord({ id: 'r-over' }, { dueOn: new Date(Date.now() - 5 * DAY).toISOString() })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [overdue] : []))

    renderDashboard()

    expect(await screen.findByText(/1 overdue/)).toBeInTheDocument()
  })

  it('hides the overdue count from the header when none are overdue', async () => {
    const future = loanedRecord({ id: 'r-future', title: 'Nina Simone - Little Girl Blue' }, { dueOn: new Date(Date.now() + 30 * DAY).toISOString() })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [future] : []))

    renderDashboard()
    await screen.findByText('Little Girl Blue')

    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
  })
})

describe('LoansDashboard — A5.1 contact actions in rows', () => {
  it('renders the stored contact as a one-tap action', async () => {
    const item = loanedRecord({}, { borrower: { name: 'Alice', contact: 'alice@example.com' } })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [item] : []))

    renderDashboard()

    const link = await screen.findByRole('link', { name: 'Email' })
    expect(link).toHaveAttribute('href', 'mailto:alice@example.com')
  })

  it('renders no contact action for an unclassifiable contact', async () => {
    const item = loanedRecord({}, { borrower: { name: 'Alice', contact: 'call me' } })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [item] : []))

    renderDashboard()
    await screen.findByRole('button', { name: 'Remind' })

    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument()
  })
})

describe('LoansDashboard — A5.2 Remind on each row', () => {
  it('copies the message and shows the notice when share is unavailable', async () => {
    const item = loanedRecord({}, { dueOn: '2026-08-15' })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [item] : []))

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderDashboard()

    const remind = await screen.findByRole('button', { name: 'Remind' })
    fireEvent.click(remind)

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('Alice')
    expect(screen.getByText('Message copied — send it to Alice')).toBeInTheDocument()
  })

  it('opens the share sheet when navigator.share is available', async () => {
    const item = loanedRecord({}, { dueOn: '2026-08-15' })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [item] : []))

    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    renderDashboard()

    const remind = await screen.findByRole('button', { name: 'Remind' })
    fireEvent.click(remind)

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const text = share.mock.calls[0][0].text
    expect(text).toContain('Alice')
    expect(text).toContain('Kind of Blue')
    expect(text).toMatch(/due/)
  })
})

// A5.1 contact-less loans on the dashboard row: a loan with NO borrower.contact
// (or no borrower at all) must render no Call/Email/Message action and never
// crash — `lending.borrower || {}` + classifyContact(undefined) are the guards.
describe('LoansDashboard — A5.1 contact-less loans (dark-screen safety)', () => {
  it('renders no contact action when the borrower has no stored contact', async () => {
    // Borrower present, but no `contact` field stored.
    const item = loanedRecord({}, { borrower: { name: 'Alice' } })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [item] : []))

    renderDashboard()
    await screen.findByRole('button', { name: 'Remind' })

    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument()
  })

  it('does not crash when a loan has no borrower object at all', async () => {
    const item = loanedRecord({}, { borrower: undefined })
    api.listItems.mockImplementation(async (kind) => (kind === 'records' ? [item] : []))

    renderDashboard()

    // The row still renders with Remind + return; no contact link, no crash.
    expect(await screen.findByRole('button', { name: 'Remind' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark returned' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument()
  })
})
