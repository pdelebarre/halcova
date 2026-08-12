import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LendingControls from '../components/LendingControls'
import { recordsCatalog } from '../catalog'

const DAY = 24 * 60 * 60 * 1000

function renderControls(item, overrides = {}) {
  const props = {
    item,
    catalog: recordsCatalog,
    lendingEnabled: true,
    onLend: vi.fn(),
    onReturn: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  }
  return render(<LendingControls {...props} />)
}

function onLoanItem(extra = {}) {
  return {
    id: 'r1',
    title: 'Miles Davis - Kind of Blue',
    lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z', ...extra },
  }
}

describe('LendingControls', () => {
  it('renders nothing when lending is disabled', () => {
    const { container } = renderControls({}, { lendingEnabled: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the on-loan status line with a future due date (not overdue)', () => {
    renderControls(onLoanItem({ dueOn: new Date(Date.now() + 30 * DAY).toISOString() }))

    expect(screen.getByText(/On loan to Alice/)).toBeInTheDocument()
    const due = screen.getByText(/^Due /)
    expect(due).toBeInTheDocument()
    expect(due).not.toHaveClass('lending-status-overdue')
    expect(screen.queryByText(/Overdue since/)).not.toBeInTheDocument()
  })

  it('shows the overdue line when the due date is in the past', () => {
    renderControls(onLoanItem({ dueOn: new Date(Date.now() - 30 * DAY).toISOString() }))

    expect(screen.getByText(/On loan to Alice/)).toBeInTheDocument()
    expect(screen.getByText(/Overdue since/)).toHaveClass('lending-status-overdue')
  })

  it('requires a borrower name before lending', () => {
    const onLend = vi.fn()
    renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' }, { onLend })

    fireEvent.click(screen.getByRole('button', { name: 'Lend…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lend' }))

    expect(screen.getByText(/Add a name/)).toBeInTheDocument()
    expect(onLend).not.toHaveBeenCalled()
  })

  it('lends to a borrower and announces it with a toast', async () => {
    const onLend = vi.fn().mockResolvedValue()
    const showToast = vi.fn()
    renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' }, { onLend, showToast })

    fireEvent.click(screen.getByRole('button', { name: 'Lend…' }))
    fireEvent.change(screen.getByLabelText('Borrower'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText(/Contact/), { target: { value: 'a@x.com' } })
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lend' }))

    expect(onLend).toHaveBeenCalledWith({
      borrower: { name: 'Alice', contact: 'a@x.com' },
      dueOn: '2026-12-31',
    })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Lent to Alice', undefined))
  })

  it('marks an item returned after a two-step confirm', async () => {
    const onReturn = vi.fn().mockResolvedValue()
    const showToast = vi.fn()
    renderControls(onLoanItem(), { onReturn, showToast })

    fireEvent.click(screen.getByRole('button', { name: 'Mark returned' }))
    expect(onReturn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm returned?' }))
    expect(onReturn).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Marked returned', undefined))
  })

  it('shows an error toast when the lend fails', async () => {
    const onLend = vi.fn().mockRejectedValue(new Error('offline'))
    const showToast = vi.fn()
    renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' }, { onLend, showToast })

    fireEvent.click(screen.getByRole('button', { name: 'Lend…' }))
    fireEvent.change(screen.getByLabelText('Borrower'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lend' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not save — check your connection', 'error'))
    expect(onLend).toHaveBeenCalledTimes(1)
  })

  it('shows an error toast when marking returned fails', async () => {
    const onReturn = vi.fn().mockRejectedValue(new Error('offline'))
    const showToast = vi.fn()
    renderControls(onLoanItem(), { onReturn, showToast })

    fireEvent.click(screen.getByRole('button', { name: 'Mark returned' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm returned?' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not save — check your connection', 'error'))
  })

  it('does not crash on an empty item shape', () => {
    renderControls({})
    expect(screen.getByText('Not on loan')).toBeInTheDocument()
  })

  it('does not crash when lending is present without a borrower', () => {
    renderControls({ id: 'r1', title: 'X', lending: { lentOn: '2026-08-01T00:00:00Z' } })
    expect(screen.getByRole('button', { name: 'Mark returned' })).toBeInTheDocument()
  })
})
