import { describe, expect, it } from 'vitest'
import { binCounts, decadeOf, itemInBin } from './browse'

describe('decadeOf', () => {
  it('buckets a year into its decade', () => {
    expect(decadeOf(1963)).toBe('1960s')
    expect(decadeOf(1999)).toBe('1990s')
    expect(decadeOf(2026)).toBe('2020s')
    expect(decadeOf('1959')).toBe('1950s')
  })

  it('falls back to Other for missing or invalid years', () => {
    expect(decadeOf(undefined)).toBe('Other')
    expect(decadeOf(null)).toBe('Other')
    expect(decadeOf(0)).toBe('Other')
    expect(decadeOf('n/a')).toBe('Other')
  })
})

describe('binCounts', () => {
  const genreAxis = { id: 'genre', value: (item) => item.genre || [] }

  it('counts distinct values A–Z across items', () => {
    const items = [
      { genre: ['Jazz', 'Rock'] },
      { genre: ['Jazz'] },
      { genre: ['Funk'] },
    ]
    expect(binCounts(items, genreAxis)).toEqual([
      { value: 'Funk', count: 1 },
      { value: 'Jazz', count: 2 },
      { value: 'Rock', count: 1 },
    ])
  })

  it('skips blank values and empty items', () => {
    const items = [{ genre: ['', '  '] }, { genre: [] }]
    expect(binCounts(items, genreAxis)).toEqual([])
  })
})

describe('itemInBin', () => {
  const artistAxis = { id: 'artist', value: (item) => [item.artist] }

  it('matches an item whose axis value includes the bin', () => {
    expect(itemInBin({ artist: 'Nina Simone' }, artistAxis, 'Nina Simone')).toBe(true)
    expect(itemInBin({ artist: 'Miles Davis' }, artistAxis, 'Nina Simone')).toBe(false)
  })
})
