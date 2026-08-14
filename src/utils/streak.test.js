import { describe, expect, it } from 'vitest'
import { currentStreak, dayDiff, toLocalDayKey } from './streak'

// A fixed "today" so tests are deterministic regardless of when they run.
// Local June 15, 2026 → day key '2026-06-15'.
const TODAY = new Date(2026, 5, 15)

describe('toLocalDayKey', () => {
  it('turns an ISO timestamp into the local calendar day', () => {
    expect(toLocalDayKey('2026-06-15T12:30:00')).toBe('2026-06-15')
    expect(toLocalDayKey('2026-06-15T23:59:59')).toBe('2026-06-15')
  })

  it('accepts a bare YYYY-MM-DD as local midnight', () => {
    expect(toLocalDayKey('2026-06-15')).toBe('2026-06-15')
  })

  it('returns null for garbage input', () => {
    expect(toLocalDayKey('')).toBeNull()
    expect(toLocalDayKey('nope')).toBeNull()
    expect(toLocalDayKey(null)).toBeNull()
    expect(toLocalDayKey(undefined)).toBeNull()
  })
})

describe('dayDiff', () => {
  it('counts whole calendar days between keys', () => {
    expect(dayDiff('2026-06-15', '2026-06-14')).toBe(1)
    expect(dayDiff('2026-06-15', '2026-06-15')).toBe(0)
    expect(dayDiff('2026-06-13', '2026-06-15')).toBe(-2)
  })

  it('returns null for malformed keys', () => {
    expect(dayDiff('2026-06-15', 'nope')).toBeNull()
  })
})

describe('currentStreak', () => {
  it('returns a zero, inactive streak for no play days', () => {
    expect(currentStreak([], { today: TODAY })).toEqual({
      streak: 0,
      lastDay: null,
      today: '2026-06-15',
      active: false,
    })
  })

  it('counts today as a 1-day active streak', () => {
    const r = currentStreak(['2026-06-15'], { today: TODAY })
    expect(r.streak).toBe(1)
    expect(r.active).toBe(true)
    expect(r.lastDay).toBe('2026-06-15')
  })

  it('counts consecutive days (today + yesterday)', () => {
    const r = currentStreak(['2026-06-15', '2026-06-14'], { today: TODAY })
    expect(r.streak).toBe(2)
    expect(r.active).toBe(true)
  })

  it('forgives a single missed day inside the run (grace=1)', () => {
    // Played today and 2 days ago — one day skipped in between.
    const r = currentStreak(['2026-06-15', '2026-06-13'], { today: TODAY })
    expect(r.streak).toBe(2)
    expect(r.active).toBe(true)
  })

  it('stays active after a single missed day (last played 2 days ago)', () => {
    const r = currentStreak(['2026-06-13'], { today: TODAY })
    expect(r.streak).toBe(1)
    expect(r.active).toBe(true) // one missed day is forgiven
  })

  it('resets once two+ days are skipped', () => {
    const r = currentStreak(['2026-06-12'], { today: TODAY })
    expect(r.active).toBe(false)
  })

  it('stops counting at a second one-day gap', () => {
    // 13, 15, 17: 17←15 gap2 (forgiven) → streak 2; 15←13 gap2 (2nd) → stop.
    const r = currentStreak(['2026-06-17', '2026-06-15', '2026-06-13'], { today: new Date(2026, 5, 17) })
    expect(r.streak).toBe(2)
  })

  it('honors grace=0 (a single missed day resets)', () => {
    const r = currentStreak(['2026-06-15', '2026-06-13'], { today: TODAY, grace: 0 })
    expect(r.streak).toBe(1)
  })

  it('accepts ISO timestamps and de-dupes same-day plays', () => {
    const r = currentStreak(
      ['2026-06-15T08:00:00', '2026-06-15T20:00:00', '2026-06-14T12:00:00'],
      { today: TODAY },
    )
    expect(r.streak).toBe(2)
    expect(r.active).toBe(true)
  })
})
