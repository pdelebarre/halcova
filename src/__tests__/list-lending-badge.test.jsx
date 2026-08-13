import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ListView from '../components/ListView'
import { recordsCatalog } from '../catalog'

// ListView rendering harness — same as listview.test.jsx but with the W7
// `lendingEnabled`/`copy` props the list badge reads.
const copy = recordsCatalog.copy
const DAY = 24 * 60 * 60 * 1000

function onLoan(overrides = {}) {
  return {
    id: 'r1',
    title: 'Miles Davis - Kind of Blue',
    formatType: 'LP',
    lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z', ...overrides },
  }
}

function renderList(items, overrides = {}) {
  return render(
    <ListView
      items={items}
      sortBy="added"
      copy={copy}
      onOpen={vi.fn()}
      {...overrides}
    />,
  )
}

describe('list lending badge (W7)', () => {
  it('shows an On loan badge on a loaned row with no due date', () => {
    const { container } = renderList([onLoan()], { lendingEnabled: true })

    const badge = container.querySelector('.list-lending-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('On loan')
    expect(badge).not.toHaveClass('overdue')
  })

  it('still shows On loan when the due date is in the future', () => {
    const { container } = renderList(
      [onLoan({ dueOn: new Date(Date.now() + 30 * DAY).toISOString() })],
      { lendingEnabled: true },
    )

    const badge = container.querySelector('.list-lending-badge')
    expect(badge).toHaveTextContent('On loan')
    expect(badge).not.toHaveClass('overdue')
  })

  it('shows an Overdue badge when the due date is strictly before today', () => {
    const { container } = renderList(
      [onLoan({ dueOn: new Date(Date.now() - 30 * DAY).toISOString() })],
      { lendingEnabled: true },
    )

    const badge = container.querySelector('.list-lending-badge')
    expect(badge).toHaveTextContent('Overdue')
    expect(badge).toHaveClass('overdue')
  })

  it('renders no badge when lending is disabled', () => {
    const { container } = renderList([onLoan()], { lendingEnabled: false })

    expect(container.querySelector('.list-lending-badge')).toBeNull()
  })

  it('folds the on-loan status into the row button aria-label', () => {
    renderList([onLoan()], { lendingEnabled: true })

    expect(screen.getByRole('button', { name: 'Miles Davis — Kind of Blue — On loan' })).toBeInTheDocument()
  })

  it('does not crash on weird item shapes', () => {
    const { container } = renderList(
      [{}, { id: 'r2', title: 'Nina Simone - Little Girl Blue', formatType: 'LP', lending: {} }],
      { lendingEnabled: true },
    )

    // Both rows render; only the row with a lending object gets a badge.
    expect(container.querySelectorAll('.list-row')).toHaveLength(2)
    expect(container.querySelectorAll('.list-lending-badge')).toHaveLength(1)
  })
})
