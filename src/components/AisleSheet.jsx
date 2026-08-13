import { useEffect, useMemo, useRef, useState } from 'react'
import { binCounts } from '../utils/browse'
import { t } from '../i18n'
import './AisleSheet.css'

/**
 * The "Aisles" browse sheet (§ Phase 2): pick a browse axis (Genre, Artist,
 * Decade, Format, Label…), then tap a bin to filter the collection to it —
 * like walking to a bin in a record shop. Bins show live counts and are A–Z
 * sorted. Choosing a bin applies the filter and closes the sheet.
 */
export default function AisleSheet({ axes = [], items = [], activeAisle = null, onPick, onClear, onClose, copy = {} }) {
  const browse = copy.browse || {}
  const closeRef = useRef(null)
  const [axisId, setAxisId] = useState(activeAisle?.axisId || axes[0]?.id || '')

  const axis = axes.find((a) => a.id === axisId) || axes[0]
  const bins = useMemo(() => (axis ? binCounts(items, axis) : []), [items, axis])

  // Focus into the sheet on open; Esc closes.
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeOnThisAxis = activeAisle && activeAisle.axisId === axis?.id ? activeAisle.value : null

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={browse.title || 'Browse'}>
      <div className="sheet aisle-sheet">
        <div className="sheet-header">
          <h2>{browse.title || 'Browse'}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        {axes.length > 1 && (
          <div className="aisle-axes">
            {axes.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`aisle-axis-chip${a.id === axis?.id ? ' active' : ''}`}
                onClick={() => setAxisId(a.id)}
                aria-pressed={a.id === axis?.id}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        <div className="aisle-bins">
          {bins.length === 0 && (
            <p className="aisle-empty">{browse.empty || 'Nothing to show here yet.'}</p>
          )}
          {bins.map((bin) => (
            <button
              key={bin.value}
              type="button"
              className={`aisle-bin${activeOnThisAxis === bin.value ? ' active' : ''}`}
              onClick={() => { onPick(axis.id, bin.value); onClose() }}
              aria-pressed={activeOnThisAxis === bin.value}
            >
              <span className="aisle-bin-label">{bin.value}</span>
              <span className="aisle-bin-count">{bin.count}</span>
            </button>
          ))}
        </div>

        <div className="sheet-actions aisle-actions">
          {activeAisle && (
            <button type="button" className="btn btn-ghost" onClick={() => { onClear(); onClose() }}>
              {browse.clear || 'Clear browse'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
