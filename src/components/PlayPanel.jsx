import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import PersonaBody from './PersonaBody'
import ProgressionPanel from './ProgressionPanel'
import QuizPanel from './QuizPanel'
import StoriesPanel from './StoriesPanel'
import './PlayPanel.css'

/**
 * The "Play" hub (Phase 1 § Play) — one sheet hosting the four gamification
 * surfaces behind the feature flag:
 *   - Persona      (release 1.1 — Collection Persona + share card)
 *   - Progress     (release 1.2 — XP / levels / badges, issue #45)
 *   - Quiz         (release 1.3 — Crate Quiz + streaks, issue #50)
 *   - Stories      (release 1.4 — Shelf Stories, issue #44)
 *
 * Each tab reads the same owned collection through its pure engine, so all
 * three stay consistent. Gated per account — CollectionView only mounts this
 * when the member has the admin-granted `features.games` entitlement (see
 * App.jsx `gamesEnabled`).
 */
export default function PlayPanel({ items = [], catalog, onClose }) {
  const gamifCopy = (catalog?.copy?.gamif) || {}
  const tabs = gamifCopy.tabs || {}
  const [tab, setTab] = useState('persona')
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

  const title = gamifCopy.nav || 'Play'

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet play-sheet">
        <div className="sheet-header">
          <h2>{title}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="play-tabs" role="tablist" aria-label={title}>
          {[
            { id: 'persona', label: tabs.persona || 'Persona' },
            { id: 'quiz', label: tabs.quiz || 'Quiz' },
            { id: 'progression', label: tabs.progression || 'Progress' },
            { id: 'stories', label: tabs.stories || 'Stories' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`play-tab${tab === item.id ? ' active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="play-panel-body">
          {tab === 'persona' && <PersonaBody items={items} catalog={catalog} />}
          {tab === 'quiz' && <QuizPanel items={items} catalog={catalog} />}
          {tab === 'progression' && <ProgressionPanel items={items} catalog={catalog} />}
          {tab === 'stories' && <StoriesPanel items={items} catalog={catalog} />}
        </div>
      </div>
    </div>
  )
}
