// Shared lending date helpers (W7).
//
// `dueOn` is stored as an ISO date string — either a bare 'YYYY-MM-DD' (from
// <input type="date">) or a full ISO timestamp. Both the detail sheet
// (LendingControls) and the grid on-loan badge derive "overdue" from it, so
// the day-granularity, local comparison lives here once.

// Parse an ISO date string as *local* midnight so the day the user picked is
// the day we compare — a bare 'YYYY-MM-DD' would otherwise parse as UTC and
// drift a day in timezones behind UTC.
export function toLocalDate(value) {
  const raw = String(value || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(raw)
}

// Overdue once the due date (day-granularity, local) is strictly before
// today. Safe for missing / malformed values — returns false (never throws),
// which keeps the no-error-boundary app from dark-screening on weird data.
export function isOverdue(value) {
  const due = toLocalDate(value)
  if (Number.isNaN(due.getTime())) return false
  const now = new Date()
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return dueDay < today
}
