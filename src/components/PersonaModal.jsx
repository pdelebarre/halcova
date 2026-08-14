import { useEffect, useMemo, useRef, useState } from 'react'
import { computePersona } from '../utils/persona'
import { track } from '../utils/track'
import { downloadSvg } from '../utils/exportSvg'
import { t } from '../i18n'
import PersonaCard from './PersonaCard'
import './PersonaModal.css'

/**
 * Release 1.1 "Play" — Collection Persona (issue #48). A sheet that reads the
 * owned collection through computePersona() and shows the share card + stats,
 * with an export that downloads a self-contained SVG.
 *
 * Feature-flagged OFF by default — CollectionView only mounts this when
 * GAMIFICATION_ENABLED is true (catalog.js).
 *
 * Events (default-off track, so harmless): `gamif_persona_generated` on view,
 * `gamif_share_exported` on export.
 */
export default function PersonaModal({ items = [], catalog, onClose }) {
  const personaCopy = catalog?.copy?.gamif?.persona || {}
  const kind = catalog?.kind || 'records'
  const closeRef = useRef(null)
  const cardRef = useRef(null)
  const exportTimer = useRef(null)
  const [exported, setExported] = useState(false)

  const persona = useMemo(() => computePersona(items, catalog), [items, catalog])

  // Focus into the sheet on open; Esc closes (same pattern as Stats/Wishlist).
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (exportTimer.current) clearTimeout(exportTimer.current)
    }
  }, [onClose])

  // Emit on view (track is default-off — a no-op unless the user opted in).
  useEffect(() => {
    if (!persona) return
    track('gamif_persona_generated', { kind, archetype: persona.archetypeId, shared: false })
  }, [persona, kind])

  function handleExport() {
    const svgNode = cardRef.current?.querySelector?.('svg')
    if (!svgNode) return
    const ok = downloadSvg(svgNode, `halcova-${kind}-persona.svg`)
    if (!ok) return
    track('gamif_share_exported', { kind })
    setExported(true)
    if (exportTimer.current) clearTimeout(exportTimer.current)
    exportTimer.current = setTimeout(() => setExported(false), 2400)
  }

  const loading = items == null
  const empty = Array.isArray(items) && items.length === 0

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={personaCopy.title || 'Your persona'}>
      <div className="sheet persona-sheet">
        <div className="sheet-header">
          <h2>{personaCopy.title || 'Your persona'}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="persona-body">
          {loading && <p className="persona-empty">{personaCopy.loading || t('common.loading')}</p>}

          {empty && (
            <div className="persona-empty">
              <p className="persona-empty-title">{personaCopy.emptyTitle || 'Add a record first'}</p>
              <p className="persona-empty-sub">{personaCopy.emptySub || 'Scan or add an item and come back.'}</p>
            </div>
          )}

          {!loading && !empty && persona && (
            <>
              <div ref={cardRef} className="persona-card-wrap">
                <PersonaCard persona={persona} copy={personaCopy} />
              </div>

              <p className="persona-verdict">{persona.verdict}</p>

              <ul className="persona-stats" aria-label="Collection persona stats">
                {persona.stats.map((stat) => (
                  <li key={stat.key} className="persona-stat">
                    <span className="persona-stat-label">{stat.label}</span>
                    <span className="persona-stat-value">{stat.value}</span>
                  </li>
                ))}
              </ul>

              <button type="button" className="btn btn-primary persona-export" onClick={handleExport}>
                {personaCopy.share || 'Export card'}
              </button>
              {exported && <p className="persona-exported" role="status">{personaCopy.shared || 'Card exported ✓'}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
