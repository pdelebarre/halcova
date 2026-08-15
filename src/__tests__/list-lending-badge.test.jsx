import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ListView from '../components/ListView'
import { recordsCatalog } from '../catalog'

// ListView rendering harness — same as listview.test.jsx but with the W7
// `lendingEnabled`/`copy` props the on-loan icon (A5.6 #117) reads.
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

describe('list on-loan icon (A5.6 #117)', () => {
  it('renders a clickable loan icon (role=button) on a loaned row', () => {
    const { container } = renderList([onLoan()], { lendingEnabled: true })

    const icon = container.querySelector('.loan-icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('role', 'button')
    expect(icon).toHaveAccessibleName('On loan to Alice — manage')
    expect(icon).not.toHaveClass('overdue')
    // The old inline pill is gone.
    expect(container.querySelector('.list-lending-badge')).toBeNull()
  })

  it('deep-links to the lend card when the icon is activated', () => {
    const onOpen = vi.fn()
    const { container } = renderList([onLoan()], { lendingEnabled: true, onOpen })

    fireEvent.click(container.querySelector('.loan-icon'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { focus: 'lending' })
  })

  it('still shows on-loan when the due date is in the future', () => {
    const { container } = renderList(
      [onLoan({ dueOn: new Date(Date.now() + 30 * DAY).toISOString() })],
      { lendingEnabled: true },
    )

    const icon = container.querySelector('.loan-icon')
    expect(icon).toHaveAccessibleName('On loan to Alice — manage')
    expect(icon).not.toHaveClass('overdue')
  })

  it('shows an Overdue affordance when the due date is strictly before today', () => {
    const { container } = renderList(
      [onLoan({ dueOn: new Date(Date.now() - 30 * DAY).toISOString() })],
      { lendingEnabled: true },
    )

    const icon = container.querySelector('.loan-icon')
    expect(icon).toHaveClass('overdue')
    expect(icon).toHaveAccessibleName('Overdue — on loan to Alice — manage')
    // P1-1: the overdue affordance includes the alert dot (the filled-pill
    // styling lives in CSS — this class gates it, so overdue differs by
    // fill/area as well as hue, not hue alone).
    expect(container.querySelector('.loan-icon-dot')).toBeInTheDocument()
  })

  it('renders no icon when lending is disabled', () => {
    const { container } = renderList([onLoan()], { lendingEnabled: false })

    expect(container.querySelector('.loan-icon')).toBeNull()
  })

  it('labels the row with the item title — the loan status lives on the icon', () => {
    renderList([onLoan()], { lendingEnabled: true })

    expect(screen.getByRole('button', { name: 'Miles Davis — Kind of Blue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'On loan to Alice — manage' })).toBeInTheDocument()
  })

  it('does not crash on weird item shapes', () => {
    const { container } = renderList(
      [{}, { id: 'r2', title: 'Nina Simone - Little Girl Blue', formatType: 'LP', lending: {} }],
      { lendingEnabled: true },
    )

    // Both rows render; only the row with a lending object gets an icon.
    expect(container.querySelectorAll('.list-row')).toHaveLength(2)
    expect(container.querySelectorAll('.loan-icon')).toHaveLength(1)
  })
})
