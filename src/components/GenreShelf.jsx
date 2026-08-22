import { useMemo } from 'react'
import { t } from '../i18n'
import SectionHeader from './SectionHeader'
import Grid from './Grid'
import './GenreShelf.css'

/**
 * GenreShelf — groups items by genre, like record shop sections.
 * Each genre gets a sticky header + grid of cards.
 * Items with multiple genres appear in every matching section.
 */
export default function GenreShelf({ items, onOpen, lendingEnabled, copy, query }) {
  // Group items by genre
  const sections = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const genreList = item.genre
      if (!genreList || (Array.isArray(genreList) && genreList.length === 0)) {
        // Uncategorized items go into "Other"
        const other = map.get('Other') || []
        other.push(item)
        map.set('Other', other)
        continue
      }
      const genres = Array.isArray(genreList) ? genreList : [genreList]
      for (const g of genres) {
        const section = map.get(g) || []
        section.push(item)
        map.set(g, section)
      }
    }
    // Sort alphabetically, "Other" goes last
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === 'Other') return 1
        if (b[0] === 'Other') return -1
        return a[0].localeCompare(b[0])
      })
      .map(([genre, sectionItems]) => ({ genre, items: sectionItems }))
  }, [items])

  // Jump-to-genre: show first 20 genres as a compact rail
  const jumpGenres = useMemo(() => {
    if (sections.length < 4) return []
    return sections.slice(0, 20).map((s) => s.genre)
  }, [sections])

  return (
    <div className="genre-shelf" role="list" aria-label={t('home.browseByGenre')}>
      {/* Jump-to-genre rail */}
      {jumpGenres.length > 0 && (
        <div className="genre-jump-rail" role="tablist" aria-label="Jump to genre">
          {jumpGenres.map((genre) => (
            <button
              key={genre}
              type="button"
              className="genre-jump-chip"
              role="tab"
              onClick={() => {
                const el = document.getElementById(`genre-section-${CSS.escape(genre)}`)
                el?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              {genre}
            </button>
          ))}
        </div>
      )}

      {/* Genre sections */}
      {sections.map(({ genre, items: sectionItems }) => (
        <section
          key={genre}
          id={`genre-section-${CSS.escape(genre)}`}
          className="genre-section"
          role="listitem"
          aria-labelledby={`genre-heading-${CSS.escape(genre)}`}
        >
          <SectionHeader
            id={`genre-heading-${CSS.escape(genre)}`}
            title={genre}
            count={sectionItems.length}
            className="genre-section-header"
          />
          <Grid items={sectionItems} onOpen={onOpen} lendingEnabled={lendingEnabled} copy={copy} query={query} />
        </section>
      ))}
    </div>
  )
}