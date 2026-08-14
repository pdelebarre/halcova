// Minimal client-side gameplay ledger (Gamification release 1.2 — consumed by
// 1.3's Crate Quiz). XP/levels/badges derive IDEMPOTENTLY from item state +
// this ledger (never incremented in render); the ledger only ever holds
// *event-derived* XP that item state alone can't reconstruct — quiz results
// today, quest rewards in Phase 2. If the ledger is absent, quiz XP is 0 and
// stays 0 (the progression engine never blocks on the 1.3 quiz UI existing).
//
// Keys are per collection kind (`runout.gamif.ledger.<kind>`) so records and
// books keep independent progression. Every function is try/catch-guarded and
// never throws — a full or broken localStorage must never dark-screen the app
// (there is no error boundary). Pure-ish (localStorage only), unit-tested in
// src/utils/progressionLedger.test.js.

const KEY = (kind) => `runout.gamif.ledger.${kind}`

const QUIZ_XP_PER_CORRECT = 10

function readRaw(kind) {
  try {
    const raw = localStorage.getItem(KEY(kind))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeRaw(kind, data) {
  try {
    localStorage.setItem(KEY(kind), JSON.stringify(data))
  } catch { /* never throw (e.g. storage full) */ }
}

/**
 * Read the ledger for a kind. Always returns a well-shaped object — never
 * throws and never returns undefined.
 */
export function readLedger(kind = 'records') {
  const data = readRaw(kind)
  const quizXp = Number(data.quizXp)
  return {
    quizXp: Number.isFinite(quizXp) && quizXp > 0 ? Math.floor(quizXp) : 0,
    perfectDays: Array.isArray(data.perfectDays) ? data.perfectDays.filter((d) => typeof d === 'string') : [],
    quizDays: Array.isArray(data.quizDays) ? data.quizDays.filter((d) => typeof d === 'string') : [],
  }
}

/** Merge a patch into the ledger and return the new read. Never throws. */
export function writeLedger(kind, patch = {}) {
  writeRaw(kind, { ...readRaw(kind), ...patch })
  return readLedger(kind)
}

/** Add quiz XP to a kind's ledger. Returns the new total. */
export function addQuizXp(kind, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0))
  const current = readLedger(kind)
  writeLedger(kind, { quizXp: current.quizXp + n })
  return current.quizXp + n
}

/**
 * Record one quiz round (used by release 1.3). Grants +10 XP per correct
 * answer, appends the local day key to `quizDays`, and tracks a perfect day
 * (all correct, non-zero total) in `perfectDays` — the data "Quiz Whiz" badge
 * will consume in 1.3. Safe to call with partial/absent args.
 */
export function recordQuizResult(kind, { day = null, correct = 0, total = 0 } = {}) {
  const c = Math.max(0, Math.floor(Number(correct) || 0))
  const tot = Math.max(0, Math.floor(Number(total) || 0))
  const current = readLedger(kind)
  const quizXp = current.quizXp + c * QUIZ_XP_PER_CORRECT
  const perfectDays = day && tot > 0 && c === tot && !current.perfectDays.includes(day)
    ? [...current.perfectDays, day]
    : current.perfectDays
  const quizDays = day && !current.quizDays.includes(day)
    ? [...current.quizDays, day]
    : current.quizDays
  writeLedger(kind, { quizXp, perfectDays, quizDays })
  return readLedger(kind)
}
