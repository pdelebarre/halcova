import { useEffect, useMemo, useRef } from 'react'
import { countBy, decadeOf } from '../utils/browse'
import { t } from '../i18n'
import './CollectionStats.css'

/**
 * "Your collection, by the numbers" (§ Phase 5): a sheet with client-side
 * counts by genre and by decade. Pure text labels + counts (no color-only
 * encoding), read naturally as a definition list.
 */
export default function CollectionStats({ items = [], onClose, copy = {} }) {
  const closeRef = useRef(null)
  const stats = copy.stats || {}

  const genres = useMemo(() => countBy(items, (it) => it.genre || []), [items])
  const decades = useMemo(() => countBy(items, (it) => [decadeOf(it.year)]), [items])

  // Focus into the sheet on open; Esc closes.
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={stats.title || 'Stats'}>
      <div className="sheet stats-sheet">
        <div className="sheet-header">
          <h2>{stats.title || 'Stats'}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="stats-body">
          <p className="stats-total">
            {typeof stats.total === 'function' ? stats.total(items.length) : `${items.length} items`}
          </p>

          {items.length === 0 && (
            <p className="stats-empty">{stats.empty || 'Nothing to count yet.'}</p>
          )}

          {genres.length > 0 && (
            <section className="stats-section" aria-label={stats.byGenre || 'By genre'}>
              <h3 className="stats-section-title">{stats.byGenre || 'By genre'}</h3>
              <dl className="stats-list">
                {genres.map((g) => (
                  <div key={g.label} className="stats-row">
                    <dt>{g.label}</dt>
                    <dd>{g.count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {decades.length > 0 && (
            <section className="stats-section" aria-label={stats.byDecade || 'By decade'}>
              <h3 className="stats-section-title">{stats.byDecade || 'By decade'}</h3>
              <dl className="stats-list">
                {decades.map((d) => (
                  <div key={d.label} className="stats-row">
                    <dt>{d.label}</dt>
                    <dd>{d.count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <div className="sheet-actions stats-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
