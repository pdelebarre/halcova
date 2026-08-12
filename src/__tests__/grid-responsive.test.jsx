import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import AlbumGrid from '../components/AlbumGrid'
import BookGrid from '../components/BookGrid'

const ITEMS = [
  { id: 'r1', title: 'Miles Davis - Kind of Blue', formatType: 'LP' },
  { id: 'r2', title: 'Nina Simone - Little Girl Blue', formatType: 'LP' },
]

describe('Responsive grids (records & books)', () => {
  it('renders records in the shared auto-fill album grid', () => {
    const { container } = render(<AlbumGrid items={ITEMS} onOpen={vi.fn()} />)

    const grid = container.querySelector('.album-grid')
    expect(grid).toBeTruthy()
    expect(grid.classList.contains('album-grid--books')).toBe(false)
    expect(container.querySelectorAll('.album-card')).toHaveLength(2)
  })

  it('renders books in the narrower books variant of the same grid', () => {
    const { container } = render(<BookGrid items={ITEMS} onOpen={vi.fn()} />)

    const grid = container.querySelector('.album-grid')
    expect(grid).toHaveClass('album-grid--books')
    expect(container.querySelectorAll('.book-card')).toHaveLength(2)
  })
})
