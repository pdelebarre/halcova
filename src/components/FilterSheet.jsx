import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import './FilterSheet.css'

// How many filters a saved view carries (pure — no component state needed).
function activeCount(state) {
  return (state?.activeFormats?.length || 0) + (state?.activeGenres?.length || 0) + (state?.activeArtist ? 1 : 0) + (state?.activeLending ? 1 : 0)
}

/**
 * Bottom-sheet filter panel (§4.4, §5.2): Format (records only) + Genre/
 * Category chips and a searchable Artist/Author combobox. Selections apply
 * immediately to the grid — "Done" just closes the sheet.
 */
export default function FilterSheet({
  copy = {},
  formats = [], activeFormats = [], toggleFormat,
  genres = [], activeGenres = [], toggleGenre,
  genreLabel = 'Genre',
  artists = [], activeArtist = '', setActiveArtist,
  artistLabel = 'artist',
  artistPlaceholder = 'All',
  lendingEnabled = false,
  activeLending = false,
  onToggleLending,
  onClear,
  onClose,
  savedViews = [],
  onSaveView,
  onApplyView,
  onDeleteView,
  onRenameView,
}) {
  const sheet = copy.filterSheet || {}
  const lending = copy?.lending || {}
  const views = copy.views || {}
  const closeRef = useRef(null)
  const comboWrapRef = useRef(null)
  const [artistQuery, setArtistQuery] = useState('')
  const [artistOpen, setArtistOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [viewName, setViewName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameText, setRenameText] = useState('')

  const hasFilters = activeFormats.length > 0 || activeGenres.length > 0 || activeArtist !== '' || activeLending

  // Saved views (§ Phase 5): name the current filter set, apply/rename/delete.
  function saveCurrentView() {
    const name = viewName.trim()
    if (!name || !hasFilters) return
    onSaveView?.(name)
    setViewName('')
  }
  function startRename(view) {
    setRenamingId(view.id)
    setRenameText(view.name)
  }
  function commitRename(id) {
    const name = renameText.trim()
    if (name) onRenameView?.(id, name)
    setRenamingId(null)
  }

  const filteredArtists = useMemo(() => {
    const q = artistQuery.trim().toLowerCase()
    return q ? artists.filter((a) => a.toLowerCase().includes(q)) : artists
  }, [artists, artistQuery])

  // Focus into the sheet on open; Esc closes.
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Close the combobox dropdown when tapping outside it.
  useEffect(() => {
    if (!artistOpen) return undefined
    function onPointerDown(e) {
      if (comboWrapRef.current && !comboWrapRef.current.contains(e.target)) setArtistOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [artistOpen])

  function selectArtist(name) {
    setActiveArtist(name)
    setArtistQuery('')
    setArtistOpen(false)
    setHighlighted(-1)
  }

  function handleArtistKeys(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setArtistOpen(true)
      setHighlighted((h) => (h + 1) % Math.max(1, filteredArtists.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => (h - 1 + filteredArtists.length) % Math.max(1, filteredArtists.length))
    } else if (e.key === 'Enter') {
      if (highlighted >= 0 && filteredArtists[highlighted]) {
        e.preventDefault()
        selectArtist(filteredArtists[highlighted])
      }
    } else if (e.key === 'Escape') {
      // Close just the dropdown, not the whole sheet.
      e.stopPropagation()
      setArtistOpen(false)
      setHighlighted(-1)
    }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={sheet.title || t('catalog.filterSheetTitle')}>
      <div className="sheet filter-sheet">
        <div className="sheet-header">
          <h2>{sheet.title || t('catalog.filterSheetTitle')}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="filter-body">
          {formats.length > 0 && (
            <section className="filter-section">
              <h3 className="filter-section-title">{sheet.format || t('catalog.filterSheetFormat')}</h3>
              <div className="filter-chips">
                {formats.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`chip${activeFormats.includes(f) ? ' active' : ''}`}
                    onClick={() => toggleFormat(f)}
                    aria-pressed={activeFormats.includes(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </section>
          )}

          {genres.length > 0 && (
            <section className="filter-section">
              <h3 className="filter-section-title">{genreLabel}</h3>
              <div className="filter-chips">
                {genres.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`chip${activeGenres.includes(g) ? ' active' : ''}`}
                    onClick={() => toggleGenre(g)}
                    aria-pressed={activeGenres.includes(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </section>
          )}

          {artists.length > 0 && (
            <section className="filter-section">
              <h3 className="filter-section-title">{sheet.artist || artistLabel}</h3>
              <div className="filter-combobox" ref={comboWrapRef}>
                {activeArtist && (
                  <span className="artist-chip">
                    <span className="artist-chip-label">{activeArtist}</span>
                    <button
                      type="button"
                      className="artist-chip-remove"
                      onClick={() => selectArtist('')}
                      aria-label={sheet.clearArtist || t('catalog.filterSheetClearArtist')}
                    >
                      ✕
                    </button>
                  </span>
                )}
                <div className="combo-field">
                  <input
                    type="text"
                    role="combobox"
                    aria-expanded={artistOpen}
                    aria-controls="artist-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={highlighted >= 0 ? `artist-opt-${highlighted}` : undefined}
                    value={artistQuery}
                    onChange={(e) => { setArtistQuery(e.target.value); setArtistOpen(true); setHighlighted(-1) }}
                    onFocus={() => setArtistOpen(true)}
                    onKeyDown={handleArtistKeys}
                    placeholder={activeArtist ? '' : artistPlaceholder}
                    aria-label={t('toolbar.filterBy', { artistLabel })}
                  />
                  {artistOpen && filteredArtists.length > 0 && (
                    <ul className="combo-list" id="artist-listbox" role="listbox" aria-label={sheet.artist || artistLabel}>
                      {filteredArtists.map((a, i) => (
                        <li
                          key={a}
                          id={`artist-opt-${i}`}
                          role="option"
                          aria-selected={a === activeArtist}
                          className={i === highlighted ? 'highlighted' : ''}
                          onMouseEnter={() => setHighlighted(i)}
                          onClick={() => selectArtist(a)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectArtist(a) }
                          }}
                        >
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                  {artistOpen && artistQuery.trim() && filteredArtists.length === 0 && (
                    <p className="combo-empty">{sheet.noArtists || t('toolbar.noArtists')}</p>
                  )}
                </div>
              </div>
            </section>
          )}

          {lendingEnabled && (
            <section className="filter-section filter-section-lending">
              <button
                type="button"
                role="switch"
                aria-checked={activeLending}
                className={`switch${activeLending ? ' on' : ''}`}
                onClick={() => onToggleLending?.()}
              >
                <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                <span className="switch-label">
                  <span className="switch-label-text">{lending.filter || t('lending.filter')}</span>
                  <span className="switch-hint">{lending.filterHint || t('lending.filterHint')}</span>
                </span>
              </button>
            </section>
          )}

          <section className="filter-section filter-section-views">
            <h3 className="filter-section-title">{views.title || 'Saved views'}</h3>
            {savedViews.length === 0 && (
              <p className="views-empty">{views.empty || 'No saved views yet.'}</p>
            )}
            {savedViews.map((view) => (
              <div key={view.id} className="saved-view-row">
                {renamingId === view.id ? (
                  <input
                    className="saved-view-input saved-view-name-input"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(view.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => commitRename(view.id)}
                    aria-label={`${views.rename || 'Rename'}: ${view.name}`}
                  />
                ) : (
                  <button type="button" className="saved-view-apply" onClick={() => onApplyView?.(view.state)}>
                    <span className="saved-view-name">{view.name}</span>
                    <span className="saved-view-meta">
                      {typeof views.summary === 'function' ? views.summary(activeCount(view.state)) : `${activeCount(view.state)} filters`}
                    </span>
                  </button>
                )}
                <button type="button" className="saved-view-icon" onClick={() => startRename(view)} aria-label={`${views.rename || 'Rename'}: ${view.name}`}>✎</button>
                <button type="button" className="saved-view-icon" onClick={() => onDeleteView?.(view.id)} aria-label={`${views.delete || 'Delete view'}: ${view.name}`}>✕</button>
              </div>
            ))}
            <div className="saved-view-save">
              <input
                className="saved-view-input"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCurrentView() }}
                placeholder={views.savePlaceholder || 'Name this view…'}
                aria-label={views.savePlaceholder || 'Name this view'}
              />
              <button type="button" className="btn btn-ghost" onClick={saveCurrentView} disabled={!viewName.trim() || !hasFilters}>
                {views.save || 'Save view'}
              </button>
            </div>
          </section>
        </div>

        <div className="filter-footer sheet-actions">
          {hasFilters && (
            <button type="button" className="btn btn-ghost" onClick={() => onClear?.()}>
              {sheet.reset || t('toolbar.reset')}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {sheet.done || t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
