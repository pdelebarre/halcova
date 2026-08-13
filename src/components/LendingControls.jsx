import { useEffect, useRef, useState } from 'react'
import { t, getLocale } from '../i18n'
import { isOverdue, toLocalDate } from '../utils/lending'
import './LendingControls.css'

// ---------------------------------------------------------------------------
// Shared lend / return controls, rendered by BOTH detail sheets (AlbumDetail +
// BookDetail). All user-facing copy comes from `catalog.copy.lending` —
// nothing is hardcoded here. Renders nothing when `lendingEnabled` is false.
//
// Props contract (supplied by the detail sheet):
//   item           – the catalog item. `item.lending` present ⇒ on loan
//                    (the server stores `item.lending`, no `status` field).
//   catalog        – the catalog object: `catalog.copy.lending` for copy and
//                    `catalog.entity` ('record' | 'book') for `lendTitle`.
//   lendingEnabled – gate: the whole component renders only when true.
//   onLend(payload)– async, optimistic (from useCollection), throws on failure.
//                    payload = { borrower: { name, contact? }, dueOn? }.
//   onReturn()     – async, optimistic (from useCollection), throws on failure.
//   showToast(msg, kind) – surface a toast ('add' | 'remove' | 'error').
//
// Note: the collection store is captured by the onLend/onReturn handlers in
// CollectionView, so this component doesn't need a `collection` prop itself.
// ---------------------------------------------------------------------------

// Date helpers now live in src/utils/lending.js (shared with the grid badge):
// toLocalDate parses an ISO string as local midnight — a bare 'YYYY-MM-DD'
// would otherwise parse as UTC and drift a day in timezones behind UTC — and
// isOverdue does the day-granularity, local comparison.

// Copy functions receive the *formatted* string — formatting lives here.
function formatDate(value) {
  const d = toLocalDate(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(getLocale()).format(d)
}

// Build the "on loan" status line(s) from item.lending. Returns null when the
// item is not on loan. All copy comes from catalog.copy.lending.
function buildStatus(item, lending) {
  const lendingState = item?.lending
  if (!lendingState) return null
  const dueOn = lendingState.dueOn
  const due = dueOn ? formatDate(dueOn) : ''
  const overdue = !!(dueOn && isOverdue(dueOn))
  let dueLine = null
  if (dueOn) dueLine = overdue ? lending.overdueSince(due) : lending.due(due)
  return {
    lentLine: lending.statusOut(lendingState.borrower?.name || '', formatDate(lendingState.lentOn)),
    dueLine,
    overdue,
  }
}

export default function LendingControls({ item, catalog, lendingEnabled, onLend, onReturn, showToast }) {
  const lending = catalog?.copy?.lending || {}

  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [nameError, setNameError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmReturn, setConfirmReturn] = useState(false)
  const nameRef = useRef(null)
  const confirmTimer = useRef(null)

  // Open form: focus the borrower field; Esc closes it.
  useEffect(() => {
    if (!formOpen) return undefined
    nameRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') {
        setFormOpen(false)
        setNameError(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [formOpen])

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  // No error boundary in this app — don't render anything when the flag is off.
  if (!lendingEnabled) return null

  const isOut = !!item.lending
  const status = buildStatus(item, lending)
  const history = Array.isArray(item?.lendingHistory) ? item.lendingHistory : []

  // Toast without assuming the parent always wired one up.
  function notify(msg, kind) {
    if (typeof showToast === 'function') showToast(msg, kind)
  }

  async function handleSubmitLend(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError(true)
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onLend({
        borrower: { name: trimmedName, ...(contact.trim() ? { contact: contact.trim() } : {}) },
        dueOn: dueDate || undefined,
      })
      notify(lending.lentToast(trimmedName))
      setFormOpen(false)
      setName('')
      setContact('')
      setDueDate('')
      setNameError(false)
    } catch {
      notify(t('view.couldNotSave'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function doReturn() {
    setBusy(true)
    try {
      await onReturn()
      notify(lending.returnedToast)
      setConfirmReturn(false)
    } catch {
      notify(t('view.couldNotSave'), 'error')
      setConfirmReturn(false)
    } finally {
      setBusy(false)
    }
  }

  // Return → two-step confirm (mirrors AlbumDetail's remove): first tap arms
  // the confirm label, second tap executes; auto-reverts after ~3s.
  function handleReturn() {
    if (confirmReturn) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      doReturn()
      return
    }
    setConfirmReturn(true)
    confirmTimer.current = window.setTimeout(() => setConfirmReturn(false), 3000)
  }

  return (
    <section className="lending">
      <p className="detail-section-label">{lending.section}</p>

      {isOut ? (
        <div className="lending-status">
          <p className={status.overdue ? 'lending-status-overdue' : undefined}>{status.lentLine}</p>
          {status.dueLine && (
            <p className={status.overdue ? 'lending-status-overdue' : undefined}>{status.dueLine}</p>
          )}
          <button
            type="button"
            className={`btn ${confirmReturn ? 'btn-confirm' : 'btn-ghost'}`}
            onClick={handleReturn}
            disabled={busy}
          >
            {confirmReturn ? lending.returnConfirm : lending.return}
          </button>
        </div>
      ) : (
        <div className="lending-idle">
          <p className="lending-not-on-loan">{lending.notOnLoan}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(true)}>
            {lending.lend}
          </button>
        </div>
      )}

      {formOpen && (
        <form className="lending-form" onSubmit={handleSubmitLend} noValidate>
          <h3 className="lending-form-title">{lending.lendTitle(catalog?.entity)}</h3>

          <div className="lending-field">
            <label htmlFor="lend-borrower">{lending.borrower}</label>
            <input
              id="lend-borrower"
              ref={nameRef}
              type="text"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError(false) }}
              placeholder={lending.borrowerPlaceholder}
              aria-invalid={nameError}
              aria-describedby={nameError ? 'lend-name-error' : undefined}
              autoComplete="off"
            />
            {nameError && (
              <p id="lend-name-error" className="detail-field-error" role="alert">{lending.nameRequired}</p>
            )}
          </div>

          <div className="lending-field">
            <label htmlFor="lend-contact">{lending.contact}</label>
            <input
              id="lend-contact"
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="lending-field">
            <label htmlFor="lend-due">{lending.dueDate}</label>
            <input
              id="lend-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="lending-form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setFormOpen(false); setNameError(false) }}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t('common.loading') : lending.confirmLend}
            </button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <div className="lending-history">
          <p className="detail-section-label">{lending.history}</p>
          <ul className="lending-history-list">
            {history.map((entry, i) => (
              <li key={`${entry?.returnedOn || entry?.lentOn || ''}-${i}`} className="lending-history-entry">
                <span className="lending-history-borrower">{entry?.borrower?.name || '—'}</span>
                <span className="lending-history-dates">
                  {(() => {
                    const lent = formatDate(entry?.lentOn)
                    const returned = entry?.returnedOn ? formatDate(entry.returnedOn) : ''
                    const parts = []
                    if (lent) parts.push(lending.historyLent(lent))
                    if (returned) parts.push(lending.historyReturned(returned))
                    return parts.join(' · ')
                  })()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
