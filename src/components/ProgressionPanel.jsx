import { useEffect, useMemo, useRef, useState } from 'react'
import { computeProgression } from '../utils/progression'
import { readLedger } from '../utils/progressionLedger'
import { deriveProfile } from '../utils/persona'
import { track } from '../utils/track'
import { downloadSvg } from '../utils/exportSvg'
import { t } from '../i18n'
import BadgeCard from './BadgeCard'
import './ProgressionPanel.css'

/**
 * Release 1.2 "Play" — XP / levels / badges panel (issue #45). Reads the owned
 * collection through computeProgression() — a PURE, idempotent derivation
 * (nothing is incremented in render) — plus the client-side gameplay ledger.
 *
 * - Level card: level title, XP bar to the next level, next-level caption.
 * - Badge grid: every badge for the kind, locked/unlocked, with deferred
 *   badges clearly marked "coming soon" (no impossible badges — req §7.3).
 * - Unlock toast + level-up toast fire ONCE per new unlock/level (remembered
 *   per kind in localStorage) and emit `gamif_badge_unlocked` /
 *   `gamif_level_up` (track is default-off).
 * - Badge share card: a leak-safe SVG (headline + badge name + 1–2 aggregate
 *   stats) exported via exportSvg.js — same pattern as the 1.1 persona card.
 *
 * Rendered inside the Play hub (PlayPanel) when GAMIFICATION_ENABLED is on.
 */
export default function ProgressionPanel({ items = [], catalog }) {
  const progCopy = (catalog?.copy?.gamif?.progression) || {}
  const personaCopy = (catalog?.copy?.gamif?.persona) || {}
  const kind = catalog?.kind === 'books' ? 'books' : 'records'

  const [toast, setToast] = useState(null) // { type, title, sub }
  const [toastPaused, setToastPaused] = useState(false) // hover/focus pauses auto-dismiss
  const [selected, setSelected] = useState(null) // { badge, stats } for share
  const [exported, setExported] = useState(false)
  const cardRef = useRef(null)
  const exportTimer = useRef(null)
  const toastTimer = useRef(null)

  const ledger = useMemo(() => readLedger(kind), [kind])
  const prog = useMemo(() => computeProgression(items, catalog, { ledger }), [items, catalog, ledger])
  // The single most-collected artist/author name (persona engine) — used to
  // interpolate {artist} into badge lines on the share card. One name only,
  // never lists (policy).
  const topArtist = useMemo(() => String(deriveProfile(items, kind).topArtist || ''), [items, kind])

  // --- one-time unlock detection (remembered per kind) -------------------
  useEffect(() => {
    const prevLevel = readStoredLevel(kind)
    if (prog.level.level > prevLevel) {
      writeStoredLevel(kind, prog.level.level)
      setToast({ type: 'level', title: prog.level.title, sub: prog.level.toast })
      track('gamif_level_up', { level: prog.level.level, kind })
    }
  }, [prog.level, kind])

  useEffect(() => {
    const seen = readSeenBadges(kind)
    const newly = prog.badges.filter((b) => b.unlocked && !seen.has(b.id))
    if (newly.length > 0) {
      const next = new Set(seen)
      newly.forEach((b) => next.add(b.id))
      writeSeenBadges(kind, next)
      const first = newly[0]
      setToast({ type: 'badge', id: first.id, title: first.title, sub: first.line })
      track('gamif_badge_unlocked', { badgeId: first.id, kind })
    }
  }, [prog.badges, kind])

  // Auto-dismiss the unlock/level toast — paused on hover/focus so the Share
  // action can't be missed (the Dismiss ✕ always stays).
  useEffect(() => {
    if (!toast) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    if (toastPaused) return
    toastTimer.current = setTimeout(() => setToast(null), 6000)
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [toast, toastPaused])

  useEffect(() => {
    return () => {
      if (exportTimer.current) clearTimeout(exportTimer.current)
    }
  }, [])

  // Export the selected badge's leak-safe share card.
  useEffect(() => {
    if (!selected) return
    const svgNode = cardRef.current?.querySelector?.('svg')
    if (!svgNode) return
    const ok = downloadSvg(svgNode, `halcova-${kind}-badge-${selected.badge.id}.svg`)
    if (ok) {
      track('gamif_share_exported', { kind, cardType: 'badge', badgeId: selected.badge.id })
      setExported(true)
      if (exportTimer.current) clearTimeout(exportTimer.current)
      exportTimer.current = setTimeout(() => setExported(false), 2400)
    }
    setSelected(null)
  }, [selected, kind])

  function handleShare(badge) {
    const countLabel = kind === 'books' ? (personaCopy.stats?.countBooks || 'Books') : (personaCopy.stats?.count || 'Records')
    const stats = [
      { label: countLabel, value: String(prog.xp.breakdown.owned) },
      { label: progCopy.xpLabel || 'XP', value: String(prog.xp.total) },
    ]
    // L4: interpolate {artist} in the badge line with the single top
    // artist/author name before the card renders — a raw token must never
    // reach the exported SVG. If there's no name to interpolate, keep the
    // line as-is.
    const line = topArtist ? interpolate(badge.line, { artist: topArtist }) : badge.line
    setSelected({ badge: { ...badge, line }, stats })
  }

  function toastKicker(toastObj) {
    if (toastObj.type === 'level') return interpolate(progCopy.levelToast, { level: toastObj.title })
    return interpolate(progCopy.unlockToast, { badge: toastObj.title })
  }

  const shareCopy = {
    headline: t('gamif.progression.shareHeadline', { badge: selected?.badge?.title || '' }),
    tagline: progCopy.shareTagline || '',
    hashtag: personaCopy.hashtag || '#WhatsInYourHalcova',
  }

  const empty = Array.isArray(items) && items.length === 0
  const pct = Math.round((prog.level.progress || 0) * 100)

  return (
    <div className="progression-panel">
      {toast && (
        <div
          className="prog-toast"
          role="status"
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
          onFocus={() => setToastPaused(true)}
          onBlur={() => setToastPaused(false)}
        >
          <div className="prog-toast-text">
            <span className="prog-toast-kicker">{toastKicker(toast)}</span>
            {toast.sub && <span className="prog-toast-sub">{toast.sub}</span>}
          </div>
          {toast.type === 'badge' && (
            <button type="button" className="btn btn-sm btn-primary prog-toast-share" onClick={() => handleShare({ id: toast.id, title: toast.title, line: toast.sub })}>
              {progCopy.share || 'Share'}
            </button>
          )}
          <button type="button" className="prog-toast-close" onClick={() => setToast(null)} aria-label={progCopy.toastClose || t('common.close')}>✕</button>
        </div>
      )}

      {empty ? (
        <div className="prog-empty">
          <p className="prog-empty-title">{progCopy.emptyTitle || 'No items yet'}</p>
          <p className="prog-empty-sub">{progCopy.emptySub || 'Catalog an item to start earning XP.'}</p>
        </div>
      ) : (
        <>
          <section className="prog-level-card" aria-label={progCopy.title || 'Progress'}>
            <p className="prog-level-kicker">{interpolate(progCopy.level, { n: String(prog.level.level) })}</p>
            <h3 className="prog-level-title">{prog.level.title}</h3>

            <div
              className="prog-xp-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={progCopy.title || 'XP'}
            >
              <div className="prog-xp-fill" style={{ width: `${pct}%` }} />
            </div>

            <p className="prog-xp-caption">
              {prog.level.nextThreshold != null
                ? interpolate(progCopy.toNext, { n: String(prog.level.nextThreshold - prog.xp.total), level: prog.level.title })
                : (progCopy.maxLevel || 'Max level')}
            </p>
            <p className="prog-xp-total">{progCopy.statXp ? progCopy.statXp(prog.xp.total) : `${prog.xp.total} XP`}</p>
          </section>

          <section className="prog-badges" aria-label={progCopy.badgesTitle || 'Badges'}>
            <h3 className="prog-badges-title">{progCopy.badgesTitle || 'Badges'}</h3>
            <ul className="prog-badge-grid">
              {prog.badges.map((b) => (
                <li
                  key={b.id}
                  className={`prog-badge${b.unlocked ? ' unlocked' : ''}${b.deferred ? ' deferred' : ''}`}
                  title={b.deferred ? b.reason : ''}
                >
                  <span className="prog-badge-mark" aria-hidden="true">{badgeMark(b)}</span>
                  <span className="prog-badge-name">{b.title}</span>
                  <span className="prog-badge-line">{badgeLine(b, progCopy)}</span>
                  {b.unlocked && !b.deferred && (
                    <button type="button" className="prog-badge-share" onClick={() => handleShare(b)}>
                      {progCopy.share || 'Share card'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {exported && <output className="prog-exported">{progCopy.shared || 'Card exported ✓'}</output>}
          </section>
        </>
      )}

      {selected && (
        <div ref={cardRef} className="visually-hidden" aria-hidden="true">
          <BadgeCard badge={selected.badge} copy={shareCopy} stats={selected.stats} />
        </div>
      )}
    </div>
  )
}

// --- guarded localStorage helpers (never throw) --------------------------

const LEVEL_KEY = (kind) => `runout.gamif.level.${kind}`
const SEEN_KEY = (kind) => `runout.gamif.badges.seen.${kind}`

function readStoredLevel(kind) {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY(kind)))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function writeStoredLevel(kind, level) {
  try {
    localStorage.setItem(LEVEL_KEY(kind), String(level))
  } catch { /* never throw */ }
}

function readSeenBadges(kind) {
  try {
    const raw = localStorage.getItem(SEEN_KEY(kind))
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeenBadges(kind, set) {
  try {
    localStorage.setItem(SEEN_KEY(kind), JSON.stringify([...set]))
  } catch { /* never throw */ }
}

/** Interpolate {token} placeholders; non-string templates yield ''. */
function interpolate(template, tokens) {
  if (typeof template !== 'string') return ''
  let out = template
  for (const [k, v] of Object.entries(tokens || {})) {
    out = out.split(`{${k}}`).join(String(v ?? ''))
  }
  return out
}

/** The badge tile's mark — unlocked ★, deferred …, locked ·. */
function badgeMark(badge) {
  if (badge.unlocked) return '★'
  return badge.deferred ? '…' : '·'
}

/** The badge tile's caption — the unlock joke, a "coming soon" note, or Locked. */
function badgeLine(badge, progCopy) {
  if (badge.unlocked) return badge.line
  if (badge.deferred) return progCopy.badgeComingSoon || 'Coming soon'
  return progCopy.badgeLocked || 'Locked'
}
