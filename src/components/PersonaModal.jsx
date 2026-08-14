import { useEffect, useRef } from 'react'
import { t } from '../i18n'
import PersonaBody from './PersonaBody'
import './PersonaModal.css'

/**
 * Release 1.1 "Play" — Collection Persona sheet (issue #48). A thin sheet shell
 * around the shared PersonaBody (card + stats + export). Kept as its own
 * component so the single-view entry point (and its tests) stay intact while
 * the Play hub (PlayPanel) reuses the same PersonaBody in a tabbed surface.
 *
 * Gated per account — CollectionView only mounts this when the member has the
 * admin-granted `features.games` entitlement (see App.jsx `gamesEnabled`).
 *
 * Events (default-off track, so harmless): `gamif_persona_generated` on view,
 * `gamif_share_exported` on export (both emitted by PersonaBody).
 */
export default function PersonaModal({ items = [], catalog, onClose }) {
  const personaCopy = catalog?.copy?.gamif?.persona || {}
  const closeRef = useRef(null)

  // Focus into the sheet on open; Esc closes (same pattern as Stats/Wishlist).
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={personaCopy.title || 'Your persona'}>
      <div className="sheet persona-sheet">
        <div className="sheet-header">
          <h2>{personaCopy.title || 'Your persona'}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <PersonaBody items={items} catalog={catalog} />
      </div>
    </div>
  )
}
