import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState'
import { recordsCatalog, booksCatalog } from '../catalog'

// C2 onboarding (issue #88): the empty state now renders a 3-step "how it
// works" ordered list (replacing the single emptySub sentence) and can show a
// persistent, non-blocking records token hint (C2.4) under the Scan button.

describe('EmptyState — C2 onboarding steps (issue #88)', () => {
  it('renders the three empty steps as an ordered list for records', () => {
    render(<EmptyState copy={recordsCatalog.copy} onScan={() => {}} />)
    const list = screen.getByRole('list')
    const items = screen.getAllByRole('listitem')
    expect(list.tagName).toBe('OL')
    expect(items).toHaveLength(3)
    expect(items.map((li) => li.textContent)).toEqual([
      'Scan the barcode',
      'Confirm the match',
      "Done — it's in your collection",
    ])
  })

  it('renders the three empty steps as an ordered list for books', () => {
    render(<EmptyState copy={booksCatalog.copy} onScan={() => {}} />)
    const list = screen.getByRole('list')
    const items = screen.getAllByRole('listitem')
    expect(list.tagName).toBe('OL')
    expect(items).toHaveLength(3)
    expect(items.map((li) => li.textContent)).toEqual([
      'Scan the barcode',
      'Confirm the match',
      "Done — it's in your collection",
    ])
  })

  it('falls back to emptySub when a catalog has no emptySteps', () => {
    // Older/other copy shapes must keep working — no dark-screen crash.
    render(<EmptyState copy={{ emptyTitle: 'Title', emptySub: 'A single sentence.' }} onScan={() => {}} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText('A single sentence.')).toBeInTheDocument()
  })
})

describe('EmptyState — records no-token hint (C2.4, issue #88)', () => {
  const HINT = 'Records lookups need a Discogs token — add yours in Settings.'

  it('shows the hint under the Scan button when noToken is set', () => {
    render(<EmptyState copy={recordsCatalog.copy} noToken onScan={() => {}} />)
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it('hides the hint when noToken is not set (a token exists)', () => {
    render(<EmptyState copy={recordsCatalog.copy} onScan={() => {}} />)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})

describe('EmptyState — dark-screen safety (issue #88)', () => {
  it('renders the shared empty state with each new copy shape without throwing', () => {
    // There is no error boundary — an uncaught render error blanks the app.
    // Feeding every catalog's new copy (with all the add entry points wired)
    // must render cleanly.
    for (const catalog of [recordsCatalog, booksCatalog]) {
      const { unmount } = render(
        <EmptyState copy={catalog.copy} onScan={() => {}} onScanCover={() => {}} onManualAdd={() => {}} />,
      )
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      unmount()
    }
  })
})