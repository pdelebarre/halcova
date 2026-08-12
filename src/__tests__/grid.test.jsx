import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import AlbumGrid from '../components/AlbumGrid'

function makeItems(n) {
  return Array.from({ length: n }).map((_, i) => ({
    id: `r${i}`,
    title: `Artist ${i} - Album ${i}`,
    formatType: 'LP',
  }))
}

describe('AlbumGrid rendering', () => {
  it('renders zero items as an empty grid', () => {
    const { container } = render(<AlbumGrid items={[]} onOpen={vi.fn()} />)
    const cards = container.querySelectorAll('.album-card')
    expect(cards.length).toBe(0)
  })

  it('renders a small set of items (10)', () => {
    const items = makeItems(10)
    const { container } = render(<AlbumGrid items={items} onOpen={vi.fn()} />)
    const cards = container.querySelectorAll('.album-card')
    expect(cards.length).toBe(10)
  })

  it('renders a large set of items (200) without crashing', () => {
    const items = makeItems(200)
    const { container } = render(<AlbumGrid items={items} onOpen={vi.fn()} />)
    const cards = container.querySelectorAll('.album-card')
    expect(cards.length).toBe(200)
  })
})
