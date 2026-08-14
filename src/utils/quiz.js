// Crate Quiz engine (Gamification release 1.3, issue #50) — mirrors match.js /
// persona.js / stories.js: pure, side-effect-free, unit-tested. Given the owned
// collection it deals 3–5 questions a day, SEEDED BY THE LOCAL DAY so the same
// collection + the same day ALWAYS yields the same quiz (requirements §4.1;
// Phase 0 §3 #3 resolved streak/quiz boundaries to local device time).
//
// Question types (all offline, all from the member's OWN items, copy-bank §3):
//   - guessYear       cover + two years (one correct)
//   - nameThatArtist  cover + three artists (decoys = other artists you own)
//   - newestOrOldest  two items, "which did you add first?" (uses dateAdded)
//   - stillYours      a cover, "do you still own this?" (yes/no — always yes)
//   - sortShelf       order three items by year (only when >=3 distinct years)
//
// DATA SUFFICIENCY (requirements §4.2): every type draws ONLY from a pool that
// has the fields it needs, so a question is never proposed on insufficient
// data — items missing coverImage/year/dateAdded are excluded from the pools
// that need them. A collection under 3 items is LOCKED (the caller shows the
// "scan a few more first" state). Never throws — the no-error-boundary app
// must never dark-screen on a weird item shape.
//
// LEAK SAFETY: question payloads carry item ids + cover URLs + option labels
// only — full item objects (with barcodes/ISBNs/access codes) are never
// serialized into the payload. The teaching reveal needs the item's dateAdded
// + notes, so those are included ONLY inside each question's `reveal` (shown
// on a miss), never anywhere else.
//
// Copy comes in via catalog.copy.gamif.quiz (prompts, yes/no, reveal
// templates) so the engine stays pure and unit-testable.

import { splitArtistTitle } from './match'
import { toLocalDayKey } from './streak'

export const MIN_ITEMS = 3
const QUESTION_MIN = 3
const QUESTION_MAX = 5

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// --- deterministic PRNG --------------------------------------------------
// A tiny string hash (FNV-1a-style) + mulberry32 gives a reproducible stream:
// same (dayKey, kind) → same seed → same questions all day, no external
// randomness that could break the "stable within a day" contract.

function hashSeed(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.codePointAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a) {
  return function next() {
    a = Math.trunc(a)
    a = Math.trunc(a + 0x6D2B79F5)
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- small pure helpers --------------------------------------------------

function clean(value) {
  return String(value ?? '').trim()
}

function toYear(value) {
  const y = Number(value)
  return Number.isFinite(y) && y > 0 ? Math.floor(y) : null
}

function hasCover(it) {
  return Boolean(clean(it?.coverImage))
}

function hasValidDate(it) {
  const d = new Date(it?.dateAdded)
  return !Number.isNaN(d.getTime())
}

function artistOf(it) {
  return splitArtistTitle(it?.title).artist
}

/** The display title of an item — its album name, falling back to the full title. */
function albumTitle(it) {
  const { album } = splitArtistTitle(it?.title)
  return album || clean(it?.title)
}

/** pick a random element (rng-driven) */
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

/** Fisher–Yates shuffle driven by the seeded rng (not Math.random). */
function shuffle(rng, arr) {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/**
 * The human-readable reveal date for an item: "March 2024", or '' when the
 * dateAdded can't be parsed (the caller then shows the no-date variant —
 * never a fabricated date).
 */
export function revealDate(iso) {
  if (iso === null || iso === undefined || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const month = MONTH_NAMES[d.getMonth()]
  return month ? `${month} ${d.getFullYear()}` : String(d.getFullYear())
}

/** The leak-safe reveal payload for one item (title + dateAdded + notes only). */
function revealFor(it) {
  return {
    itemId: it?.id ?? '',
    title: albumTitle(it),
    dateAdded: typeof it?.dateAdded === 'string' ? it.dateAdded : '',
    notes: typeof it?.notes === 'string' ? it.notes : '',
  }
}

/** Pick an unused item from the pool when possible (falls back to any). */
function pickUnused(rng, pool, used) {
  const fresh = pool.filter((it) => !used.has(it.id))
  const chosen = fresh.length > 0 ? pick(rng, fresh) : pick(rng, pool)
  used.add(chosen.id)
  return chosen
}

/** Distinct artists across the collection, excluding `exclude` (case-insensitive). */
function otherArtists(items, exclude) {
  const seen = new Set()
  const ex = clean(exclude).toLowerCase()
  for (const it of items) {
    const a = artistOf(it)
    if (a && a.toLowerCase() !== ex) seen.add(a)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** Distinct years across the collection (numbers). */
function distinctYears(items) {
  const set = new Set()
  for (const it of items) {
    const y = toYear(it?.year)
    if (y !== null) set.add(y)
  }
  return [...set].sort((a, b) => a - b)
}

/** Display label for a newestOrOldest option — disambiguates colliding albums. */
function optionLabel(it, other) {
  const a = albumTitle(it)
  const b = albumTitle(other)
  if (a && b && a !== b) return a
  const y = toYear(it?.year)
  return y !== null ? `${a || clean(it?.title)} (${y})` : clean(it?.title)
}

// --- per-type builders ---------------------------------------------------
// Each builder returns a leak-safe question for its pool (or null when the
// pool can't serve it). The `used` set accumulates item ids so questions try
// not to repeat the same item.

function buildGuessYear(rng, pool, yearPool, used, copy) {
  if (pool.length === 0) return null
  const item = pickUnused(rng, pool, used)
  const year = toYear(item.year)
  const others = distinctYears(yearPool).filter((y) => y !== year)
  let decoy
  if (others.length > 0) {
    decoy = pick(rng, others)
  } else {
    decoy = rng() < 0.5 ? year - 1 : year + 1
  }
  const options = shuffle(rng, [String(year), String(decoy)])
  return {
    type: 'guessYear',
    prompt: copy.questions?.guessYear || 'Which year is this from?',
    itemId: item.id,
    cover: item.coverImage || '',
    options,
    answerIndex: options.indexOf(String(year)),
    // The reveal carries the correct year so a miss can state the real answer
    // in text — never just the gold-vs-danger border (a11y + teaching goal).
    reveal: { ...revealFor(item), year },
  }
}

function buildNameThatArtist(rng, coverPool, items, used, copy) {
  const candidates = coverPool.filter((it) => {
    const a = artistOf(it)
    return Boolean(a) && otherArtists(items, a).length >= 2
  })
  if (candidates.length === 0) return null
  const item = pickUnused(rng, candidates, used)
  const correct = artistOf(item)
  const decoys = shuffle(rng, otherArtists(items, correct)).slice(0, 2)
  const options = shuffle(rng, [correct, ...decoys])
  return {
    type: 'nameThatArtist',
    prompt: copy.questions?.nameThatArtist || "Who's behind this cover?",
    itemId: item.id,
    cover: item.coverImage || '',
    options,
    answerIndex: options.indexOf(correct),
    reveal: revealFor(item),
  }
}

function buildNewestOldest(rng, datePool, used, copy) {
  if (datePool.length < 2) return null
  const sorted = [...datePool].sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
  // Find a random earlier item and a later item with a strictly different date.
  const start = Math.floor(rng() * sorted.length)
  let earlier = null
  let later = null
  for (let offset = 0; offset < sorted.length; offset += 1) {
    const a = sorted[(start + offset) % sorted.length]
    for (let k = sorted.length - 1; k >= 0; k -= 1) {
      const b = sorted[k]
      if (b.dateAdded !== a.dateAdded) {
        const [lo, hi] = new Date(a.dateAdded) <= new Date(b.dateAdded) ? [a, b] : [b, a]
        earlier = lo
        later = hi
        break
      }
    }
    if (earlier) break
  }
  if (!earlier) return null
  used.add(earlier.id)
  used.add(later.id)
  const options = shuffle(rng, [optionLabel(earlier, later), optionLabel(later, earlier)])
  return {
    type: 'newestOrOldest',
    prompt: copy.questions?.newestOrOldest || 'Which did you add first?',
    itemIds: [earlier.id, later.id],
    covers: [earlier.coverImage || '', later.coverImage || ''],
    options,
    answerIndex: options.indexOf(optionLabel(earlier, later)),
    reveal: revealFor(earlier),
  }
}

function buildStillYours(rng, coverPool, used, copy) {
  if (coverPool.length === 0) return null
  const item = pickUnused(rng, coverPool, used)
  const yes = copy.yes || 'Yes'
  const no = copy.no || 'No'
  const options = shuffle(rng, [yes, no])
  return {
    type: 'stillYours',
    prompt: copy.questions?.stillYours || 'Do you still own this?',
    itemId: item.id,
    cover: item.coverImage || '',
    options,
    answerIndex: options.indexOf(yes), // correct is always "yes" — the gag
    reveal: revealFor(item),
  }
}

function buildSortShelf(rng, yearPool, used, copy) {
  const years = distinctYears(yearPool)
  if (years.length < 3) return null
  const chosenYears = shuffle(rng, years).slice(0, 3)
  const chosen = chosenYears.map((y) => yearPool.find((it) => toYear(it.year) === y))
  const ordered = [...chosen].sort((a, b) => toYear(a.year) - toYear(b.year))
  ordered.forEach((it) => used.add(it.id))
  const options = shuffle(rng, chosen.map((it) => ({ itemId: it.id, title: albumTitle(it), cover: it.coverImage || '' })))
  return {
    type: 'sortShelf',
    prompt: copy.questions?.sortShelf || 'Put these in year order.',
    itemIds: ordered.map((it) => it.id),
    options,
    answerIds: ordered.map((it) => it.id),
    reveal: {
      ...revealFor(ordered[0]),
      ordered: ordered.map((it) => ({ itemId: it.id, title: albumTitle(it), year: toYear(it.year) })),
    },
  }
}

// --- public API ----------------------------------------------------------

/**
 * Build the day's quiz. Same collection + same local day → the same 3–5
 * questions, deterministically (seeded by dayKey + kind).
 *
 * @param {Array<object>} items - the owned client collection model
 * @param {{day?: string|Date|number, rng?: () => number, catalog?: object}} [opts]
 *   `day` is any value toLocalDayKey understands (default: now). `rng` injects
 *   a deterministic PRNG for tests. `catalog` supplies kind + quiz copy.
 * @returns {{locked: boolean, day: string|null, questions: Array<object>}}
 *   `locked` is true below 3 items (caller shows the "scan a few more first"
 *   state). Questions are leak-safe (ids + covers + option labels only).
 */
export function buildQuiz(items, { day = new Date(), rng, catalog } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object')
  const dayKey = toLocalDayKey(day)
  if (list.length < MIN_ITEMS) {
    return { locked: true, day: dayKey, questions: [] }
  }

  const kind = catalog?.kind === 'books' ? 'books' : 'records'
  const copy = catalog?.copy?.gamif?.quiz || {}
  const rand = rng || mulberry32(hashSeed(`${dayKey || 'unknown'}|${kind}`))

  // Pools — each type only ever draws from the pool that has its fields.
  const pools = {
    coverPool: list.filter(hasCover),
    yearPool: list.filter((it) => toYear(it?.year) !== null),
    datePool: list.filter(hasValidDate),
    coverYearPool: coverPool(list),
  }

  const used = new Set()
  const questions = assembleQuiz(collectBuilders(rand, pools, list, used, copy), rand)

  // Pad to a minimum of 3 from repeatable types (stillYours / guessYear /
  // newestOrOldest) so a quiz is never shorter than 3 questions.
  const repeatable = repeatableBuilders(rand, pools, used, copy)
  let padIndex = 0
  while (questions.length < QUESTION_MIN && repeatable.length > 0) {
    const q = repeatable[padIndex % repeatable.length]()
    if (q) questions.push(q)
    padIndex += 1
  }

  return { locked: false, day: dayKey, questions: questions.slice(0, QUESTION_MAX) }
}

/** The cover-year pool (items that have BOTH a cover and a year). */
function coverPool(list) {
  return list.filter((it) => hasCover(it) && toYear(it?.year) !== null)
}

/** Collect one builder per data-sufficient question type (shuffled later). */
function collectBuilders(rand, pools, list, used, copy) {
  const { coverPool: covers, yearPool, datePool } = pools
  const builders = []
  if (pools.coverYearPool.length >= 1) builders.push(() => buildGuessYear(rand, pools.coverYearPool, yearPool, used, copy))
  if (covers.length >= 1) builders.push(() => buildNameThatArtist(rand, covers, list, used, copy))
  if (datePool.length >= 2) builders.push(() => buildNewestOldest(rand, datePool, used, copy))
  if (covers.length >= 1) builders.push(() => buildStillYours(rand, covers, used, copy))
  if (distinctYears(yearPool).length >= 3) builders.push(() => buildSortShelf(rand, yearPool, used, copy))
  return builders
}

/** Repeatable builders used to pad a quiz up to the 3-question minimum. */
function repeatableBuilders(rand, pools, used, copy) {
  const { coverPool: covers, yearPool, datePool } = pools
  const repeatable = []
  if (covers.length >= 1) repeatable.push(() => buildStillYours(rand, covers, used, copy))
  if (pools.coverYearPool.length >= 1) repeatable.push(() => buildGuessYear(rand, pools.coverYearPool, yearPool, used, copy))
  if (datePool.length >= 2) repeatable.push(() => buildNewestOldest(rand, datePool, used, copy))
  return repeatable
}

/** Shuffle the available types, roll a deterministic 3–5 count, and build. */
function assembleQuiz(builders, rand) {
  const order = shuffle(rand, builders)
  const count = order.length >= QUESTION_MIN
    ? Math.max(QUESTION_MIN, Math.min(order.length, QUESTION_MIN + Math.floor(rand() * (QUESTION_MAX - QUESTION_MIN + 1))))
    : order.length
  const questions = []
  for (let i = 0; i < Math.min(count, order.length); i += 1) {
    const q = order[i]()
    if (q) questions.push(q)
  }
  return questions
}

/**
 * Grade an answer against a question.
 *
 * @param {object} question - a question from buildQuiz
 * @param {number|Array<string>} selection - option index (choice questions) or
 *   the tapped order of item ids (sortShelf)
 * @returns {{correct: boolean}}
 */
export function gradeAnswer(question, selection) {
  if (!question || typeof question !== 'object') return { correct: false }

  if (question.type === 'sortShelf') {
    const ans = (Array.isArray(question.answerIds) ? question.answerIds : []).map(String)
    if (ans.length === 0) return { correct: false }
    const sel = Array.isArray(selection) ? selection.map(String) : []
    return { correct: sel.length === ans.length && sel.every((id, i) => id === ans[i]) }
  }

  const idx = Number(selection)
  return { correct: Number.isInteger(idx) && idx >= 0 && idx === question.answerIndex }
}
