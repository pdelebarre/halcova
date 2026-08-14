// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeCode } from './codes'

describe('normalizeCode', () => {
  it('uppercases and trims a code so lookups ignore how it was typed', () => {
    expect(normalizeCode('  ru-abcd-efgh-ijkl  ')).toBe('RU-ABCD-EFGH-IJKL')
  })

  it('is a no-op on an already-normalized stored code', () => {
    expect(normalizeCode('RU-ABCD-EFGH-IJKL')).toBe('RU-ABCD-EFGH-IJKL')
  })

  it('handles falsy / missing values without throwing', () => {
    expect(normalizeCode('')).toBe('')
    expect(normalizeCode(null)).toBe('')
    expect(normalizeCode(undefined)).toBe('')
  })
})
