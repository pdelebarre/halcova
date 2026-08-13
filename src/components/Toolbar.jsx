import { useMemo, useRef, useState } from 'react'
import { useScrolled } from '../hooks/useScrolled'
import { t, getLocale } from '../i18n'
import FilterSheet from './FilterSheet'
import SortMenu from './SortMenu'
import './Toolbar.css'

const DEFAULT_SORTS = [
  { value: 'added', label: 'Recently added' },
  { value: 'artist', label: 'Artist A–Z' },
  { value: 'year', label: 'Year' },
]

/**
 * One-row toolbar: search pill + Filter + sort + Grid|List toggle.
 * Format/genre/artist filters live in the filter sheet (§4.3, §5).
 */
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
  count, onClearFilters, onResetFilters,
  view = 'grid', setView,
  copy = {},
  lendingEnabled = false,
  activeLending = false,
  onToggleLending,
  onOpenLoans,
  loansButtonRef,
  minimal = false,
}) {
  const scrolled = useScrolled()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const filterBtnRef = useRef(null)
  const sortBtnRef = useRef(null)

  const loansLabel = copy.lending?.loans || t('lending.loans')

  const activeFilterCount = activeFormats.length + activeGenres.length + (activeArtist ? 1 : 0) + (activeLending ? 1 : 0)
  const currentSortLabel = useMemo(
    () => sortOptions.find((o) => o.value === sortBy)?.label || sortBy,
    [sortOptions, sortBy],
  )
  const filterLabel = copy.filterLabel || t('toolbar.filter')
  const filterAriaLabel = activeFilterCount > 0
    ? t('toolbar.filtersActive', { n: activeFilterCount })
    : filterLabel

  function closeSheet() {
    setSheetOpen(false)
    filterBtnRef.current?.focus()
  }

  function closeSort() {
    setSortOpen(false)
    sortBtnRef.current?.focus()
  }

  // W7: global loans dashboard button — icon + "Loans" label, no numeric
  // badge (the dashboard is global across records + books, so a per-tab count
  // would mislead). Rendered whenever lending is enabled.
  function renderLoansButton() {
    if (!lendingEnabled) return null
    return (
      <button
        ref={loansButtonRef}
        type="button"
        className="toolbar-btn loans-btn"
        onClick={onOpenLoans}
        aria-label={loansLabel}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="7" y="3" width="10" height="4" rx="1" />
          <path d="M5 9h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
          <path d="M12 13v4M10 15h4" />
        </svg>
        <span className="loans-label">{loansLabel}</span>
      </button>
    )
  }

  // Minimal toolbar: an empty collection still needs the Loans button when
  // lending is enabled, so the global dashboard stays reachable. Everything
  // else (search/filter/sort/toggle) is meaningless over zero items.
  if (minimal) {
    return (
      <div className={scrolled ? 'toolbar scrolled' : 'toolbar'}>
        {renderLoansButton()}
      </div>
    )
  }

  return (
    <div className={scrolled ? 'toolbar scrolled' : 'toolbar'}>
      <div className={`toolbar-search${query ? ' has-text' : ''}`}>
        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={t('toolbar.searchCollection')}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            onClick={() => setQuery('')}
            aria-label={copy.searchClear || t('toolbar.clearSearch')}
          >
            ✕
          </button>
        )}
        <span className="toolbar-count" aria-hidden="true">{Number(count || 0).toLocaleString(getLocale())}</span>
      </div>

      <button
        ref={filterBtnRef}
        type="button"
        className={`toolbar-btn filter-btn${activeFilterCount > 0 ? ' active' : ''}`}
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-label={filterAriaLabel}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        <span className="filter-label">{filterLabel}</span>
        {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
      </button>

      <button
        ref={sortBtnRef}
        type="button"
        className="toolbar-btn sort-btn"
        onClick={() => setSortOpen(true)}
        aria-haspopup="menu"
        aria-expanded={sortOpen}
        aria-label={`${copy.sortMenu?.label || t('toolbar.sortBy')}: ${currentSortLabel}`}
      >
        <span className="sort-label">{currentSortLabel}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* W7: global loans dashboard — only when lending is enabled. */}
      {renderLoansButton()}

      <div className="view-toggle">
        <button
          type="button"
          className={`view-toggle-btn${view === 'grid' ? ' active' : ''}`}
          onClick={() => setView('grid')}
          aria-pressed={view === 'grid'}
          aria-label={copy.view?.grid || t('toolbar.gridView')}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button
          type="button"
          className={`view-toggle-btn${view === 'list' ? ' active' : ''}`}
          onClick={() => setView('list')}
          aria-pressed={view === 'list'}
          aria-label={copy.view?.list || t('toolbar.listView')}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13" />
            <path d="M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </button>
      </div>

      <span className="visually-hidden" aria-live="polite">
        {activeFilterCount > 0 ? (copy.filtersActive?.(activeFilterCount) ?? t('toolbar.filtersActive', { n: activeFilterCount })) : ''}
      </span>

      {sheetOpen && (
        <FilterSheet
          copy={copy}
          formats={formats}
          activeFormats={activeFormats}
          toggleFormat={toggleFormat}
          genres={genres}
          activeGenres={activeGenres}
          toggleGenre={toggleGenre}
          genreLabel={genreLabel}
          artists={artists}
          activeArtist={activeArtist}
          setActiveArtist={setActiveArtist}
          artistLabel={artistLabel}
          artistPlaceholder={artistPlaceholder}
          lendingEnabled={lendingEnabled}
          activeLending={activeLending}
          onToggleLending={onToggleLending}
          onClear={onResetFilters || onClearFilters}
          onClose={closeSheet}
        />
      )}

      {sortOpen && (
        <SortMenu
          options={sortOptions}
          value={sortBy}
          onSelect={(v) => { setSortBy(v); closeSort() }}
          onClose={closeSort}
          anchorRef={sortBtnRef}
          copy={copy}
        />
      )}
    </div>
  )
}
