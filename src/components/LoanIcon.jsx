// A5.6 (#117): compact, clickable "on loan" icon for grid cards and list rows.
// Replaces the old text badge ("On loan" / "Overdue") — tapping it opens the
// item's lend card (detail sheet scrolled + focused on LendingControls).
//
// Cards and list rows are <button>s, so this is deliberately a NON-button
// element with role="button" (button-in-button is invalid HTML — hard a11y
// requirement). It is reachable by Tab, activates on Enter/Space, and
// stopPropagation/preventDefault keep the parent card from double-firing.
//
// P1-1 (color-blind safe): overdue is NOT hue-only. The `.overdue` class fills
// the pill with --danger-bright and drops a dark glyph on it (mirrors
// .btn-confirm's dark-on-gold), plus a 12px danger dot — so on-loan (green
// glyph, dark chip) and overdue (dark glyph, filled danger chip) differ by
// area/fill as well as hue. The isOverdue NaN guard lives in the callers
// (AlbumCard / BookCard / ListView via src/utils/lending.js).
//
// Props:
//   overdue    – bool: render the overdue affordance (filled pill + dot).
//   label      – the accessible name (catalog.copy.lending.manageLoan*).
//   onActivate – callback fired on click / Enter / Space.

export default function LoanIcon({ overdue = false, label, onActivate }) {
  function handleClick(e) {
    // Never let this click bubble to the parent <button> (would open the
    // plain detail) and never trigger a nested-button default action.
    e.preventDefault()
    e.stopPropagation()
    onActivate?.()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      e.stopPropagation()
      onActivate?.()
    }
  }

  return (
    <span
      className={`loan-icon${overdue ? ' overdue' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Exchange arrows — "out and back": the item went out on loan. */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 7h10" />
        <path d="M17 7l-3-3" />
        <path d="M17 7l-3 3" />
        <path d="M17 17H7" />
        <path d="M7 17l3-3" />
        <path d="M7 17l3 3" />
      </svg>
      {overdue && <span className="loan-icon-dot" aria-hidden="true" />}
    </span>
  )
}
