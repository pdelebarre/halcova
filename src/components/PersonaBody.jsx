import { useEffect, useMemo, useRef, useState } from 'react'
import { computePersona } from '../utils/persona'
import { track } from '../utils/track'
import { downloadSvg } from '../utils/exportSvg'
import PersonaCard from './PersonaCard'
import './PersonaBody.css'

/**
 * Release 1.1 "Play" — Collection Persona body (issue #48). The persona card +
 * verdict + stats + export, extracted from PersonaModal so the standalone sheet
 * and the Play hub (PlayPanel) share one implementation. Owns the export
 * download + the `gamif_persona_generated` / `gamif_share_exported` events.
 *
 * Guarded + dark-screen-safe: missing item fields never throw, and an empty
 * collection renders the "add a record first" empty state.
 */
export default function PersonaBody({ items = [], catalog }) {
  const personaCopy = catalog?.copy?.gamif?.persona || {}
  const kind = catalog?.kind || 'records'
  const cardRef = useRef(null)
  const exportTimer = useRef(null)
  const [exported, setExported] = useState(false)

  const persona = useMemo(() => computePersona(items, catalog), [items, catalog])

  // Emit on view (track is default-off — a no-op unless the user opted in).
  useEffect(() => {
    if (!persona) return
    track('gamif_persona_generated', { kind, archetype: persona.archetypeId, shared: false })
  }, [persona, kind])

  useEffect(() => {
    return () => {
      if (exportTimer.current) clearTimeout(exportTimer.current)
    }
  }, [])

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
    <div className="persona-body">
      {loading && <p className="persona-empty">{personaCopy.loading || 'Loading…'}</p>}

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
          {exported && <output className="persona-exported">{personaCopy.shared || 'Card exported ✓'}</output>}
        </>
      )}
    </div>
  )
}
