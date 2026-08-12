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
})
