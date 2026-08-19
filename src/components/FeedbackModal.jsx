import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import * as feedbackApi from '../api/feedback'
import { APP_VERSION, deviceLabel } from '../utils/appInfo'
import './FeedbackModal.css'

// Message length cap — mirrors the server (006_feedback.sql CHECK + the
// MESSAGE_MAX in netlify/functions/feedback.js). Enforced with maxLength AND a
// slice in onChange so a pasted/automated value can never exceed it (a 400 or a
// runaway counter is a dark-screen-adjacent failure we don't want).
const MESSAGE_MAX = 4000

// Category allow-list — mirrors FEEDBACK_CATEGORIES in
// netlify/functions/feedback.js. Only these values are accepted by the server;
// anything else 400s with INVALID_CATEGORY, so the chips must never send a
// label we invented. `auth` is shown to users as "Account".
const CATEGORIES = ['records', 'books', 'scanner', 'auth', 'billing', 'games', 'lending', 'other']

const TYPES = ['suggestion', 'bug']

export default function FeedbackModal({ onClose, initialType = 'suggestion' }) {
  const [type, setType] = useState(initialType === 'bug' ? 'bug' : 'suggestion')
  const [category, setCategory] = useState(null) // null → server default 'other' (optional)
  const [message, setMessage] = useState('')
  const [includeContext, setIncludeContext] = useState(true) // pre-checked auto-context
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [errorCode, setErrorCode] = useState(null)
  const [referenceId, setReferenceId] = useState(null)
  const doneRef = useRef(null)

  // The page the user was on when the modal opened — captured once so a retry
  // after an error doesn't pick up a stale/different route. Guarded: a missing
  // window (SSR/tests) yields '' instead of throwing.
  const route = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const { pathname, search, hash } = window.location
    return pathname + search + hash
  }, [])
  const device = useMemo(() => deviceLabel(), [])

  // When a submit lands, move focus to the confirmation action so a keyboard
  // or screen-reader user is on the next step instead of a scrolled form.
  useEffect(() => {
    if (status === 'success') doneRef.current?.focus()
  }, [status])

  const canSubmit = message.trim().length > 0 && status !== 'submitting'

  async function handleSubmit() {
    if (!canSubmit) return
    setStatus('submitting')
    setErrorCode(null)
    const payload = {
      type,
      category: category || 'other',
      message: message.trim(),
    }
    if (includeContext) {
      if (route) payload.url = route
      if (APP_VERSION) payload.appVersion = APP_VERSION
    }
    try {
      const created = await feedbackApi.submitFeedback(payload)
      // The server's uuid becomes the reference id ("#fb-xxxx") — short enough
      // to read back out loud on the confirmation card. A missing id degrades
      // to a fallback line instead of throwing (dark-screen safety).
      setReferenceId(created?.id ? `#fb-${String(created.id).slice(0, 8)}` : t('feedback.referenceUnknown'))
      setStatus('success')
    } catch (err) {
      // Coded failure (NO_TOKEN, RATE_LIMIT, MESSAGE_TOO_LONG, DEMO_READONLY
      // …) → map to a friendly line; anything unknown degrades to generic
      // copy. Never throws uncaught.
      setErrorCode(err?.code || null)
      setStatus('error')
    }
  }

  function errorCopy() {
    switch (errorCode) {
      case 'NO_TOKEN': return t('feedback.error.NO_TOKEN')
      // SEC-7.4 (#341): the server 429 code is now RATE_LIMIT (was RATE_LIMITED).
      case 'RATE_LIMIT': return t('feedback.error.RATE_LIMITED')
      case 'MESSAGE_TOO_LONG': return t('feedback.error.MESSAGE_TOO_LONG')
      case 'DEMO_READONLY': return t('feedback.error.DEMO_READONLY')
      default: return t('feedback.error.generic')
    }
  }

  if (status === 'success') {
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('feedback.title')}>
        <div className="sheet feedback-sheet">
          <div className="sheet-header">
            <h2>{t('feedback.title')}</h2>
            <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
          </div>
          <div className="feedback-success" role="status" aria-live="polite">
            <div className="feedback-success-mark" aria-hidden="true">✓</div>
            <h3 className="feedback-success-title">{t('feedback.successTitle')}</h3>
            <p className="feedback-success-body">{t('feedback.successBody', { ref: referenceId })}</p>
            <p className="feedback-success-ref">{referenceId}</p>
            <button
              type="button"
              ref={doneRef}
              className="btn btn-primary btn-block feedback-done"
              onClick={onClose}
            >
              {t('feedback.done')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('feedback.title')}>
      <div className="sheet feedback-sheet">
        <div className="sheet-header">
          <h2>{t('feedback.title')}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <p className="feedback-subtitle">{t('feedback.subtitle')}</p>

        {/* Segmented Suggestion / Report a problem — a mutually-exclusive
            choice, exposed as toggle buttons with aria-pressed. */}
        <div className="feedback-type" role="group" aria-label={t('feedback.typeLabel')}>
          {TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              aria-pressed={type === ty}
              className={`feedback-type-btn${type === ty ? ' active' : ''}`}
              onClick={() => setType(ty)}
            >
              {t(ty === 'bug' ? 'feedback.type.bug' : 'feedback.type.suggestion')}
            </button>
          ))}
        </div>

        <div className="feedback-group">
          <span className="feedback-label">{t('feedback.categoryLabel')}</span>
          <div className="feedback-categories" role="group" aria-label={t('feedback.categoryLabel')}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                className={`feedback-chip${category === c ? ' active' : ''}`}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {t(`feedback.category.${c}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="feedback-group">
          <label className="feedback-message-head" htmlFor="feedback-message">
            <span>{t('feedback.messageLabel')}</span>
            <span className={`feedback-counter${message.length >= MESSAGE_MAX ? ' at-max' : ''}`}>
              {t('feedback.charCount', { n: message.length, max: MESSAGE_MAX })}
            </span>
          </label>
          <textarea
            id="feedback-message"
            className="feedback-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
            maxLength={MESSAGE_MAX}
            placeholder={t('feedback.messagePlaceholder')}
            rows={5}
          />
        </div>

        {/* Auto-context row — pre-checked. The route + app version ride along in
            the body; the device is also captured server-side from the UA header
            (transparency line here so the submitter knows what ships). */}
        <label className="feedback-context">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
          />
          <span className="feedback-context-body">
            <span className="feedback-context-title">{t('feedback.contextLabel')}</span>
            <span className="feedback-context-detail">
              {t('feedback.contextDetail', {
                route: route || t('feedback.contextEmpty'),
                version: APP_VERSION || t('feedback.contextEmpty'),
                device: device || t('feedback.contextEmpty'),
              })}
            </span>
          </span>
        </label>

        {status === 'error' && (
          <p className="feedback-error" role="alert">{errorCopy()}</p>
        )}

        <div className="sheet-actions">
          <button
            type="button"
            className="btn btn-primary btn-block feedback-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {status === 'submitting' ? t('feedback.submitting') : t('feedback.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
