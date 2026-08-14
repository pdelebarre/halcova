// Shelf Stories engine (Gamification release 1.4, issue #44) — deterministic,
// data-grounded story cards derived ONLY from the member's OWN items. Mirrors
// persona.js: pure, side-effect-free, unit-tested, parameterized by catalog
// (records "crate" / books "shelf").
//
// DETERMINISTIC FACTS (requirements §6.1): every number is computed from the
// collection — nothing hardcoded, nothing fabricated. Same collection → same
// stories, always.
//   - year span      (min/max year + decade count)
//   - decade bias    (dominant decade, share %)
//   - total pages    (books ONLY when ≥5 items have a numeric pageCount —
//                     requirements §6.2; else omitted; records omit entirely)
//   - country mix    (records-only; books always have country === '')
//   - series         (books: shared author + title prefix via splitArtistTitle)
//   - One-Timer      (a single item by an artist — artist frequency. "Fame"
//                     can't be verified without the Discogs artist endpoint
//                     (Phase 0 §3 #1), so "well-known-in-your-collection" is
//                     read as: a 4+ item collection where this artist appears
//                     exactly once — the persona's own one-timer rule)
//   - notes coverage ("you write it down" — records)
//
// ERA LESSONS + RECOMMENDATIONS tier: recommendations are nearest-neighbor
// WITHIN the member's OWN collection — genre/style overlap with the dominant
// decade's overall mix, plus year proximity to its centroid. We NEVER claim an
// external data source (no Discogs artist endpoint; no fabricating picks from
// outside — requirements §6.3, Phase 0 §3 #1). When genre/style are absent
// (books with empty categories) we fall back to author frequency + year only.
// Small collections (< MIN_RECOMMEND items) get the FACTS tier only (§6.2).
//
// Output: an ordered list of story cards, each
//   { id, title, body, kind, actionable? }
// `actionable` marks stories with a natural quest seed (the "turn this into a
// quest" affordance — quests themselves are Phase 2).

import { splitArtistTitle } from './match'
import { deriveProfile } from './persona'

// Below this many items only the facts tier is shown (§6.2).
const MIN_RECOMMEND = 4
const RECOMMEND_LIMIT = 3

// --- small pure helpers --------------------------------------------------

function clean(value) {
  return String(value ?? '').trim()
}

function toYear(value) {
  const y = Number(value)
  return Number.isFinite(y) && y > 0 ? Math.floor(y) : null
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US')
}

/** Interpolate {token} placeholders; non-string templates yield ''. */
function interpolate(template, tokens) {
  if (typeof template !== 'string') return ''
  let out = template
  for (const [k, v] of Object.entries(tokens || {})) {
    out = out.split(`{${k}}`).join(String(v ?? ''))
  }
  return out
}

/** The most common value in a Map, with count. */
function mode(map) {
  let value = null
  let count = 0
  for (const [v, n] of map) {
    if (n > count) {
      count = n
      value = v
    }
  }
  return { value, count }
}

/** First deterministic entry (sorted) with the given count predicate. */
function firstBy(items, predicate) {
  for (const it of items) {
    if (predicate(it)) return it
  }
  return null
}

// --- per-story facts -----------------------------------------------------

function yearSpanStory(profile, copy, entity, collectionLabel) {
  const years = profile.years
  if (years.length < 2) return null
  const min = Math.min(...years)
  const max = Math.max(...years)
  const span = max - min
  const t = copy['year-span']
  if (!t) return null
  return {
    id: 'year-span',
    title: interpolate(t.title, { collectionLabel }),
    body: interpolate(t.body, { span: String(span), min: String(min), max: String(max), decades: String(profile.decadeCount), entity }),
    kind: profile.kind,
    actionable: false,
  }
}

function decadeBiasStory(derived, copy, entity) {
  const top = derived.topDecade
  if (!top || derived.count === 0) return null
  const t = copy['decade-bias']
  if (!t) return null
  const pct = Math.round((derived.topDecadePct || 0))
  const decade = top.replace('s', '')
  return {
    id: 'decade-bias',
    title: interpolate(t.title, { decade }),
    body: interpolate(t.body, { decade, n: String(derived.topDecadeCount || 0), count: String(derived.count), pct: String(pct), entity }),
    kind: derived.kind,
    actionable: true, // "fill out the {decade}s" is a natural quest seed
  }
}

/** Nearest-neighbor picks WITHIN the collection for the dominant decade. */
function decadePicks(items, decadeYear, kind) {
  const inDecade = items.filter((it) => {
    const y = toYear(it.year)
    return y !== null && Math.floor(y / 10) * 10 === decadeYear
  })
  if (inDecade.length === 0) return []

  const meanYear = inDecade.reduce((s, it) => s + toYear(it.year), 0) / inDecade.length
  const genrePool = new Set()
  const stylePool = new Set()
  const authorFreq = new Map()
  for (const it of inDecade) {
    for (const g of (Array.isArray(it.genre) ? it.genre : [])) if (clean(g)) genrePool.add(clean(g))
    for (const s of (Array.isArray(it.style) ? it.style : [])) if (clean(s)) stylePool.add(clean(s))
    const artist = splitArtistTitle(it.title).artist
    if (artist) authorFreq.set(artist, (authorFreq.get(artist) || 0) + 1)
  }

  const ranked = inDecade.map((it) => {
    const gs = new Set((Array.isArray(it.genre) ? it.genre : []).map(clean).filter(Boolean))
    const ss = new Set((Array.isArray(it.style) ? it.style : []).map(clean).filter(Boolean))
    const hasGenre = gs.size > 0
    const hasStyle = ss.size > 0
    const genreScore = hasGenre ? [...gs].filter((g) => genrePool.has(g)).length * 2 : 0
    const styleScore = hasStyle ? [...ss].filter((s) => stylePool.has(s)).length : 0
    // Books with no categories or styles fall back to author frequency + year only.
    const authorScore = kind === 'books' && !hasGenre && !hasStyle
      ? (authorFreq.get(splitArtistTitle(it.title).artist) || 0)
      : 0
    const yearDist = Math.abs(toYear(it.year) - meanYear)
    return { it, score: genreScore + styleScore + authorScore - yearDist / 10 }
  })

  ranked.sort((a, b) => b.score - a.score || (a.it.title || '').localeCompare(b.it.title || ''))
  return ranked.slice(0, RECOMMEND_LIMIT).map((r) => r.it)
}

function eraLessonStory(items, derived, copy, entity, kind) {
  if (derived.count < MIN_RECOMMEND) return null
  const top = derived.topDecade
  if (!top || /^\d{4}s$/.test(top) === false) return null
  const decadeYear = Number(top.replace('s', ''))
  const picks = decadePicks(items, decadeYear, kind)
  if (picks.length === 0) return null

  const t = copy['era-lesson']
  if (!t) return null
  // Adaptive list: only as many picks as the decade actually holds (1–3), so
  // the copy never shows empty {titleN} placeholders.
  const closest = picks
    .map((p) => {
      const { album } = splitArtistTitle(p.title)
      return `${album || p.title} (${p.year || '—'})`
    })
    .join(', ')
  const tokens = { decade: String(decadeYear), n: String(picks.length), count: String(derived.count), entity, closest }
  return {
    id: 'era-lesson',
    title: interpolate(t.title, tokens),
    body: interpolate(t.body, tokens),
    kind,
    actionable: true, // "hunt more like these" is a natural quest seed
  }
}

function countryMixStory(profile, copy, collectionLabel) {
  if (profile.kind !== 'records') return null
  const countries = [...profile.countries].sort((a, b) => a.localeCompare(b))
  if (countries.length < 2) return null
  const t = copy['country-mix']
  if (!t) return null
  const tokens = { collectionLabel }
  countries.slice(0, 3).forEach((c, i) => { tokens[`country${i + 1}`] = c })
  return {
    id: 'country-mix',
    title: interpolate(t.title, tokens),
    body: interpolate(t.body, tokens),
    kind: profile.kind,
    actionable: false,
  }
}

function seriesStory(profile, copy, collectionLabel) {
  if (profile.kind !== 'books') return null
  const t = copy.series
  if (!t) return null
  const top = mode(profile.series)
  if (!top.value) return null
  const tokens = { series: top.value, n: String(top.count), collectionLabel }
  return {
    id: 'series',
    title: interpolate(t.title, tokens),
    body: interpolate(t.body, tokens),
    kind: profile.kind,
    actionable: true, // "finish the series" is a natural quest seed
  }
}

function oneTimerStory(derived, items, copy, entity) {
  if (derived.count < MIN_RECOMMEND) return null
  if (derived.maxByArtist !== 1) return null
  const t = copy['one-timer']
  if (!t) return null
  // The single-item artist — first deterministically (sorted by title).
  const single = firstBy([...items].sort((a, b) => (a.title || '').localeCompare(b.title || '')), (it) => {
    const { artist } = splitArtistTitle(it.title)
    return artist && derived.artistCount >= 2
  })
  const artist = single ? splitArtistTitle(single.title).artist : ''
  return {
    id: 'one-timer',
    title: interpolate(t.title, { artist }),
    body: interpolate(t.body, { artist, entity }),
    kind: derived.kind,
    actionable: true, // "go grab more by {artist}" is a natural quest seed
  }
}

function notesCoverageStory(derived, copy, entity, collectionLabel) {
  if (derived.kind !== 'records') return null
  if (derived.count === 0) return null
  const t = copy['notes-coverage']
  if (!t) return null
  const tokens = {
    n: String(derived.notesCount),
    count: String(derived.count),
    pct: String(Math.round((derived.notesCount / derived.count) * 100)),
    entity,
    collectionLabel,
  }
  return {
    id: 'notes-coverage',
    title: interpolate(t.title, tokens),
    body: interpolate(t.body, tokens),
    kind: derived.kind,
    actionable: false,
  }
}

function totalPagesStory(derived, copy, entity) {
  if (derived.kind !== 'books') return null
  if (derived.pagesKnown < 5) return null // §6.2: only when ≥5 items have pageCount
  const t = copy['total-pages']
  if (!t) return null
  const tokens = { pages: formatNumber(derived.pages), n: String(derived.pagesKnown), count: String(derived.count), entity }
  return {
    id: 'total-pages',
    title: interpolate(t.title, tokens),
    body: interpolate(t.body, tokens),
    kind: derived.kind,
    actionable: false,
  }
}

// --- public API ----------------------------------------------------------

/**
 * Compute the ordered, deterministic Shelf Stories for a collection. Returns
 * [] for an empty/invalid collection. Never throws.
 *
 * @param {Array<object>} items - the owned client collection model
 * @param {{kind?: string, copy?: object, entity?: string, collectionLabel?: string}} catalog
 * @returns {Array<{id: string, title: string, body: string, kind: string, actionable: boolean}>}
 */
export function computeStories(items, catalog) {
  if (!Array.isArray(items) || items.length === 0) return []
  const kind = catalog?.kind === 'books' ? 'books' : 'records'
  const copy = catalog?.copy?.gamif?.stories?.cards || {}
  const entity = catalog?.entity || (kind === 'books' ? 'book' : 'record')
  const collectionLabel = catalog?.collectionLabel || (kind === 'books' ? 'shelf' : 'crate')

  const derived = deriveProfile(items, kind)
  if (derived.count === 0) return []

  // Extras the profile doesn't expose: the raw year list and the country set.
  const profile = { kind, ...derived }
  profile.years = []
  profile.countries = new Set()
  profile.series = new Map()
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const year = toYear(it.year)
    if (year !== null) profile.years.push(year)
    const country = clean(it.country)
    if (country) profile.countries.add(country)
    if (kind === 'books') {
      const { artist, album } = splitArtistTitle(it.title)
      if (artist && album?.includes(' - ')) {
        const series = album.split(' - ')[0].trim()
        if (series) profile.series.set(series, (profile.series.get(series) || 0) + 1)
      }
    }
  }

  const stories = []
  const push = (s) => { if (s) stories.push(s) }

  // Facts tier — always.
  push(yearSpanStory(profile, copy, entity, collectionLabel))
  push(decadeBiasStory(derived, copy, entity))
  // Recommendations tier — only once the collection is big enough (§6.2).
  if (derived.count >= MIN_RECOMMEND) {
    push(eraLessonStory(items, derived, copy, entity, kind))
  }
  push(countryMixStory(profile, copy, collectionLabel))
  push(seriesStory(profile, copy, collectionLabel))
  push(oneTimerStory(derived, items, copy, entity))
  push(notesCoverageStory(derived, copy, entity, collectionLabel))
  push(totalPagesStory(derived, copy, entity))

  return stories
}
