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
 * - sameAlbum: this album is owned under a different pressing/format
 * - otherArtist: other, different albums by the same artist already in the crate
 */
export function findRelated(candidate, items) {
  const ownedExact = items.find((it) => {
    if (candidate.discogsId && it.discogsId && it.discogsId === candidate.discogsId) return true
    if (candidate.googleBooksId && it.googleBooksId && it.googleBooksId === candidate.googleBooksId) return true
    if (candidate.barcode && it.barcode && it.barcode === candidate.barcode) return true
    return false
  }) || null

  const { artist, album } = splitArtistTitle(candidate.title)
  if (!artist) return { ownedExact, sameAlbum: [], otherArtist: [] }

  const artistLower = normalize(artist)
  const albumLower = normalize(album)

  const byArtist = items.filter((it) => {
    if (ownedExact && it.id === ownedExact.id) return false
    return normalize(splitArtistTitle(it.title).artist) === artistLower
  })

  const sameAlbum = byArtist.filter((it) => normalize(splitArtistTitle(it.title).album) === albumLower)
  const sameAlbumIds = new Set(sameAlbum.map((it) => it.id))
  const otherArtist = byArtist.filter((it) => !sameAlbumIds.has(it.id))

  return { ownedExact, sameAlbum, otherArtist }
}
