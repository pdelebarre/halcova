// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ownedCountOf, nextOwnedCount, wishlistToggleDelta } from './counts'

describe('ownedCountOf', () => {
  it('counts only non-wishlist items — wishlist wants never consume the cap', () => {
    const items = [{ wishlist: false }, { wishlist: true }, { id: 'x' }, null]
    expect(ownedCountOf(items)).toBe(2)
  })

  it('handles an empty list', () => {
    expect(ownedCountOf([])).toBe(0)
  })
})

describe('nextOwnedCount', () => {
  it('adds the delta', () => {
    expect(nextOwnedCount(9, 1)).toBe(10)
  })

  it('clamps at zero so a wishlist toggle can never go negative', () => {
    expect(nextOwnedCount(0, -1)).toBe(0)
  })

  it('treats a missing count as zero', () => {
    expect(nextOwnedCount(null, 1)).toBe(1)
  })
})

describe('wishlistToggleDelta', () => {
  it('returns zero when the patch does not touch wishlist (notes/rating edits)', () => {
    expect(wishlistToggleDelta({ notes: 'x' }, { wishlist: false })).toEqual({ delta: 0, toggled: false })
  })

  it('decrements when an owned item is moved to the wishlist', () => {
    expect(wishlistToggleDelta({ wishlist: true }, { wishlist: false })).toEqual({ delta: -1, toggled: true })
  })

  it('increments when a wishlist item is marked owned', () => {
    expect(wishlistToggleDelta({ wishlist: false }, { wishlist: true })).toEqual({ delta: 1, toggled: true })
  })

  it('returns zero when wishlist is set to the same value', () => {
    expect(wishlistToggleDelta({ wishlist: true }, { wishlist: true })).toEqual({ delta: 0, toggled: true })
  })

  it('treats a missing existing flag as owned', () => {
    expect(wishlistToggleDelta({ wishlist: true }, {})).toEqual({ delta: -1, toggled: true })
  })
})
