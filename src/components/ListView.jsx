import { useEffect, useMemo, useRef, useState } from 'react'
import { splitArtistTitle } from '../utils/match'
import { isOverdue } from '../utils/lending'
import { t, getLocale } from '../i18n'
import './ListView.css'

const ROW_H = 56
const GROUP_H = 30
const OVERSCAN = 8

const BADGE_CLASS = { LP: 'lp', EP: 'ep', CD: 'cd', '7"': 'seven', '12"': 'lp' }

function letterOf(name, locale = 'en') {
  if (!name) return '#'
  const ch = name.trim().charAt(0).toUpperCase()
  // Use Intl.Collator to decide if the character is a "letter" in this locale,
  // so accented letters (É, Á, Ö, Ü, Ç) bucket correctly.
  try {
    const collator = new Intl.Collator(locale, { sensitivity: 'base' })
    // Compare against 'A' — if it sorts >= 'A' and the collator sees it as a letter
    if (/[\p{Letter}]/u.test(ch)) {
      // Bucket accented letters under their base form
      return ch
    }
  } catch { /* fall through */ }
  return /[A-Z]/.test(ch) ? ch : '#'
}

/**
 * Dense, windowed list view (§4.6, §4.18). Renders only the rows near the
 * viewport (fixed row heights keep the math cheap), with sticky letter group
 * headers when sorted by Artist A–Z and an A–Z jump rail on tablet/desktop.
 */
export default function ListView({ items = [], sortBy, onOpen, copy = {}, lendingEnabled = false }) {
  const scrollerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  const grouped = sortBy === 'artist'

  // Flatten items + optional letter group headers into fixed-height rows.
  const { rows, total } = useMemo(() => {
    const out = []
    let y = 0
    if (grouped) {
      let currentLetter = null
      for (const item of items) {
        const { artist } = splitArtistTitle(item.title)
        const letter = letterOf(artist, getLocale())
        if (letter !== currentLetter) {
          out.push({ type: 'header', label: letter, offset: y, height: GROUP_H })
          y += GROUP_H
          currentLetter = letter
        }
        out.push({ type: 'item', item, offset: y, height: ROW_H })
        y += ROW_H
      }
    } else {
      for (const item of items) {
        out.push({ type: 'item', item, offset: y, height: ROW_H })
        y += ROW_H
      }
    }
    return { rows: out, total: y }
  }, [items, grouped])

  const letters = useMemo(() => {
    if (!grouped) return []
    const seen = new Set()
    const result = []
    for (const r of rows) {
      if (r.type === 'header' && !seen.has(r.label)) {
        seen.add(r.label)
        result.push(r.label)
      }
    }
    return result
  }, [rows, grouped])

  useEffect(() => {
    function measure() {
      const el = scrollerRef.current
      if (el) setViewportH(el.clientHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  function onScroll(e) {
    setScrollTop(e.currentTarget.scrollTop)
  }

  // Visible window, walking back to always include the current sticky header.
  const rawStart = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  let startIndex = rawStart
  if (grouped) {
    for (let i = rawStart; i > 0; i--) {
      if (rows[i - 1].type === 'header') { startIndex = i - 1; break }
    }
  }
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = rows.slice(startIndex, endIndex)
  const padTop = visible.length ? visible[0].offset : 0
  const last = visible.at(-1)
  const padBottom = last ? total - (last.offset + last.height) : 0

  function jumpTo(letter) {
    const h = rows.find((r) => r.type === 'header' && r.label === letter)
    if (!h || !scrollerRef.current) return
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    scrollerRef.current.scrollTo({ top: h.offset, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <div className="list-view">
      {grouped && letters.length > 0 && (
        <nav className="jump-rail" aria-label={copy.list?.jumpRail || t('list.jumpToLetter')}>
          {letters.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => jumpTo(l)}
              aria-label={`${copy.list?.jumpTo || t('list.jumpTo')} ${l}`}
            >
              {l}
            </button>
          ))}
        </nav>
      )}

      <div
        className="list-scroller"
        ref={scrollerRef}
        onScroll={onScroll}
        aria-label={copy.list?.label || t('list.collectionList')}
      >
        <div className="list-inner" style={{ height: total }}>
          <div style={{ height: padTop }} aria-hidden="true" />
          {visible.map((r) => (
            r.type === 'header'
              ? <div key={`h-${r.label}`} className="list-group-header">{r.label}</div>
              : <ListItemRow key={r.item.id} item={r.item} onOpen={onOpen} lendingEnabled={lendingEnabled} copy={copy} />
          ))}
          <div style={{ height: padBottom }} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

function ListItemRow({ item, onOpen, lendingEnabled = false, copy = {} }) {
  const { artist, album } = splitArtistTitle(item.title)
  const meta = [item.label, item.catno, item.year].filter(Boolean)
  const badge = BADGE_CLASS[item.formatType] || 'other'

  // W7: on-loan badge — mirrors the grid card. Optional-chained + isOverdue's
  // NaN guard keep weird item shapes from crashing (no error boundary).
  const lending = item?.lending
  const isOnLoan = lendingEnabled && !!lending
  const overdue = isOnLoan && isOverdue(lending?.dueOn)
  const lendingBadge = overdue
    ? (copy.lending?.badgeOverdue || t('lending.badgeOverdue'))
    : (copy.lending?.badge || t('lending.badge'))
  const baseLabel = [artist, album].filter(Boolean).join(' — ') || t('list.collectionItem')

  return (
    <button
      type="button"
      className="list-row"
      onClick={() => onOpen(item)}
      aria-label={isOnLoan ? `${baseLabel} — ${lendingBadge}` : baseLabel}
    >
      <span className="list-cover" aria-hidden="true">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="list-cover-ph">{album?.[0] || '?'}</span>}
      </span>
      <span className="list-main">
        <span className="list-title">{album || item.title}</span>
        <span className="list-meta">
          {artist && <span className="list-artist">{artist}</span>}
          {meta.map((m) => (
            <span key={m} className={m === item.catno ? 'list-mono' : undefined}>
              {artist ? ' · ' : ''}{m}
            </span>
          ))}
        </span>
      </span>
      {item.formatType && <span className={`format-badge ${badge}`}>{item.formatType}</span>}
      {isOnLoan && (
        <span className={`list-lending-badge${overdue ? ' overdue' : ''}`} aria-hidden="true">{lendingBadge}</span>
      )}
      <svg className="list-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}
