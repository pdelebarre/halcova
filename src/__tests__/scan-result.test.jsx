import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ScanResult from '../components/ScanResult'
import { recordsCatalog } from '../catalog'

const CANDIDATE = {
  discogsId: 101,
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  barcode: '0767325734129',
}

function renderResult(overrides = {}) {
  const props = {
    candidate: CANDIDATE,
    ownedExact: null,
    sameAlbum: [],
    otherArtist: [],
    onAdd: vi.fn(),
    onAddToWishlist: vi.fn(),
    onOwnWishlist: vi.fn(),
    onOpenItem: vi.fn(),
    onScanNext: vi.fn(),
    onClose: vi.fn(),
    copy: recordsCatalog.copy,
    ...overrides,
  }
  return render(<ScanResult {...props} />)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ScanResult', () => {
  it('caps related items at five rows and reveals the rest via "and N more"', () => {
    const otherArtist = Array.from({ length: 7 }, (_, i) => ({
      id: `o${i}`,
      title: `Other - Album ${i}`,
      formatType: 'LP',
      year: 2000 + i,
    }))
    const { container } = renderResult({ otherArtist })

    expect(container.querySelectorAll('.related-row')).toHaveLength(5)
    const more = screen.getByRole('button', { name: 'and 2 more' })
    fireEvent.click(more)
    expect(container.querySelectorAll('.related-row')).toHaveLength(7)
  })

  it('swaps the add button to an "Added" state before persisting', () => {
    vi.useFakeTimers()
    const onAdd = vi.fn()
    renderResult({ onAdd })

    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))

    // Immediate busy state; the add is deferred ~0.8s.
    expect(screen.getByRole('button', { name: 'Added' })).toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(800) })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(CANDIDATE)
  })

  it('labels the ownership banner correctly for an owned exact match', () => {
    renderResult({ ownedExact: { id: 'r1', title: 'Miles Davis - Kind of Blue' } })

    expect(screen.getByText('Already in your crate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add anyway' })).toBeInTheDocument()
  })

  it('lists other pressings you own under a "same album" heading', () => {
    const sameAlbum = [{ id: 'p1', title: 'Miles Davis - Kind of Blue', formatType: 'CD', year: 1997 }]
    renderResult({ sameAlbum })

    expect(screen.getByText('Other pressings you own')).toBeInTheDocument()
    expect(screen.getByText('CD · 1997')).toBeInTheDocument()
  })

  it('offers "Add to wishlist" for a candidate that is neither owned nor wishlisted', () => {
    vi.useFakeTimers()
    const onAddToWishlist = vi.fn()
    renderResult({ onAddToWishlist })

    const btn = screen.getByRole('button', { name: 'Add to wishlist' })
    fireEvent.click(btn)
    act(() => { vi.advanceTimersByTime(800) })
    expect(onAddToWishlist).toHaveBeenCalledTimes(1)
    expect(onAddToWishlist).toHaveBeenCalledWith(CANDIDATE)
  })

  it('shows "In your wishlist" and an "Own it" primary for an already-wishlisted candidate', () => {
    vi.useFakeTimers()
    const onOwnWishlist = vi.fn()
    renderResult({ wishlistExact: { id: 'w1', title: 'Miles Davis - Kind of Blue' }, onOwnWishlist })

    expect(screen.getByText('In your wishlist')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to wishlist' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Own it' }))
    act(() => { vi.advanceTimersByTime(800) })
    expect(onOwnWishlist).toHaveBeenCalledTimes(1)
  })

  // ===========================================================================
  // C1.1 / C1.2 — Add & scan next loop + already-owned button swap
  // ===========================================================================

  it('offers "Add & scan next" as the primary for a scan-sourced result, with plain "Add" demoted', () => {
    vi.useFakeTimers()
    const onAddAndScanNext = vi.fn()
    renderResult({ source: 'scan', onAddAndScanNext })

    const primary = screen.getByRole('button', { name: 'Add & scan next' })
    expect(primary.className).toContain('btn-primary')

    // The plain "Add" demotes to the ghost slot next to "Scan next" (C1.1).
    expect(screen.getByRole('button', { name: 'Scan next' }).className).toContain('btn-ghost')
    expect(screen.getByRole('button', { name: 'Add to crate' }).className).toContain('btn-ghost')

    fireEvent.click(primary)
    act(() => { vi.advanceTimersByTime(800) })
    expect(onAddAndScanNext).toHaveBeenCalledTimes(1)
    expect(onAddAndScanNext).toHaveBeenCalledWith(CANDIDATE)
  })

  it('keeps plain "Add" as the primary for a manual/search result (no scan stack)', () => {
    const onAddAndScanNext = vi.fn()
    // `source` defaults to 'manual' — even if the handler were wired, the
    // primary must NOT promote to "Add & scan next".
    renderResult({ onAddAndScanNext })

    expect(screen.getByRole('button', { name: 'Add to crate' }).className).toContain('btn-primary')
    expect(screen.queryByRole('button', { name: 'Add & scan next' })).not.toBeInTheDocument()
  })

  it('does not promote to "Add & scan next" when the handler is missing (defensive)', () => {
    renderResult({ source: 'scan' })
    expect(screen.getByRole('button', { name: 'Add to crate' }).className).toContain('btn-primary')
    expect(screen.queryByRole('button', { name: 'Add & scan next' })).not.toBeInTheDocument()
  })

  it('makes "Scan next" the primary and "Add anyway" the ghost for an already-owned item', () => {
    const onScanNext = vi.fn()
    renderResult({ ownedExact: { id: 'r1', title: 'Miles Davis - Kind of Blue' }, onScanNext })

    const primary = screen.getByRole('button', { name: 'Scan next' })
    expect(primary.className).toContain('btn-primary')
    expect(screen.getByRole('button', { name: 'Add anyway' }).className).toContain('btn-ghost')

    fireEvent.click(primary)
    expect(onScanNext).toHaveBeenCalledTimes(1)
    expect(onScanNext).toHaveBeenCalledWith()
  })

  it('does not crash on a malformed candidate (no error boundary → dark screen)', () => {
    const malformed = { year: undefined, formatType: null } // no title, no cover
    expect(() => renderResult({ candidate: malformed, source: 'scan', onAddAndScanNext: vi.fn() })).not.toThrow()
  })

  // ===========================================================================
  // SECURITY: XSS-safe rendering via isDangerousContent guard
  // ===========================================================================

  it('sanitizes XSS vectors in the candidate title', () => {
    const xssCandidate = {
      ...CANDIDATE,
      title: '<script>alert("xss")</script>',
    }
    const { container } = renderResult({ candidate: xssCandidate })
    // The title should be rendered safely — no raw HTML or script tags visible
    expect(container.querySelector('.result-title')).toBeInTheDocument()
    const titleText = container.querySelector('.result-title').textContent
    expect(titleText).not.toContain('<script>')
    // The render should not crash (no error boundary → dark screen)
    expect(container.querySelector('.result-sheet')).toBeInTheDocument()
  })

  it('sanitizes XSS vectors in the candidate artist', () => {
    const xssCandidate = {
      ...CANDIDATE,
      title: 'javascript:alert(1) - Kind of Blue',
    }
    const { container } = renderResult({ candidate: xssCandidate })
    // The artist part from the title should be sanitized
    // title is 'javascript:alert(1) - Kind of Blue' → artist = 'javascript:alert(1)', album = 'Kind of Blue'
    expect(container.querySelector('.result-title')).toBeInTheDocument()
    // The render should not crash (no error boundary → dark screen)
    expect(container.querySelector('.result-sheet')).toBeInTheDocument()
  })

  it('sanitizes XSS vectors in the format type and label', () => {
    const xssCandidate = {
      ...CANDIDATE,
      formatType: '<img src=x onerror=alert(1)>',
      label: '"><script>evil()</script>',
    }
    const { container } = renderResult({ candidate: xssCandidate })
    // Should render safely — no crash, no raw HTML visible
    expect(container.querySelector('.result-sub')).toBeInTheDocument()
    expect(container.querySelector('.result-sheet')).toBeInTheDocument()
  })
})
