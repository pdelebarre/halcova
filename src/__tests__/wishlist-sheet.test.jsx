import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import WishlistSheet from '../components/WishlistSheet'
import { recordsCatalog } from '../catalog'

const WANT = {
  id: 'w1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  genre: ['Jazz', 'Modal'],
  coverImage: 'https://img.discogs.com/kind-of-blue.jpg',
}

function renderSheet(items = [WANT], overrides = {}) {
  const props = {
    items,
    onConvert: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    onOpenItem: vi.fn(),
    copy: recordsCatalog.copy,
    ...overrides,
  }
  return render(<WishlistSheet {...props} />)
}

describe('Wishlist sheet — full cards', () => {
  it('renders the whole card: title, artist, year · label · genre, and a format badge', () => {
    renderSheet()

    expect(screen.getByText('Kind of Blue')).toBeInTheDocument()
    expect(screen.getByText('Miles Davis')).toBeInTheDocument()
    expect(screen.getByText('1959 · Columbia · Jazz, Modal')).toBeInTheDocument()
    expect(screen.getByText('LP')).toBeInTheDocument()
  })

  it('opens the full detail sheet when a wishlist row is tapped', () => {
    const onOpenItem = vi.fn()
    renderSheet([WANT], { onOpenItem })

    fireEvent.click(screen.getByRole('button', { name: /Open details for/ }))

    expect(onOpenItem).toHaveBeenCalledTimes(1)
    expect(onOpenItem).toHaveBeenCalledWith(WANT)
  })

  it('keeps convert and remove actions, and tapping them does not open the detail', () => {
    const onConvert = vi.fn()
    const onRemove = vi.fn()
    const onOpenItem = vi.fn()
    renderSheet([WANT], { onConvert, onRemove, onOpenItem })

    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))
    expect(onConvert).toHaveBeenCalledWith(WANT)

    fireEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }))
    expect(onRemove).toHaveBeenCalledWith(WANT)

    expect(onOpenItem).not.toHaveBeenCalled()
  })

  it('stays read-only for demo visitors: no convert/remove actions, rows still open details', () => {
    const onOpenItem = vi.fn()
    renderSheet([WANT], { isDemo: true, onOpenItem })

    expect(screen.queryByRole('button', { name: 'Add to crate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from wishlist' })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only demo/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Open details for/ }))
    expect(onOpenItem).toHaveBeenCalledWith(WANT)
  })

  it('does not crash when an item is missing fields (no error boundary → dark screen)', () => {
    const sparse = { id: 'w9', title: 'Ghost' }
    renderSheet([sparse], { onOpenItem: vi.fn() })

    expect(screen.getByText('Ghost')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open details for Ghost' })).toBeInTheDocument()
  })

  it('renders no vinyl disc or format badge for a book (empty formatType)', () => {
    const book = { id: 'b1', title: 'Ursula K. Le Guin - The Left Hand of Darkness', year: 1969, formatType: '' }
    const { container } = renderSheet([book], { onOpenItem: vi.fn() })

    expect(screen.getByText('The Left Hand of Darkness')).toBeInTheDocument()
    // No grey vinyl disc peeks out behind a paperback cover…
    expect(container.querySelector('.record-peek')).not.toBeInTheDocument()
    // …and no format badge either.
    expect(container.querySelector('.format-badge')).not.toBeInTheDocument()
  })

  it('still shows the format badge (but no disc) for an unknown-but-present format like Paperback', () => {
    const paperback = { id: 'b2', title: 'Frank Herbert - Dune', formatType: 'Paperback' }
    const { container } = renderSheet([paperback])

    expect(screen.getByText('Paperback')).toBeInTheDocument()
    expect(container.querySelector('.format-badge')).toBeInTheDocument()
    expect(container.querySelector('.record-peek')).not.toBeInTheDocument()
  })
})
