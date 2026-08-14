// Progression engine (Gamification release 1.2, issue #45) — XP / levels /
// badges. Mirrors persona.js: pure, side-effect-free, unit-tested, and
// parameterized by catalog (records "crate" / books "shelf").
//
// IDEMPOTENT BY CONSTRUCTION: XP, levels, and badges are a PURE FUNCTION of the
// current collection + the client-side ledger (progressionLedger.js). Nothing
// is incremented in render — the same inputs always produce the same output
// (requirements §7.2).
//
// XP derivation (requirements §7.1, adapted to Phase-0 data — there is NO
// event log, docs/gamification-phase0.md §3 #2):
//   +10 per owned non-wishlist item   (the add-vs-manual distinction isn't
//       stored anywhere, so every owned item counts as one add — documented
//       here per the 1.2 task)
//   +5  per item with non-empty notes (notes-written XP)
//   +15 once, first lend              (any item with lending history, or
//       currently out — lending is embedded on the item blob, Phase 0 §3 #4)
//   quiz XP from the client-side ledger (0 if absent — never blocks on the
//       1.3 quiz UI existing)
//
// Levels: per-kind ladders from copy-bank.md §4 — records: Crate Sprout → …
// → Crate Deity; books: Page Turner → … → Shelf Sovereign. copy-bank gives the
// ladder NAMES but not the numbers, so the XP thresholds are defined here and
// chosen to be reachable with real usage (10 owned items → L2, 30 → L3, 75 →
// L4, 150 → L5 — roughly a dedicated collector's first months).
//
// Badges (copy-bank.md §5) — auto-checked against the collection + ledger.
// Implemented badges use ONLY derivable data. SKIPPED / DEFERRED badges, each
// documented (Phase-0 data-source justification):
//   - completist      — "full artist discography" needs an artist's full
//                       release list, which needs the Discogs artist endpoint
//                       (Phase 0 §3 #1 — it does not exist). Deferred.
//   - balanced-diet   — "records AND books" needs BOTH kinds' items; the
//                       per-kind Play surface only has the current kind
//                       (cross-kind wiring is a Phase 2 concern). Deferred.
//   - quiz-whiz       — "perfect quiz day" needs a perfect-day record; the
//                       quiz is release 1.3 (not built). The ledger
//                       (progressionLedger.js) already tracks perfectDays so
//                       1.3 can flip this on. Deferred.
//
// GUARDS: missing year/genre/pageCount/lendingHistory/notes/dateAdded must
// never throw. Empty collections yield level 1 + zero XP + no unlocked badges.

import { deriveProfile } from './persona'

export const OWNED_XP = 10
export const NOTES_XP = 5
export const FIRST_LEND_XP = 15
export const QUIZ_XP_PER_CORRECT = 10

// copy-bank.md §4 ladders, one shared threshold set (kind-neutral) so records
// and books progress at the same pace. [0, 100, 300, 750, 1500] XP.
export const LEVEL_THRESHOLDS = [0, 100, 300, 750, 1500]

// --- XP ------------------------------------------------------------------

/**
 * Idempotent XP from the current collection + ledger. Never increments state.
 *
 * @param {Array<object>} items - the owned client collection model
 * @param {{kind?: string}} catalog - records/books catalog
 * @param {{quizXp?: number}} [ledger] - the client-side gameplay ledger
 * @returns {{total: number, breakdown: {owned:number, notes:number, firstLend:number, quizXp:number}}}
 */
export function computeXp(items, catalog, ledger = {}) {
  const list = Array.isArray(items) ? items : []
  let owned = 0
  let notes = 0
  let lent = false

  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    owned += 1
    if (String(it.notes || '').trim()) notes += 1
    // First lend: history exists, or the item is currently out.
    if (Array.isArray(it.lendingHistory) && it.lendingHistory.length > 0) lent = true
    if (it.lending?.lentOn) lent = true
  }

  const quizXp = Math.max(0, Math.floor(Number(ledger?.quizXp) || 0))
  const firstLend = lent ? 1 : 0
  const total = owned * OWNED_XP + notes * NOTES_XP + firstLend * FIRST_LEND_XP + quizXp

  return {
    total,
    breakdown: { owned, notes, firstLend, quizXp },
  }
}

// --- Levels --------------------------------------------------------------

/**
 * Map total XP to a level. `copy` is the catalog's
 * `copy.gamif.progression` (provides `levels` = [{ title, toast }] in order).
 *
 * @returns {{level: number, title: string, toast: string, xp: number, nextThreshold: number|null, progress: number}}
 *   `nextThreshold` is null at max level; `progress` is 0–1 toward the next
 *   level (1 at max).
 */
export function computeLevel(xp, copy = {}) {
  const total = Math.max(0, Math.floor(Number(xp) || 0))
  const levels = Array.isArray(copy?.levels) ? copy.levels : []

  let index = 0
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i += 1) {
    if (total >= LEVEL_THRESHOLDS[i]) index = i
  }

  const level = index + 1
  const floor = LEVEL_THRESHOLDS[index]
  const cap = LEVEL_THRESHOLDS[index + 1] ?? null
  const title = levels[index]?.title || `Level ${level}`
  const toast = levels[index]?.toast || ''

  let progress = 1
  if (cap != null && cap > floor) {
    progress = Math.min(1, Math.max(0, (total - floor) / (cap - floor)))
  }

  return { level, title, toast, xp: total, nextThreshold: cap, progress }
}

// --- Badges --------------------------------------------------------------

function hasReturnedLend(items) {
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue
    if (Array.isArray(it.lendingHistory) && it.lendingHistory.some((h) => h?.returnedOn)) return true
  }
  return false
}

// Every badge the app knows about. `threshold` receives the derived profile
// (see persona.deriveProfile). `deferred` badges are documented, honest gaps
// (see header comment) — the grid renders them as "coming soon", never as
// unlockable-today, so there are no impossible badges (requirements §7.3).
export const BADGE_DEFS = [
  { id: 'digger', kinds: ['records'], threshold: (d) => d.count >= 50 },
  { id: 'pageturner', kinds: ['books'], threshold: (d) => d.count >= 25 },
  { id: 'genre-tourist', kinds: ['records', 'books'], threshold: (d) => d.genreCount >= 10 },
  { id: 'time-traveler', kinds: ['records', 'books'], threshold: (d) => d.decadeCount >= 5 },
  { id: 'impulse-buyer', kinds: ['records', 'books'], threshold: (d) => d.oneDayBurst >= 10 },
  { id: 'sleeve-sleuth', kinds: ['records', 'books'], threshold: (d) => d.notesCount >= 10 },
  { id: 'one-timer', kinds: ['records', 'books'], threshold: (d) => d.maxByArtist === 1 && d.count >= 4 },
  { id: 'variant-hoarder', kinds: ['records', 'books'], threshold: (d) => d.pressingsOfOne >= 2 },
  { id: 'friend-of-crate', kinds: ['records', 'books'], threshold: (d) => hasReturnedLend(d._items) },
  // Deferred (documented in the header comment).
  { id: 'completist', kinds: ['records', 'books'], deferred: true, reason: 'needs the Discogs artist-discography endpoint (Phase 0 §3 #1 — does not exist)' },
  { id: 'balanced-diet', kinds: ['records', 'books'], deferred: true, reason: 'needs both kinds’ items; the per-kind Play surface has only the current kind (Phase 2 wiring)' },
  { id: 'quiz-whiz', kinds: ['records', 'books'], deferred: true, reason: 'needs a perfect quiz day — the quiz is release 1.3 (ledger already tracks perfectDays)' },
]

/**
 * Check every badge against the collection. Returns the full badge list for
 * the kind (implemented + deferred), each `{ id, title, line, unlocked,
 * deferred, reason? }`.
 *
 * @param {Array<object>} items
 * @param {{kind?: string, copy?: object}} catalog
 */
export function computeBadges(items, catalog) {
  const kind = catalog?.kind === 'books' ? 'books' : 'records'
  const list = Array.isArray(items) ? items : []
  const derived = deriveProfile(list, kind)
  // hasReturnedLend needs the raw items (the profile doesn't track lends).
  derived._items = list
  const badgeCopy = catalog?.copy?.gamif?.badges || {}

  const results = []
  for (const def of BADGE_DEFS) {
    if (!def.kinds.includes(kind)) continue
    const copy = badgeCopy[def.id] || {}
    if (def.deferred) {
      results.push({
        id: def.id,
        title: copy.name || def.id,
        line: copy.line || '',
        unlocked: false,
        deferred: true,
        reason: def.reason,
      })
      continue
    }
    results.push({
      id: def.id,
      title: copy.name || def.id,
      line: copy.line || '',
      unlocked: Boolean(def.threshold(derived)),
      deferred: false,
    })
  }
  return results
}

// --- Bundle --------------------------------------------------------------

/**
 * Everything the Progression panel needs in one idempotent call.
 *
 * @returns {{kind: string, xp: object, level: object, badges: Array<object>}}
 */
export function computeProgression(items, catalog, opts = {}) {
  const kind = catalog?.kind === 'books' ? 'books' : 'records'
  const progCopy = catalog?.copy?.gamif?.progression || {}
  const ledger = opts.ledger || {}
  const xp = computeXp(items, catalog, ledger)
  const level = computeLevel(xp.total, progCopy)
  const badges = computeBadges(items, catalog)
  return { kind, xp, level, badges }
}
