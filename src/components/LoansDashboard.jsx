import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api/collection'
import * as apiLending from '../api/lending'
import { t, getLocale } from '../i18n'
import { splitArtistTitle } from '../utils/match'
import { isOverdue, toLocalDate } from '../utils/lending'
import './LoansDashboard.css'

// Sort control options — labels via t() so they localize.
const SORT_OPTIONS = [
  { value: 'lent', labelKey: 'lending.sortLent' },
  { value: 'due', labelKey: 'lending.sortDue' },
  { value: 'borrower', labelKey: 'lending.sortBorrower' },
  { value: 'title', labelKey: 'lending.sortTitle' },
]

// Format an ISO date as a localized date (day-granularity, local time).
// Defensive: returns '' for missing / malformed values so weird shapes don't
// crash the row (no error boundary in this app).
function formatDate(value) {
  const d = toLocalDate(value)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(getLocale()).format(d)
  } catch {
    return ''
  }
}

/**
 * Global "On loan" dashboard (W7): every item currently on loan across BOTH
 * records and books, with case-insensitive search (title/artist + borrower
 * name) and 4 sort modes, plus a two-step "Mark returned" action. Rendered by
 * App.jsx as a full-screen sheet — only when the member has the `lending`
 * feature flag.
 *
 * Props contract:
 *   open            – boolean. When it flips to true the dashboard loads once
 *                     (Promise.all of both listItems calls) and refocuses the
 *                     search input.
 *   onClose()       – close (Esc / ✕). Focus returns to the Loans button.
 *   onLoanReturned()– fired after a successful return so App can bump
 *                     `refreshTick` and refresh the visible collection.
 *   returnFocusRef  – ref to the Toolbar "Loans" button (focus restore).
 */
export default function LoansDashboard({ open = false, onClose, onLoanReturned, returnFocusRef }) {
  const [loans, setLoans] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('lent')
  const [returningId, setReturningId] = useState(null)
  const [confirmId, setConfirmId] = useState(null) // item id armed for the confirm step
  const [notice, setNotice] = useState(null) // { msg, kind: 'ok' | 'error' }
  const searchRef = useRef(null)
  const confirmTimer = useRef(null)
  const queryRef = useRef('') // mirrors `query` for the Esc handler's closure

  // Keep queryRef in sync with the search input — the open-effect's keydown
  // closure is created once, so it can't read `query` directly.
  useEffect(() => { queryRef.current = query }, [query])

  // Fetch both collections once, tag each loan with its kind/entity, keep only
  // items that are currently on loan (item.lending present).
  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const [records, books] = await Promise.all([api.listItems('records'), api.listItems('books')])
      const merged = [
        ...records.map((it) => ({ ...it, kind: 'records', entity: 'record' })),
        ...books.map((it) => ({ ...it, kind: 'books', entity: 'book' })),
      ].filter((it) => !!it?.lending)
      setLoans(merged)
      setStatus('ready')
    } catch (err) {
      setError(err?.message || '')
      setStatus('error')
    }
  }, [])

  function close() {
    // Focus returns to the Loans button that opened the dashboard.
    if (returnFocusRef?.current) returnFocusRef.current.focus()
    onClose?.()
  }

  // On open: fetch once, focus the search input, reset transient state; Esc
  // closes (focus returning to the Loans button).
  useEffect(() => {
    if (!open) return undefined
    load()
    setQuery('')
    setSortBy('lent')
    setNotice(null)
    setConfirmId(null)
    const raf = window.requestAnimationFrame(() => searchRef.current?.focus())
    function onKey(e) {
      if (e.key !== 'Escape') return
      // First Esc inside a non-empty search clears it (mirrors the FilterSheet
      // combobox); a second Esc — or any Esc when the search is already empty —
      // closes the sheet.
      const active = document.activeElement
      const inSearch = searchRef.current && (active === searchRef.current || searchRef.current.contains(active))
      if (inSearch && queryRef.current) {
        setQuery('')
        return
      }
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Auto-hide the transient toast.
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => () => { if (confirmTimer.current) window.clearTimeout(confirmTimer.current) }, [])

  // Search: title, artist, and borrower name — case-insensitive.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return loans
    return loans.filter((it) => {
      const { artist, album } = splitArtistTitle(it.title)
      return (
        (it.title || '').toLowerCase().includes(q) ||
        artist.toLowerCase().includes(q) ||
        album.toLowerCase().includes(q) ||
        (it.lending?.borrower?.name || '').toLowerCase().includes(q)
      )
    })
  }, [loans, query])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const locale = getLocale()
    if (sortBy === 'borrower') {
      list.sort((a, b) => (a.lending?.borrower?.name || '').localeCompare(b.lending?.borrower?.name || '', locale))
    } else if (sortBy === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || '', locale))
    } else if (sortBy === 'due') {
      // Overdue first, then soonest dueOn, no-due last.
      list.sort((a, b) => {
        const aOver = isOverdue(a.lending?.dueOn) ? 1 : 0
        const bOver = isOverdue(b.lending?.dueOn) ? 1 : 0
        if (aOver !== bOver) return bOver - aOver
        const aDue = a.lending?.dueOn ? toLocalDate(a.lending.dueOn).getTime() : Infinity
        const bDue = b.lending?.dueOn ? toLocalDate(b.lending.dueOn).getTime() : Infinity
        if (aDue !== bDue) return aDue - bDue
        return (a.title || '').localeCompare(b.title || '', locale)
      })
    } else {
      // 'lent' (default): newest lentOn first.
      list.sort((a, b) => {
        const aLent = a.lending?.lentOn ? new Date(a.lending.lentOn).getTime() : 0
        const bLent = b.lending?.lentOn ? new Date(b.lending.lentOn).getTime() : 0
        return bLent - aLent
      })
    }
    return list
  }, [filtered, sortBy])

  // Return: call the lending API, drop the row on success (+ notify App so the
  // visible collection refreshes), keep it and surface an error on failure.
  async function doReturn(item) {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirmId(null)
    setReturningId(item.id)
    try {
      await apiLending.returnItem({ collection: item.kind, itemId: item.id })
      setLoans((prev) => prev.filter((it) => it.id !== item.id))
      setNotice({ msg: t('lending.returnedToast'), kind: 'ok' })
      onLoanReturned?.()
    } catch {
      setNotice({ msg: t('view.couldNotSave'), kind: 'error' })
    } finally {
      setReturningId(null)
    }
  }

  // Two-step confirm (mirrors LendingControls): first tap arms the confirm
  // label, second tap executes; auto-reverts after ~3s.
  function onReturnClick(item) {
    if (confirmId === item.id) {
      doReturn(item)
      return
    }
    setConfirmId(item.id)
    confirmTimer.current = window.setTimeout(() => setConfirmId(null), 3000)
  }

  if (!open) return null

  return (
    <div className="sheet-overlay loans-overlay" role="dialog" aria-modal="true" aria-label={t('lending.dashboardTitle')}>
      <div className="sheet loans-sheet">
        <div className="sheet-header">
          <h2>{t('lending.dashboardTitle')}{status === 'ready' && loans.length > 0 ? ` (${loans.length})` : ''}</h2>
          <button type="button" className="sheet-close" onClick={close} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="loans-controls">
          <div className="loans-search">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('lending.dashboardSearch')}
              aria-label={t('lending.dashboardSearch')}
              autoComplete="off"
            />
          </div>
          <div className="loans-sort">
            <label className="visually-hidden" htmlFor="loans-sort">{t('lending.dashboardSort')}</label>
            <select
              id="loans-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label={t('lending.dashboardSort')}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="loans-scroll">
          {status === 'loading' && <p className="sheet-status">{t('common.loading')}</p>}

          {status === 'error' && (
            <div className="loans-error">
              <p className="sheet-error">{error || t('view.couldNotReach', { error: '' })}</p>
              <button type="button" className="btn btn-ghost" onClick={load}>{t('common.tryAgain')}</button>
            </div>
          )}

          {status === 'ready' && loans.length === 0 && (
            <p className="sheet-empty">{t('lending.dashboardEmpty')}</p>
          )}

          {status === 'ready' && loans.length > 0 && sorted.length === 0 && (
            <div className="sheet-empty">
              <p>{t('list.nothingMatches')}</p>
              <p className="loans-no-results-sub">{t('list.tryDifferentSearch')}</p>
            </div>
          )}

          {status === 'ready' && sorted.length > 0 && (
            <ul className="loans-list">
              {sorted.map((item) => (
                <LoanRow
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  returning={returningId === item.id}
                  confirming={confirmId === item.id}
                  onReturnClick={() => onReturnClick(item)}
                />
              ))}
            </ul>
          )}
        </div>

        {notice && (
          <div className={`loans-notice loans-notice-${notice.kind}`} role="status" aria-live="polite">
            {notice.msg}
          </div>
        )}
      </div>
    </div>
  )
}

// One loan row: kind chip, title, artist, borrower + lent date, due/overdue
// line, and the two-step "Mark returned" action.
function LoanRow({ item, returning, confirming, onReturnClick }) {
  const { artist, album } = splitArtistTitle(item.title)
  const lending = item?.lending || {}
  const dueOn = lending.dueOn
  const overdue = !!(dueOn && isOverdue(dueOn))
  const lentDate = formatDate(lending.lentOn)
  const dueDate = formatDate(dueOn)
  let dueLine = null
  if (dueOn) {
    dueLine = overdue
      ? t('lending.dashboardOverdue', { date: dueDate })
      : t('lending.dashboardDue', { date: dueDate })
  }
  const actionLabel = confirming ? t('lending.returnConfirm') : t('lending.return')

  return (
    <li className={`loan-row${overdue ? ' is-overdue' : ''}`}>
      <div className="loan-row-main">
        <span className="loan-title">
          <span className={`loan-kind loan-kind-${item.kind}`}>{t(`kind.${item.kind}`)}</span>
          <span className="loan-title-text">{album || item.title}</span>
        </span>
        {artist && <span className="loan-artist">{artist}</span>}
        <span className="loan-meta">
          {lending.borrower?.name && (
            <span className="loan-status-out">{t('lending.statusOut', { name: lending.borrower.name, date: lentDate })}</span>
          )}
          {dueLine && (
            <span className={`loan-due${overdue ? ' loan-due-overdue' : ''}`}>{dueLine}</span>
          )}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-sm loans-return${confirming ? ' btn-confirm' : ' btn-ghost'}`}
        onClick={onReturnClick}
        disabled={returning}
        aria-label={actionLabel}
      >
        {returning ? t('common.loading') : actionLabel}
      </button>
    </li>
  )
}
