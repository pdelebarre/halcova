// Collection Persona engine (release 1.1, issue #48) — mirrors src/utils/match.js:
// pure, side-effect-free, unit-tested. Given the client collection model (the
// item shape audited in Phase 0 — docs/gamification-phase0.md §2) it maps the
// profile to ONE archetype from copy-bank.md §2, plus 2–3 headline stats and a
// verdict line.
//
// Parameterized by catalog like the rest of the app: records and books differ
// (books fall back to author + year + category when genre/category are absent,
// and records-only fields — formatType/style/country — are simply absent on
// books).
//
// GUARDS: missing year/genre/formatType/style/country/dateAdded must never
// throw. An empty collection returns null (the caller shows the empty state).
// Never crash, never `undefined` access.
//
// Copy comes in via catalog.copy.gamif.persona (archetype names + verdict
// templates + stat labels); the weighted rule set and per-archetype stat
// selection live here so they stay pure and unit-testable.

import { splitArtistTitle } from './match'

const MIN_COLLECTION = 4 // below this the "young collection" fallback applies
const FALLBACK_ID = 'fallback'

// --- small pure helpers ---------------------------------------------------

function clean(value) {
  return String(value ?? '').trim()
}

function toYear(value) {
  const y = Number(value)
  return Number.isFinite(y) && y > 0 ? Math.floor(y) : null
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US')
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthName(index) {
  if (index === null || index === undefined || index === '') return '—'
  const i = Number(index)
  return Number.isInteger(i) && i >= 0 && i <= 11 ? MONTH_NAMES[i] : '—'
}

/** Local calendar day of an ISO timestamp, or null. */
function dayKey(iso) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  } catch {
    return null
  }
}

/** The value with the largest count in a Map, or { value: null, count: 0 }. */
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

/** Interpolate {token} placeholders; non-string templates yield ''. */
function interpolate(template, tokens) {
  if (typeof template !== 'string') return ''
  let out = template
  for (const [k, v] of Object.entries(tokens || {})) {
    out = out.split(`{${k}}`).join(String(v ?? ''))
  }
  return out
}

// --- profile aggregation --------------------------------------------------

function buildProfile(items, kind) {
  const p = {
    kind,
    count: 0,
    genres: new Set(),
    styles: new Set(),
    decades: new Map(),
    years: [],
    artists: new Map(),
    albums: new Map(),
    formats: new Map(),
    labels: new Set(),
    countries: new Set(),
    notesCount: 0,
    days: new Map(),
    months: new Map(),
    jazz: 0,
    // books-only
    pages: 0,
    pagesKnown: 0,
    longestPages: 0,
    longestBook: '',
    publishers: new Set(),
    series: new Map(),
  }

  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    p.count += 1

    const { artist } = splitArtistTitle(it.title)
    const album = clean(splitArtistTitle(it.title).album)
    if (artist) p.artists.set(artist, (p.artists.get(artist) || 0) + 1)
    if (artist && album) {
      const key = `${clean(artist).toLowerCase()}|${album.toLowerCase()}`
      p.albums.set(key, (p.albums.get(key) || 0) + 1)
    }

    const year = toYear(it.year)
    if (year !== null) {
      p.years.push(year)
      const decade = `${Math.floor(year / 10) * 10}s`
      p.decades.set(decade, (p.decades.get(decade) || 0) + 1)
    }

    for (const g of it.genre || []) {
      const c = clean(g)
      if (c) p.genres.add(c)
    }
    for (const s of it.style || []) {
      const c = clean(s)
      if (c) p.styles.add(c)
    }

    const fmt = clean(it.formatType)
    if (fmt) p.formats.set(fmt, (p.formats.get(fmt) || 0) + 1)
    const label = clean(it.label)
    if (label) p.labels.add(label)
    const country = clean(it.country)
    if (country) p.countries.add(country)
    if (clean(it.notes)) p.notesCount += 1
    if ((it.genre || []).some((g) => /jazz/i.test(g))) p.jazz += 1

    const day = dayKey(it.dateAdded)
    if (day) p.days.set(day, (p.days.get(day) || 0) + 1)
    const added = new Date(it.dateAdded)
    if (!Number.isNaN(added.getTime())) {
      const m = added.getMonth()
      p.months.set(m, (p.months.get(m) || 0) + 1)
    }

    // Books-only metrics: pageCount (often '' until a detail fetch),
    // publishers (label), and series detection from "Series - Book" titles.
    if (kind === 'books') {
      const pages = Number(it.pageCount)
      if (Number.isFinite(pages) && pages > 0) {
        p.pages += pages
        p.pagesKnown += 1
        if (pages > p.longestPages) {
          p.longestPages = pages
          p.longestBook = album || clean(it.title)
        }
      }
      const pub = clean(it.label)
      if (pub) p.publishers.add(pub)
      if (artist && album.includes(' - ')) {
        const series = album.split(' - ')[0].trim()
        if (series) p.series.set(series, (p.series.get(series) || 0) + 1)
      }
    }
  }
  return p
}

function deriveProfile(items, kind) {
  const p = buildProfile(items, kind)
  const topArtist = mode(p.artists)
  const topDecade = mode(p.decades)
  const topDay = mode(p.days)
  const topMonth = mode(p.months)
  const topAlbum = mode(p.albums)

  const yearSpan = p.years.length >= 2 ? Math.max(...p.years) - Math.min(...p.years) : 0
  const maxByArtist = topArtist.count
  const jazzPct = p.count ? Math.round((p.jazz / p.count) * 100) : 0
  const topDecadePct = p.count && topDecade.value ? Math.round((topDecade.count / p.count) * 100) : 0
  const topAuthorPct = p.count ? Math.round((maxByArtist / p.count) * 100) : 0
  const unfinishedSeries = [...p.series.values()].filter((n) => n === 1).length
  const albumsTwice = [...p.albums.values()].filter((n) => n >= 2).length
  const decadeYear = /^\d{4}s$/.test(topDecade.value || '') ? Number(topDecade.value.replace('s', '')) : null

  let unfinishedSeriesName = ''
  for (const [name, n] of p.series) {
    if (n === 1) {
      unfinishedSeriesName = name
      break
    }
  }

  return {
    kind,
    count: p.count,
    genreCount: p.genres.size,
    styleCount: p.styles.size,
    decadeCount: p.decades.size,
    topDecade: topDecade.value || '',
    topDecadePct,
    decadeYear,
    labelCount: p.labels.size,
    countryCount: p.countries.size,
    artistCount: p.artists.size,
    topArtist: topArtist.value || '',
    maxByArtist,
    notesCount: p.notesCount,
    oneDayBurst: topDay.count,
    busiestMonth: topMonth.value,
    pressingsOfOne: topAlbum.count,
    albumsTwice,
    yearSpan,
    jazzPct,
    topAuthorPct,
    pages: p.pages,
    pagesKnown: p.pagesKnown,
    longestBook: p.longestBook,
    publisherCount: p.publishers.size,
    unfinishedSeries,
    unfinishedSeriesName,
  }
}

// --- weighted rule sets (first matching rule wins) ------------------------

const RECORD_RULES = [
  { id: 'impulse-buyer', test: (d) => d.oneDayBurst >= 10 },
  { id: 'completist', test: (d) => d.count >= 8 && d.maxByArtist >= 5 },
  { id: 'variant-collector', test: (d) => d.albumsTwice >= 2 },
  { id: 'time-traveler', test: (d) => d.decadeCount >= 2 && d.topDecadePct >= 40 && d.yearSpan >= 30 },
  { id: 'sophisticate', test: (d) => d.genreCount <= 4 && d.jazzPct >= 40 },
  { id: 'genre-tourist', test: (d) => d.genreCount >= 8 },
  { id: 'crate-digger', test: (d) => d.count >= 20 },
  { id: 'one-timer', test: (d) => d.maxByArtist === 1 && d.count >= 4 },
]

const BOOK_RULES = [
  { id: 'series-starter', test: (d) => d.unfinishedSeries >= 2 },
  { id: 'one-series-wonder', test: (d) => d.artistCount >= 3 && d.topAuthorPct >= 40 },
  { id: 'page-counter', test: (d) => d.pagesKnown >= 5 && d.pages >= 3000 },
  { id: 'genre-hedonist', test: (d) => d.genreCount >= 6 },
  { id: 'first-edition-idealist', test: (d) => d.publisherCount >= 8 && d.count >= 10 },
  { id: 'couch-intellectual', test: (d) => d.count >= 6 },
]

// Which stats each archetype shows (2–3), from copy-bank.md §2 "suggested stats".
const STAT_KEYS = {
  records: {
    'crate-digger': ['count', 'genres', 'topDecade'],
    'time-traveler': ['topDecadePct', 'decades', 'topDecade'],
    'genre-tourist': ['genres', 'labels', 'countries'],
    completist: ['artistAlbums', 'pressingsOfOne', 'notesCount'],
    'impulse-buyer': ['oneDayBurst', 'busiestMonth', 'count'],
    'one-timer': ['topArtist', 'artists', 'count'],
    'variant-collector': ['pressingsOfOne', 'albumsTwice', 'count'],
    'sophisticate': ['jazzPct', 'genres', 'notesCount'],
    fallback: ['count'],
  },
  books: {
    'couch-intellectual': ['count', 'genres', 'pages'],
    'series-starter': ['unfinishedSeries', 'count', 'artists'],
    'genre-hedonist': ['genres', 'artists', 'pages'],
    'page-counter': ['pages', 'count', 'longestBook'],
    'one-series-wonder': ['topAuthorPct', 'artists', 'count'],
    'first-edition-idealist': ['count', 'publishers', 'genres'],
    fallback: ['count'],
  },
}

// Format each stat's value from the derived profile.
const STAT_VALUE = {
  count: (d) => String(d.count),
  genres: (d) => String(d.genreCount),
  decades: (d) => String(d.decadeCount),
  topDecade: (d) => d.topDecade,
  topDecadePct: (d) => `${d.topDecadePct}%`,
  labels: (d) => String(d.labelCount),
  countries: (d) => String(d.countryCount),
  artists: (d) => String(d.artistCount),
  artistAlbums: (d) => `${d.maxByArtist}/${d.count}`,
  pressingsOfOne: (d) => String(d.pressingsOfOne),
  albumsTwice: (d) => String(d.albumsTwice),
  notesCount: (d) => String(d.notesCount),
  oneDayBurst: (d) => String(d.oneDayBurst),
  busiestMonth: (d) => monthName(d.busiestMonth),
  jazzPct: (d) => `${d.jazzPct}%`,
  pages: (d) => formatNumber(d.pages),
  longestBook: (d) => d.longestBook || '—',
  publishers: (d) => String(d.publisherCount),
  unfinishedSeries: (d) => String(d.unfinishedSeries),
  topAuthorPct: (d) => `${d.topAuthorPct}%`,
  yearSpan: (d) => String(d.yearSpan),
}

// Tokens interpolated into each archetype's verdict template (copy-bank §2).
const VERDICT_TOKENS = {
  'time-traveler': (d) => ({ year: d.decadeYear ?? '' }),
  'genre-tourist': (d) => ({ n: d.genreCount }),
  completist: (d) => ({ artist: d.topArtist }),
  'impulse-buyer': (d) => ({ n: d.oneDayBurst }),
  'one-timer': (d) => ({ artist: d.topArtist }),
  'sophisticate': (d) => ({ n: d.jazzPct }),
  'series-starter': (d) => ({ series: d.unfinishedSeriesName }),
  'page-counter': (d) => ({ n: formatNumber(d.pages) }),
  'one-series-wonder': (d) => ({ author: d.topArtist, n: d.topAuthorPct }),
  fallback: () => ({}),
}

/** Shared tokens for stat labels (e.g. "From the {year}s"). */
function statTokens(d) {
  return { year: d.decadeYear ?? '' }
}

// --- public API -----------------------------------------------------------

/**
 * Compute the collection persona. Returns null for an empty collection (the
 * caller renders the empty state instead). Never throws.
 *
 * @param {Array<object>} items - the owned client collection model
 * @param {{kind: string, copy?: object}} catalog - records/books catalog
 * @returns {{ archetypeId, title, verdict, stats: [{key,label,value}] }|null}
 */
export function computePersona(items, catalog) {
  if (!Array.isArray(items) || items.length === 0) return null
  const kind = catalog?.kind === 'books' ? 'books' : 'records'
  const personaCopy = catalog?.copy?.gamif?.persona || {}
  const derived = deriveProfile(items, kind)
  if (derived.count === 0) return null

  let archetypeId = FALLBACK_ID
  if (derived.count >= MIN_COLLECTION) {
    const rules = kind === 'books' ? BOOK_RULES : RECORD_RULES
    for (const rule of rules) {
      if (rule.test(derived)) {
        archetypeId = rule.id
        break
      }
    }
  }

  const tokens = VERDICT_TOKENS[archetypeId] ? VERDICT_TOKENS[archetypeId](derived) : {}
  const archetype = personaCopy.archetypes?.[archetypeId] || personaCopy.archetypes?.fallback || {}
  const title = interpolate(archetype.name, tokens) || archetypeId
  const verdict = interpolate(archetype.verdict, tokens) || ''

  const keys = STAT_KEYS[kind][archetypeId] || ['count']
  const labels = personaCopy.stats || {}
  const lt = statTokens(derived)
  const stats = keys.map((key) => ({
    key,
    label: interpolate(labels[key], lt) || key,
    value: STAT_VALUE[key] ? STAT_VALUE[key](derived) : '',
  }))

  return { archetypeId, title, verdict, stats }
}
