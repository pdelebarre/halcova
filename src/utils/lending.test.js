import { describe, expect, it } from 'vitest'
import { isOverdue, toLocalDate } from './lending'

const DAY = 24 * 60 * 60 * 1000

function bareLocalDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('toLocalDate', () => {
  it('parses a bare YYYY-MM-DD as local midnight', () => {
    const d = toLocalDate('2026-08-15')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7) // August is 0-indexed
    expect(d.getDate()).toBe(15)
  })

  it('parses a full ISO timestamp', () => {
    const d = toLocalDate('2026-08-15T10:00:00Z')
    expect(d.getTime()).toBe(new Date('2026-08-15T10:00:00Z').getTime())
  })
})

describe('isOverdue', () => {
  it('is not overdue while the due date is today (day-granularity, local)', () => {
    expect(isOverdue(bareLocalDate(0))).toBe(false)
  })

  it('is overdue once the due date is strictly before today', () => {
    expect(isOverdue(bareLocalDate(-30))).toBe(true)
  })

  it('is not overdue for a future due date', () => {
    expect(isOverdue(bareLocalDate(30))).toBe(false)
    expect(isOverdue(new Date(Date.now() + 30 * DAY).toISOString())).toBe(false)
  })

  it('returns false (never throws) for missing or malformed values', () => {
    expect(isOverdue(undefined)).toBe(false)
    expect(isOverdue('')).toBe(false)
    expect(isOverdue('not-a-date')).toBe(false)
  })
})
