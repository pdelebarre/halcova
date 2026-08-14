// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMIT, MAX_LIMIT, parsePagination, sliceIds, isDefaultPage } from './pagination'

const sp = (obj = {}) => new URLSearchParams(obj)

describe('parsePagination', () => {
  it('defaults to a high limit and offset 0 when no params are given', () => {
    expect(parsePagination(sp())).toEqual({ offset: 0, limit: DEFAULT_LIMIT })
  })

  it('reads explicit limit and offset', () => {
    expect(parsePagination(sp({ limit: '25', offset: '100' }))).toEqual({ offset: 100, limit: 25 })
  })

  it('caps limit at the sane maximum to avoid huge blob reads', () => {
    expect(parsePagination(sp({ limit: '999999' }))).toEqual({ offset: 0, limit: MAX_LIMIT })
  })

  it('ignores negative, fractional and non-numeric values and falls back to defaults', () => {
    expect(parsePagination(sp({ limit: '-5', offset: '-1' }))).toEqual({ offset: 0, limit: DEFAULT_LIMIT })
    expect(parsePagination(sp({ limit: 'abc', offset: '1.5' }))).toEqual({ offset: 0, limit: DEFAULT_LIMIT })
  })

  it('allows a zero limit (empty page) and a zero offset', () => {
    expect(parsePagination(sp({ limit: '0', offset: '0' }))).toEqual({ offset: 0, limit: 0 })
  })
})

describe('sliceIds', () => {
  it('returns only the requested window, keeping index order', () => {
    expect(sliceIds(['a', 'b', 'c', 'd', 'e'], 1, 2)).toEqual(['b', 'c'])
  })

  it('clamps past-the-end windows', () => {
    expect(sliceIds(['a', 'b'], 1, 5)).toEqual(['b'])
    expect(sliceIds(['a', 'b'], 5, 2)).toEqual([])
  })

  it('handles an empty index', () => {
    expect(sliceIds([], 0, 10)).toEqual([])
  })
})

describe('isDefaultPage', () => {
  it('is true when neither limit nor offset is present', () => {
    expect(isDefaultPage(sp())).toBe(true)
  })

  it('is false when either param is present', () => {
    expect(isDefaultPage(sp({ limit: '10' }))).toBe(false)
    expect(isDefaultPage(sp({ offset: '5' }))).toBe(false)
  })
})
