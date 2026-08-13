import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import AlbumGrid from '../components/AlbumGrid'

describe('Collection grid at scale (§ Phase 4)', () => {
  it('renders 1000+ covers without crashing (content-visibility covers layout)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      title: `Artist ${i} - Album ${i}`,
      year: 1950 + (i % 70),
      formatType: 'LP',
      coverImage: undefined,
    }))
    const { container } = render(<AlbumGrid items={items} onOpen={vi.fn()} copy={{}} />)
    expect(container.querySelectorAll('.album-card')).toHaveLength(1000)
  })
})
