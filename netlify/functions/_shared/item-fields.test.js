// @vitest-environment node
//
// Tests for the collection item field allowlist + schema validation
// (SEC-EPIC-2 #188 mass-assignment defense, SEC-EPIC-3 #194 input validation).

import { describe, expect, it } from 'vitest'
import { ITEM_FIELD_ALLOWLIST, ITEM_PROTECTED_FIELDS, pickItemFields, validateItem } from './item-fields'

describe('pickItemFields — allowlist (SEC-EPIC-2 #188)', () => {
  it('keeps only allowlisted fields and drops protected identity/privilege fields', () => {
    const out = pickItemFields({
      title: 'A - B',
      year: 2020,
      ownerId: 'owner',
      userId: 'u1',
      role: 'admin',
      plan: 'unlimited',
      id: 'forged',
      code: 'RU-X',
      notes: 'ok',
    })
    expect(out).toEqual({ title: 'A - B', year: 2020, notes: 'ok' })
    expect(out.ownerId).toBeUndefined()
    expect(out.id).toBeUndefined()
  })

  it('yields an empty object for junk / non-objects', () => {
    expect(pickItemFields(null)).toEqual({})
    expect(pickItemFields('x')).toEqual({})
    expect(pickItemFields([1, 2])).toEqual({})
  })

  it('exposes the protected-field list for the negative tests', () => {
    expect(ITEM_PROTECTED_FIELDS.has('ownerId')).toBe(true)
    expect(ITEM_PROTECTED_FIELDS.has('role')).toBe(true)
    expect(ITEM_FIELD_ALLOWLIST.has('title')).toBe(true)
  })
})

describe('validateItem — schema validation (SEC-EPIC-3 #194)', () => {
  it('accepts a valid full item and trims string values', () => {
    const { item, error } = validateItem({ title: '  A - B  ', year: 2020, wishlist: true })
    expect(error).toBeUndefined()
    expect(item.title).toBe('A - B')
    expect(item.year).toBe(2020)
  })

  it('rejects a missing title with REQUIRED', () => {
    expect(validateItem({ year: 2020 }).error.code).toBe('REQUIRED')
  })

  it('rejects a title that is not a string (type mismatch)', () => {
    expect(validateItem({ title: 42 }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects an over-length notes field', () => {
    expect(validateItem({ title: 'A', notes: 'x'.repeat(6000) }).error.code).toBe('TOO_LONG')
  })

  it('rejects an out-of-range year', () => {
    expect(validateItem({ title: 'A', year: 999 }).error.code).toBe('OUT_OF_RANGE')
  })

  it('rejects a non-boolean wishlist', () => {
    expect(validateItem({ title: 'A', wishlist: 'yes' }).error.code).toBe('TYPE_ERROR')
  })

  it('a partial (PUT) patch may omit title but still validates the present fields', () => {
    const { item, error } = validateItem({ notes: 'x' }, { partial: true })
    expect(error).toBeUndefined()
    expect(item.notes).toBe('x')
    // A type-mismatch in a partial patch is still rejected.
    expect(validateItem({ year: 'nope' }, { partial: true }).error.code).toBe('TYPE_ERROR')
  })
})
