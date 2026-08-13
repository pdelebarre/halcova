// Titles are stored as "Artist - Album" (the Discogs convention we save under).
export function splitArtistTitle(title) {
  if (!title) return { artist: '', album: '' }
  const idx = title.indexOf(' - ')
  if (idx === -1) return { artist: '', album: title.trim() }
  return { artist: title.slice(0, idx).trim(), album: title.slice(idx + 3).trim() }
}

function normalize(s) {
  return (s || '').toLowerCase().trim()
}

/**
 * Given a scanned/looked-up candidate release, figure out:
 * - ownedExact: this precise release (same Discogs release, or same barcode) is already in the crate
 * - wishlistExact: this precise release is already in the user's wishlist (a "want", not owned)
 * - sameAlbum: this album is owned under a different pressing/format
 * - otherArtist: other, different albums by the same artist already in the crate
 */
export function findRelated(candidate, items, wishlist = []) {
  const findExact = (list) => list.find((it) => {
    if (candidate.discogsId && it.discogsId && it.discogsId === candidate.discogsId) return true
    if (candidate.googleBooksId && it.googleBooksId && it.googleBooksId === candidate.googleBooksId) return true
    if (candidate.barcode && it.barcode && it.barcode === candidate.barcode) return true
    return false
  }) || null

  const ownedExact = findExact(items)
  const wishlistExact = findExact(wishlist)

  const { artist, album } = splitArtistTitle(candidate.title)
  if (!artist) return { ownedExact, wishlistExact, sameAlbum: [], otherArtist: [] }

  const artistLower = normalize(artist)
  const albumLower = normalize(album)

  const byArtist = items.filter((it) => {
    if (ownedExact && it.id === ownedExact.id) return false
    return normalize(splitArtistTitle(it.title).artist) === artistLower
  })

  const sameAlbum = byArtist.filter((it) => normalize(splitArtistTitle(it.title).album) === albumLower)
  const sameAlbumIds = new Set(sameAlbum.map((it) => it.id))
  const otherArtist = byArtist.filter((it) => !sameAlbumIds.has(it.id))

  return { ownedExact, wishlistExact, sameAlbum, otherArtist }
}

// ============================================================================
// OPAC search (§ Phase 3): diacritic-insensitive, typo-tolerant, ranked.
// Pure functions — unit-tested in match.test.js.
// ============================================================================

/** Lowercase + strip diacritics (é → e) + trim. Used for query and fields. */
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

// Bounded Levenshtein with early exit — the distance when ≤ max, else Infinity.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > max) return Infinity
    prev = curr
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity
}

// Fields searched, in descending priority for ranking (title covers the artist).
const SEARCH_FIELDS = [
  { get: (item) => item.title, priority: 0 },
  { get: (item) => item.label, priority: 1 },
  { get: (item) => item.catno, priority: 2 },
  { get: (item) => (item.genre || []).join(' '), priority: 3 },
]

// Typo tolerance: exact substring is best (0); a single-edit word match costs
// 100+d so it sorts after any substring match but still matches ("Nirvanaa").
function fuzzyPenalty(value, q) {
  if (value.includes(q)) return 0
  let best = Infinity
  for (const word of value.split(/\s+/)) {
    const d = editDistance(word, q, 1)
    if (Number.isFinite(d) && d < best) best = d
  }
  return Number.isFinite(best) ? 100 + best : Infinity
}

function itemSearchPenalty(item, q) {
  let best = Infinity
  for (const { get, priority } of SEARCH_FIELDS) {
    const raw = get(item)
    if (raw == null) continue
    const value = normalizeText(raw)
    if (!value) continue
    const p = fuzzyPenalty(value, q)
    if (p === Infinity) continue
    const total = priority * 1000 + p
    if (total < best) best = total
  }
  return best
}

/**
 * Fuzzy, ranked search across title/label/catno/genre. Returns matching items
 * ordered by relevance (title > label > catno > genre), then title A–Z.
 * A query that matches nothing returns [].
 */
export function searchItems(items, query) {
  const q = normalizeText(query)
  if (!q) return []
  const scored = []
  for (const item of items) {
    const score = itemSearchPenalty(item, q)
    if (Number.isFinite(score)) scored.push({ item, score })
  }
  scored.sort((a, b) => a.score - b.score || (a.item.title || '').localeCompare(b.item.title || ''))
  return scored.map((s) => s.item)
}

/**
 * Best "did you mean" suggestion when a query matches nothing, or null. More
 * lenient than search (up to 2 edits) so near-misses still get a tappable fix.
 */
export function didYouMean(items, query) {
  const q = normalizeText(query)
  if (!q) return null
  let best = null
  let bestDist = Infinity
  for (const item of items) {
    for (const { get } of SEARCH_FIELDS) {
      const raw = get(item)
      if (raw == null) continue
      const nv = normalizeText(raw)
      if (!nv) continue
      for (const word of [nv, ...nv.split(/\s+/)]) {
        if (!word || word === q) continue
        const d = editDistance(word, q, 2)
        if (Number.isFinite(d) && d < bestDist) {
          bestDist = d
          best = word
        }
      }
    }
  }
  return Number.isFinite(bestDist) ? best : null
}
