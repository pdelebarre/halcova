import './Toolbar.css'

const DEFAULT_SORTS = [
  { value: 'added', label: 'Recently added' },
  { value: 'artist', label: 'Artist A–Z' },
  { value: 'year', label: 'Year' },
]

export default function Toolbar({
  query, setQuery,
  placeholder = 'Search your collection…',
  formats = [], activeFormats = [], toggleFormat,
  genres = [], activeGenres = [], toggleGenre,
  genreLabel = 'Genre',
  artists = [], activeArtist = '', setActiveArtist,
  artistLabel = 'artist',
  artistPlaceholder = 'All',
  sortBy, setSortBy,
  sortOptions = DEFAULT_SORTS,
  count, showClear, onClearFilters,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Search collection"
        />
        <span className="toolbar-count">{count}</span>
      </div>

      <div className="toolbar-row">
        {formats.length > 0 && (
          <div className="format-chips">
            {formats.map((f) => (
              <button
                key={f}
                className={`chip ${activeFormats.includes(f) ? 'active' : ''}`}
                onClick={() => toggleFormat(f)}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        <div className="toolbar-actions">
          <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort by">
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="toolbar-row toolbar-classify">
        {genres.length > 0 && (
          <div className="format-chips">
            <span className="row-label">{genreLabel}</span>
            {genres.map((g) => (
              <button
                key={g}
                className={`chip ${activeGenres.includes(g) ? 'active' : ''}`}
                onClick={() => toggleGenre(g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        <div className="toolbar-actions">
          {artists.length > 0 && (
            <select
              className="sort-select artist-select"
              value={activeArtist}
              onChange={(e) => setActiveArtist(e.target.value)}
              aria-label={`Filter by ${artistLabel}`}
            >
              <option value="">{artistPlaceholder}</option>
              {artists.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}

          {showClear && (
            <button className="chip clear-chip" onClick={onClearFilters} aria-label="Clear all filters">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
