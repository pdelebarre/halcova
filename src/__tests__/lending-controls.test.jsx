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

  describe('lending history', () => {
    const historyItem = (lendingHistory) => ({
      id: 'r1',
      title: 'Miles Davis - Kind of Blue',
      lendingHistory,
    })

    it('renders the History label with one entry per lendingHistory item', () => {
      const { container } = renderControls(historyItem([
        { borrower: { name: 'Zoe' }, lentOn: '2026-08-01' },
        { borrower: { name: 'Alice' }, lentOn: '2026-06-01' },
        { borrower: { name: 'Bob' }, lentOn: '2026-05-01' },
      ]))

      expect(screen.getByText('History')).toBeInTheDocument()
      expect(container.querySelectorAll('.lending-history-entry')).toHaveLength(3)
      expect(screen.getByText('Zoe')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('shows Lent {date} plus Returned {date} only when returnedOn is present', () => {
      const { container } = renderControls(historyItem([
        { borrower: { name: 'Zoe' }, lentOn: '2026-08-01', returnedOn: '2026-08-15' },
        { borrower: { name: 'Alice' }, lentOn: '2026-06-01' },
      ]))

      const entries = container.querySelectorAll('.lending-history-entry')
      expect(entries).toHaveLength(2)
      expect(entries[0].textContent).toMatch(/Lent /)
      expect(entries[0].textContent).toMatch(/Returned /)
      expect(entries[1].textContent).toMatch(/Lent /)
      expect(entries[1].textContent).not.toMatch(/Returned /)
    })

    it('renders history newest-first in the given array order', () => {
      const { container } = renderControls(historyItem([
        { borrower: { name: 'Zoe' }, lentOn: '2026-08-01' },
        { borrower: { name: 'Alice' }, lentOn: '2026-06-01' },
      ]))

      const entries = container.querySelectorAll('.lending-history-entry')
      expect(entries).toHaveLength(2)
      expect(entries[0].textContent).toContain('Zoe')
      expect(entries[1].textContent).toContain('Alice')
    })

    it('falls back to an em dash when the borrower name is missing', () => {
      renderControls(historyItem([{ lentOn: '2026-08-01' }]))
      expect(screen.getByText('—')).toBeInTheDocument()
    })

    it('renders no history section when lendingHistory is an empty array', () => {
      renderControls(historyItem([]))
      expect(screen.queryByText('History')).not.toBeInTheDocument()
    })

    it('renders no history section when lendingHistory is undefined', () => {
      renderControls(historyItem(undefined))
      expect(screen.queryByText('History')).not.toBeInTheDocument()
    })

    it('renders no history section when the item has no lendingHistory field', () => {
      renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' })
      expect(screen.queryByText('History')).not.toBeInTheDocument()
    })

    it('renders nothing when lending is disabled, even with history present', () => {
      const { container } = renderControls(
        historyItem([{ borrower: { name: 'Alice' }, lentOn: '2026-08-01' }]),
        { lendingEnabled: false }
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('does not crash on a null history entry', () => {
      renderControls(historyItem([null]))
      expect(screen.getByText('—')).toBeInTheDocument()
    })

    it('does not crash on a history entry with no dates', () => {
      renderControls(historyItem([{ borrower: { name: 'Alice' } }]))
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('does not crash on a non-array lendingHistory value', () => {
      renderControls(historyItem({}))
      expect(screen.getByText('Not on loan')).toBeInTheDocument()
      expect(screen.queryByText('History')).not.toBeInTheDocument()
    })

    it('renders the on-loan status block and the history list together', () => {
      const { container } = renderControls({
        id: 'r1',
        title: 'Miles Davis - Kind of Blue',
        lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z' },
        lendingHistory: [
          { borrower: { name: 'Alice' }, lentOn: '2026-08-01' },
          { borrower: { name: 'Zoe' }, lentOn: '2026-06-01', returnedOn: '2026-06-10' },
        ],
      })

      expect(screen.getByText(/On loan to Alice/)).toBeInTheDocument()
      expect(screen.getByText('History')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mark returned' })).toBeInTheDocument()
      expect(container.querySelectorAll('.lending-history-entry')).toHaveLength(2)
    })
  })
})

// ===========================================================================
// S6 lending gate (#57): a free member with lending disabled sees a "Lending
// is Premium" affordance whose Upgrade CTA opens the paywall with reason
// 'feature'. A PAYMENT_REQUIRED failure mid-lend also surfaces the paywall.
// ===========================================================================

describe('S6 lending gate — paywall trigger', () => {
  it('renders the gated affordance with an Upgrade CTA that opens the paywall (reason feature)', () => {
    const onOpenPaywall = vi.fn()
    renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' }, {
      lendingEnabled: false,
      lendingGate: true,
      onOpenPaywall,
    })

    // The gate title + the paywall CTA replace the normal lending controls.
    expect(screen.getByText('Lending')).toBeInTheDocument()
    expect(screen.getByText("Lending isn't enabled for your account.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lend…' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onOpenPaywall).toHaveBeenCalledWith({ reason: 'feature', feature: 'lending' })
  })

  it('renders nothing for a non-gated visitor with lending disabled (no paywall leak)', () => {
    const { container } = renderControls({ id: 'r1', title: 'X' }, { lendingEnabled: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('does not crash when the gate is on but onOpenPaywall is missing', () => {
    renderControls({ id: 'r1', title: 'X' }, { lendingEnabled: false, lendingGate: true })
    // The CTA still renders; clicking it is a safe no-op.
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
  })

  it('surfaces the paywall when a lend fails with PAYMENT_REQUIRED (expired mid-session)', async () => {
    const onOpenPaywall = vi.fn()
    const onLend = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'PAYMENT_REQUIRED' }))
    const showToast = vi.fn()
    renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' }, { onLend, showToast, onOpenPaywall })

    fireEvent.click(screen.getByRole('button', { name: 'Lend…' }))
    fireEvent.change(screen.getByLabelText('Borrower'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lend' }))

    await waitFor(() => expect(onOpenPaywall).toHaveBeenCalledWith({ reason: 'feature', feature: 'lending' }))
    // The user also gets a non-crashing error toast.
    expect(showToast).toHaveBeenCalledWith("Lending isn't enabled for your account.", 'error')
  })

  it('keeps the generic save error (no paywall) for a non-entitlement failure', async () => {
    const onOpenPaywall = vi.fn()
    const onLend = vi.fn().mockRejectedValue(new Error('offline'))
    const showToast = vi.fn()
    renderControls({ id: 'r1', title: 'Miles Davis - Kind of Blue' }, { onLend, showToast, onOpenPaywall })

    fireEvent.click(screen.getByRole('button', { name: 'Lend…' }))
    fireEvent.change(screen.getByLabelText('Borrower'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lend' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not save — check your connection', 'error'))
    expect(onOpenPaywall).not.toHaveBeenCalled()
  })
})
