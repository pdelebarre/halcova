import { useEffect, useRef, useState } from 'react'
import './SortMenu.css'

function useMedia(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * Sort options menu (§4.5): small popover anchored to the sort button on
 * desktop, a bottom sheet on mobile. `role="menu"` with radio items.
 */
export default function SortMenu({ options = [], value, onSelect, onClose, anchorRef, copy = {} }) {
  const isDesktop = useMedia('(min-width: 768px)')
  const menuRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [highlight, setHighlight] = useState(Math.max(0, options.findIndex((o) => o.value === value)))

  const focusIndex = (i) => {
    const items = menuRef.current?.querySelectorAll('[role="menuitemradio"]')
    items?.[i]?.focus()
  }

  // Anchor the popover under the sort button on desktop.
  useEffect(() => {
    if (!isDesktop) return undefined
    const el = anchorRef?.current
    if (!el) return undefined
    const r = el.getBoundingClientRect()
    const w = 232
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)
    setPos({ left, top: r.bottom + 8 })
    return undefined
  }, [anchorRef, isDesktop])

  useEffect(() => {
    focusIndex(highlight)
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  function handleKeys(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (highlight + 1) % options.length
      setHighlight(next)
      focusIndex(next)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (highlight - 1 + options.length) % options.length
      setHighlight(next)
      focusIndex(next)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[highlight]
      if (opt) onSelect(opt.value)
    }
  }

  return (
    <>
      <div className="sort-overlay" onClick={onClose} aria-hidden="true" />
      <ul
        ref={menuRef}
        className={isDesktop ? 'sort-menu' : 'sort-menu sort-menu--sheet'}
        role="menu"
        aria-label={copy.sortMenu?.label || 'Sort by'}
        style={isDesktop ? pos : undefined}
        onKeyDown={handleKeys}
      >
        {options.map((o, i) => (
          <li key={o.value}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              tabIndex={i === highlight ? 0 : -1}
              onClick={() => onSelect(o.value)}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="sort-check" aria-hidden="true">{o.value === value ? '✓' : ''}</span>
              <span>{o.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
