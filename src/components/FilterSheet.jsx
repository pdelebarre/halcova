import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import './FilterSheet.css'

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
  onClear,
  onClose,
}) {
  const sheet = copy.filterSheet || {}
  const closeRef = useRef(null)
  const comboWrapRef = useRef(null)
  const [artistQuery, setArtistQuery] = useState('')
  const [artistOpen, setArtistOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)

  const hasFilters = activeFormats.length > 0 || activeGenres.length > 0 || activeArtist !== ''

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
