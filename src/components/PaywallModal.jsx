import { useEffect, useRef, useState } from 'react'
import { recordsCatalog, booksCatalog } from '../catalog'
import * as paymentApi from '../api/payment'
import { t } from '../i18n'
import './PaywallModal.css'

// The paywall is a bottom sheet mounted once at App.jsx (ADR-0003 §3, S6). It
// only knows WHY it's open (reason + kind) — CollectionView reports the
// trigger, App decides what renders. All copy comes from the active catalog's
// `.copy.paywall` (crate vs shelf wording), falling back to the shared i18n
// `paywall.*` keys. The modal never hardcodes user-facing strings. (App's
// paywall state also carries an optional `feature` for future per-feature
// copy; the modal itself is parameterized by kind + reason.)
//
// States: idle → creating → redirecting (success) / error (inline + retry).
// The CTA is disabled while creating so a double-tap can't double-charge.

const CATALOGS = { records: recordsCatalog, books: booksCatalog }

// Reasons the collection flow can be blocked. Anything else falls back to the
// generic "upgrade" pitch (dark-screen safety — never assume a caller's input).
const VALID_REASONS = new Set(['cap', 'feature', 'upgrade', 'expired'])

// Mirrors FREE_PLAN_CAP (CollectionView) for `{cap}` interpolation. The server
// is authoritative; this only shapes the copy shown.
const DEFAULT_CAP = 10

export default function PaywallModal({ kind, reason, cap = DEFAULT_CAP, onClose }) {
  const catalog = CATALOGS[kind]
  const safeReason = VALID_REASONS.has(reason) ? reason : 'upgrade'

  const [phase, setPhase] = useState('idle') // idle | creating | redirecting | error
  const [errorMsg, setErrorMsg] = useState('')
  const closeRef = useRef(null)

  // Focus into the sheet on open; Esc closes (same pattern as Stats/Aisles).
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // A missing catalog means the caller asked for a kind we don't ship — render
  // nothing rather than a broken sheet (there's no error boundary).
  if (!catalog) return null

  const pc = catalog.copy?.paywall || {}
  const reasonCopy = pc.reason?.[safeReason] || {}
  const collectionLabel = catalog.collectionLabel || 'collection'
  const capText = String(Number.isFinite(Number(cap)) ? Number(cap) : DEFAULT_CAP)

  // Resolve copy: `.copy.paywall` wins, i18n `paywall.*` is the fallback, and
  // `{cap}` / `{collectionLabel}` placeholders are interpolated defensively at
  // render so a stale catalog string can never leak a raw token to the UI.
  const resolve = (value, key) => String(value || t(key, { collectionLabel, cap: capText }))
    .replaceAll('{cap}', capText)
    .replaceAll('{collectionLabel}', collectionLabel)

  const title = resolve(reasonCopy.title || pc.title, `paywall.reason.${safeReason}.title`)
  const body = resolve(reasonCopy.body || pc.body, `paywall.reason.${safeReason}.body`)
  const cta = pc.cta || t('paywall.cta')
  const secondary = pc.secondary || t('paywall.secondary')
  const priceLine = pc.priceLine || t('paywall.priceLine')
  const creatingLabel = pc.creating || t('paywall.creating')
  const plan = pc.plan || 'lifetime'

  const busy = phase === 'creating' || phase === 'redirecting'

  async function handleUpgrade() {
    if (busy) return // no double-charge: a tap while creating is a no-op
    setPhase('creating')
    setErrorMsg('')
    try {
      const data = await paymentApi.createCheckout(plan)
      const url = data?.url
      // Only ever navigate to an http(s) URL — never to a `javascript:` or
      // relative string the server might echo (ADR-0003 §2.5).
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new Error(pc.checkoutError || t('paywall.checkoutError'))
      }
      setPhase('redirecting')
      // `location.assign` (not window.open) — keeps the tab + PWA context and
      // lets the post-checkout redirect land back on this shell.
      window.location.assign(url)
    } catch (err) {
      setPhase('error')
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setErrorMsg(offline
        ? (pc.offline || t('paywall.offline'))
        : (err?.message || pc.checkoutError || t('paywall.checkoutError')))
    }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet paywall-sheet">
        <div className="sheet-header">
          <h2>{title}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="paywall-body">
          <p className="paywall-copy">{body}</p>
          <p className="paywall-price">{priceLine}</p>

          {phase === 'error' && (
            <p className="paywall-error" role="alert">{errorMsg}</p>
          )}

          <div className="sheet-actions paywall-actions">
            <button
              type="button"
              className="btn btn-primary btn-block paywall-upgrade"
              onClick={handleUpgrade}
              disabled={busy}
            >
              {busy ? creatingLabel : cta}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={onClose}
              disabled={busy}
            >
              {secondary}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
