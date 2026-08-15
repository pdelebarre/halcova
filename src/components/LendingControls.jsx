import { useEffect, useRef, useState } from 'react'
import { t, getLocale } from '../i18n'
import { isOverdue, toLocalDate, addDays } from '../utils/lending'
import { classifyContact } from '../utils/contact'
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

export default function LendingControls({ item, catalog, lendingEnabled, lendingGate = false, onLend, onReturn, showToast, onOpenPaywall, wrapperRef }) {
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
  if (!lendingEnabled) {
    // S6 gated affordance: a free member sees a "Lending is Premium" entry
    // that opens the paywall (reason 'feature'). Demo visitors and anyone else
    // without the gate get nothing, exactly as before.
    if (!lendingGate) return null
    return (
      <div className="lending-gate" ref={wrapperRef}>
        <p className="lending-gate-title">{lending.featureLabel || 'Lending'}</p>
        <p className="lending-gate-body">{t('lending.notEnabled')}</p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => onOpenPaywall?.({ reason: 'feature', feature: 'lending' })}
        >
          {t('paywall.cta')}
        </button>
      </div>
    )
  }

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
    } catch (err) {
      // Defensive: if the server rejects a lend because lending isn't entitled
      // (e.g. a plan expired mid-session), surface the paywall rather than a
      // generic save error.
      if (err?.code === 'PAYMENT_REQUIRED') {
        onOpenPaywall?.({ reason: 'feature', feature: 'lending' })
        notify(t('lending.notEnabled'), 'error')
      } else {
        notify(t('view.couldNotSave'), 'error')
      }
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

  // A5.2 / B5 Phase 1 — device-native "Remind": opens the share sheet with a
  // pre-filled localized message when navigator.share exists; otherwise copies
  // the same text and toasts `lending.remindCopied`. No server, works offline.
  async function handleRemind() {
    const borrowerName = item?.lending?.borrower?.name || ''
    const title = item?.title || ''
    const dueText = item?.lending?.dueOn ? formatDate(item.lending.dueOn) : ''
    const message = typeof lending.remindMessage === 'function'
      ? lending.remindMessage(borrowerName, title, dueText)
      : ''
    if (!message) return
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: message })
      } catch {
        // User dismissed the share sheet (AbortError) — not an error to toast.
      }
      return
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(message)
        if (typeof lending.remindCopied === 'function') notify(lending.remindCopied(borrowerName))
      } catch {
        // Clipboard unavailable (e.g. non-secure context) — nothing to toast.
      }
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
    // A5.6 (#117): the section is the deep-link anchor — tabIndex={-1} lets
    // the card icon focus it programmatically (it never enters the tab order).
    <section className="lending" ref={wrapperRef} tabIndex={-1}>
      <p className="detail-section-label">{lending.section}</p>

      {isOut ? (
        <div className="lending-status">
          <p className={status.overdue ? 'lending-status-overdue' : undefined}>{status.lentLine}</p>
          {status.dueLine && (
            <p className={status.overdue ? 'lending-status-overdue' : undefined}>{status.dueLine}</p>
          )}
          {/* A5.1 — one-tap contact action when a contact is stored: the
              stored string classifies to exactly one action (Call/Email/Message).
              Unclassifiable contacts render nothing (no dead link). */}
          <div className="lending-status-actions">
            {(() => {
              const contact = item?.lending?.borrower?.contact
              if (!contact) return null
              const target = classifyContact(contact)
              if (!target.type || !target.href) return null
              const label = target.type === 'tel'
                ? lending.contactCall
                : target.type === 'email'
                  ? lending.contactEmail
                  : lending.contactMessage
              return (
                <a className="btn btn-sm btn-ghost lending-contact-action" href={target.href}>
                  {label}
                </a>
              )
            })()}
            {/* A5.2 — device-native Remind (share sheet / clipboard + toast). */}
            <button
              type="button"
              className="btn btn-sm btn-ghost lending-remind"
              onClick={handleRemind}
              disabled={busy}
            >
              {lending.remind}
            </button>
            <button
              type="button"
              className={`btn ${confirmReturn ? 'btn-confirm' : 'btn-ghost'}`}
              onClick={handleReturn}
              disabled={busy}
            >
              {confirmReturn ? lending.returnConfirm : lending.return}
            </button>
          </div>
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
            {/* A5.3 — due-date presets: today + 1w / 2w / 1m via local-day
                math (addDays). The free-form date input stays the 4th option. */}
            <div className="lending-presets">
              {[
                { key: 'due1w', days: 7 },
                { key: 'due2w', days: 14 },
                { key: 'due1m', days: 30 },
              ].map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`lending-preset${dueDate === addDays(undefined, preset.days) ? ' active' : ''}`}
                  onClick={() => setDueDate(addDays(undefined, preset.days))}
                >
                  {lending[preset.key]}
                </button>
              ))}
            </div>
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
          {/* A5.5 — honesty about the 10-loan cap once history is full. */}
          {history.length >= 10 && (
            <p className="lending-history-cap">{lending.historyCapNote}</p>
          )}
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
