import './Toolbar.css'

const FORMATS = ['LP', 'EP', 'CD', '7"', '12"']

export default function Toolbar({
  query, setQuery,
  activeFormats, toggleFormat,
  genres, activeGenres, toggleGenre,
  artists, activeArtist, setActiveArtist,
  sortBy, setSortBy, count,
  showClear, onClearFilters,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your crate…"
          aria-label="Search collection"
        />
        <span className="toolbar-count">{count}</span>
      </div>

      <div className="toolbar-row">
        <div className="format-chips">
          {FORMATS.map((f) => (
            <button
              key={f}
              className={`chip ${activeFormats.includes(f) ? 'active' : ''}`}
              onClick={() => toggleFormat(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort by">
          <option value="added">Recently added</option>
          <option value="artist">Artist A–Z</option>
          <option value="year">Year</option>
          <option value="format">Format</option>
        </select>
      </div>

      <div className="toolbar-row toolbar-classify">
        <div className="format-chips">
          <span className="row-label">Genre</span>
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

        <div className="toolbar-actions">
          <select
            className="sort-select artist-select"
            value={activeArtist}
            onChange={(e) => setActiveArtist(e.target.value)}
            aria-label="Filter by artist"
          >
            <option value="">All artists</option>
            {artists.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

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
