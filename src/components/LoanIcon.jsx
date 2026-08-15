// A5.6 (#117): compact, clickable "on loan" icon for grid cards and list rows.
// Replaces the old text badge ("On loan" / "Overdue") — tapping it opens the
// item's lend card (detail sheet scrolled + focused on LendingControls).
//
// Cards and list rows are <button>s, so this is deliberately a NON-button
// element with role="button" (button-in-button is invalid HTML — hard a11y
// requirement). It is reachable by Tab, activates on Enter/Space, and
// stopPropagation/preventDefault keep the parent card from double-firing.
// Overdue loans get a danger dot + ring so urgency stays visible without text.
//
// Props:
//   overdue    – bool: render the overdue affordance (danger dot + ring).
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
