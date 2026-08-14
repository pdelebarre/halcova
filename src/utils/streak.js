// Shared daily-streak helpers (Gamification release 1.2 — the 1-day-grace
// streak mechanic itself belongs to release 1.3's Crate Quiz; this module
// provides the local-day boundary + counting helpers 1.3 will use).
//
// The streak "day" boundary is the device's LOCAL day — Phase 0 §3 #3 resolved
// local device time, matching the toLocalDate convention in src/utils/lending.js
// (a bare 'YYYY-MM-DD' parses as local midnight so we never drift a day in
// timezones behind UTC).
//
// GRACE: a single missed day does not reset the streak (requirements §2.7:
// `streakGrace = 1`). While counting back from the most recent play day, at
// most `grace` one-day gaps are forgiven; a second gap (two+ days skipped)
// ends the run. A streak is "active" while the last play day is within today
// + grace missed days — after that it has reset.
//
// Pure, never throws, unit-tested (src/utils/streak.test.js).

import { toLocalDate } from './lending'

const DAY_MS = 86400000

/**
 * The local calendar day of a value as 'YYYY-MM-DD' (or null if unparseable).
 * Accepts full ISO timestamps or bare 'YYYY-MM-DD' — both go through
 * lending.toLocalDate so the day is the user's local day.
 */
export function toLocalDayKey(value) {
  try {
    const d = toLocalDate(value)
    if (Number.isNaN(d.getTime())) return null
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return null
  }
}

function keyToUtcMs(key) {
  const parts = String(key || '').split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return Number.NaN
  return Date.UTC(parts[0], parts[1] - 1, parts[2])
}

/**
 * Whole calendar days from `b` to `a` (a - b). Both must be 'YYYY-MM-DD'
 * keys. Returns null for malformed input. Day arithmetic uses UTC on the key
 * parts so DST shifts can never add/remove a day.
 */
export function dayDiff(a, b) {
  const ak = keyToUtcMs(a)
  const bk = keyToUtcMs(b)
  if (Number.isNaN(ak) || Number.isNaN(bk)) return null
  return Math.round((ak - bk) / DAY_MS)
}

/**
 * The current streak from a list of play days.
 *
 * @param {Array<string|Date|number>} playDays - day keys ('YYYY-MM-DD') or any
 *   value toLocalDayKey understands (e.g. ISO `dateAdded`).
 * @param {{today?: Date, grace?: number}} [opts] - `today` injects "now" for
 *   deterministic tests; `grace` is the number of single missed days forgiven
 *   (default 1).
 * @returns {{streak: number, lastDay: string|null, today: string|null, active: boolean}}
 */
export function currentStreak(playDays, { today = new Date(), grace = 1 } = {}) {
  const graceMax = Math.max(0, Number(grace) || 0)
  const days = new Set()
  for (const d of Array.isArray(playDays) ? playDays : []) {
    const key = toLocalDayKey(d)
    if (key) days.add(key)
  }
  // ISO day keys sort chronologically lexicographically, but provide an
  // explicit compare so the sort never depends on that implementation detail.
  const sorted = [...days].sort((a, b) => a.localeCompare(b))
  if (sorted.length === 0) {
    return { streak: 0, lastDay: null, today: toLocalDayKey(today), active: false }
  }

  const lastDay = sorted[sorted.length - 1]
  const todayKey = toLocalDayKey(today)
  const sinceLast = todayKey ? dayDiff(todayKey, lastDay) : null

  let streak = 1
  let graceUsed = 0
  for (let i = sorted.length - 2; i >= 0; i -= 1) {
    const gap = dayDiff(sorted[i + 1], sorted[i])
    if (gap === 1) {
      streak += 1
      continue
    }
    if (gap === 2 && graceUsed < graceMax) {
      streak += 1
      graceUsed += 1
      continue
    }
    break
  }

  // Active while the last play day is within today + `grace` missed days.
  const active = sinceLast !== null && sinceLast <= 1 + graceMax
  return { streak, lastDay, today: todayKey, active }
}
