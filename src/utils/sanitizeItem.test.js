import { describe, expect, it } from 'vitest'
import { sanitizeItemForCreate } from './sanitizeItem'

describe('sanitizeItemForCreate', () => {
  it('coerces string year/pageCount to integers', () => {
    const out = sanitizeItemForCreate({ title: 'T', year: '1968', pageCount: '205' })
    expect(out).toEqual({ title: 'T', year: 1968, pageCount: 205 })
  })

  it('drops empty-string year/pageCount', () => {
    const out = sanitizeItemForCreate({ title: 'T', year: '', pageCount: '' })
    expect(out).toEqual({ title: 'T' })
  })

  it('drops null/undefined year/pageCount', () => {
    const out = sanitizeItemForCreate({ title: 'T', year: null, pageCount: undefined })
    expect(out).toEqual({ title: 'T' })
  })

  it('drops non-integer and out-of-range values', () => {
    const out = sanitizeItemForCreate({ title: 'T', year: 'abc', pageCount: '999999999' })
    expect(out).toEqual({ title: 'T' })
  })

  it('leaves other fields untouched and does not mutate the input', () => {
    const input = { title: 'T', year: '1968', genre: ['Fiction'], wishlist: true, pageCount: 205 }
    const out = sanitizeItemForCreate(input)
    expect(input.year).toBe('1968')
    expect(out).toEqual({ title: 'T', year: 1968, genre: ['Fiction'], wishlist: true, pageCount: 205 })
  })

  it('returns non-objects unchanged', () => {
    expect(sanitizeItemForCreate(null)).toBe(null)
    expect(sanitizeItemForCreate(undefined)).toBe(undefined)
  })
})
