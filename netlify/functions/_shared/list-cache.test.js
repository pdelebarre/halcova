// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isCacheFresh } from './list-cache'

describe('isCacheFresh', () => {
  it('is fresh when younger than the TTL', () => {
    expect(isCacheFresh({ ts: 0, items: [{ id: 1 }] }, 5_000, 15_000)).toBe(true)
  })

  it('is stale once the TTL elapses', () => {
    expect(isCacheFresh({ ts: 0, items: [{ id: 1 }] }, 15_000, 15_000)).toBe(false)
  })

  it('rejects malformed entries (missing ts or items)', () => {
    expect(isCacheFresh({ ts: 0 }, 0, 15_000)).toBe(false)
    expect(isCacheFresh({ items: [] }, 0, 15_000)).toBe(false)
    expect(isCacheFresh(null, 0, 15_000)).toBe(false)
  })

  it('accepts an empty items array as a valid fresh entry', () => {
    expect(isCacheFresh({ ts: 0, items: [] }, 1_000, 15_000)).toBe(true)
  })
})
