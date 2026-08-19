import { useEffect, useRef, useState } from 'react'
import { t, getLocale } from '../i18n'
import { useReviews } from '../hooks/useReviews'
import './ReviewsSection.css'

// ---------------------------------------------------------------------------
// Shared community-reviews section, rendered by BOTH detail sheets (records +
// books). All copy comes from `catalog.copy.reviews` (bridge) falling back to
// i18n `reviews.*` — nothing is hardcoded.
//
// Dark-screen safety: there is no error boundary in this app, so the section
// must NEVER throw. Every data path is guarded (optional chaining, Number()
// + isFinite, Array.isArray); a load failure renders a quiet fallback instead
// of the list; a submit/delete failure shows an inline message.
// ---------------------------------------------------------------------------

const STAR_MAX = 5

// Map server error codes to i18n copy. Anything else falls back to the raw
// message or a generic line — never a stack trace.
const ERROR_KEYS = {
  PLAN_FORBIDDEN: 'reviews.error.PLAN_FORBIDDEN',
  // SEC-7.4 (#341): the server 429 code is now RATE_LIMIT (was RATE_LIMITED).
  RATE_LIMIT: 'reviews.error.RATE_LIMITED',
  NOT_FOUND: 'reviews.error.NOT_FOUND',
  BAD_REQUEST: 'reviews.error.BAD_REQUEST',
}

function reviewError(err) {
  const code = err?.code
  if (code && ERROR_KEYS[code]) return t(ERROR_KEYS[code])
  const msg = err?.message
  return (msg && String(msg).trim()) || t('reviews.submitError')
}

// Relative "Xm / Xh / Xd ago" like the rest of the app's lightweight date
// formatting, else the locale-formatted date. Malformed timestamps render
// nothing rather than "Invalid Date".
function relativeTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return t('reviews.justNow')
  if (mins < 60) return t('reviews.minAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('reviews.hourAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('reviews.dayAgo', { n: days })
  return new Intl.DateTimeFormat(getLocale()).format(d)
}

function formatAvg(n) {
  const v = Number(n) || 0
  return Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '0'
}

function countLabel(n) {
  const c = Number(n) || 0
  return c === 1 ? t('reviews.countOne') : t('reviews.countMany', { n: c })
}

// Read-only star row for displaying a rating (also used for the aggregate).
function Stars({ value }) {
  const rounded = Math.round(Number(value) || 0)
  return (
    <span className="reviews-stars" role="img" aria-label={t('reviews.starsAria', { n: rounded })}>
      {Array.from({ length: STAR_MAX }, (_, i) => (
        <span key={i} className={i < rounded ? 'reviews-star on' : 'reviews-star'} aria-hidden="true">★</span>
      ))}
    </span>
  )
}

export default function ReviewsSection({ kind, sourceId, catalog, showToast }) {
  const copy = catalog?.copy?.reviews || {}
  const entity = catalog?.entity || 'item'
  const {
    mine, allReviews, aggregate, status,
    addOrUpdate, remove, signedIn, refresh,
  } = useReviews(kind, sourceId)

  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [ratingError, setRatingError] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const composerRef = useRef(null)
  const bodyRef = useRef(null)
  const sectionRef = useRef(null)
  const confirmTimer = useRef(null)
  // True once the member has touched the composer — the prefill effect must
  // never clobber in-progress input when a slow load (or retry) resolves.
  const touchedRef = useRef(false)

  // Prefill the composer from the caller's review, but ONLY once the thread is
  // ready and the member hasn't started writing — a slow load must not discard
  // their in-progress input. Keyed on `mine?.id` so an untouched composer
  // still follows a change in the caller's review identity.
  useEffect(() => {
    if (status !== 'ready' || touchedRef.current) return
    setRating(mine?.rating ? Number(mine.rating) : 0)
    setBody(mine?.body || '')
  }, [status, mine?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  // Manual items (no provider id) have no review thread — render nothing so
  // the detail sheet never shows a misleading "no reviews" box for them.
  if (!kind || !sourceId) return null

  const list = Array.isArray(allReviews) ? allReviews : []
  const aggregateCount = Number(aggregate?.count) || 0
  const aggregateAvg = Number(aggregate?.avg) || 0
  // Composer only for signed-in members with a reviewable item. Public
  // reviews still render for everyone else.
  const canReview = signedIn && !!kind && !!sourceId
  const isMine = (r) => !!mine && (mine.id ? r?.id === mine.id : r?.authorId === mine.authorId)

  async function handleSubmit(e) {
    e.preventDefault()
    const r = Number(rating)
    if (!Number.isFinite(r) || r < 1 || r > STAR_MAX) {
      setRatingError(true)
      setSubmitError(t('reviews.needRating'))
      return
    }
    setBusy(true)
    setSubmitError('')
    setRatingError(false)
    const isUpdate = !!mine
    try {
      await addOrUpdate(r, body)
      // Success feedback — the detail sheet owns the toast (defaults to a
      // success toast). "Posted" vs "updated" depends on whether the caller
      // already had a review before this submit.
      if (typeof showToast === 'function') {
        showToast(isUpdate ? (copy.updatedToast || t('reviews.updatedToast')) : (copy.postedToast || t('reviews.postedToast')))
      }
    } catch (err) {
      setSubmitError(reviewError(err))
    } finally {
      setBusy(false)
    }
  }

  function handleEdit() {
    setSubmitError('')
    setRatingError(false)
    if (mine) {
      setRating(Number(mine.rating) || 0)
      setBody(mine.body || '')
    }
    // Bring the composer into view and focus the textarea.
    composerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    window.setTimeout(() => bodyRef.current?.focus(), 60)
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmDelete(false)
    setBusy(true)
    setSubmitError('')
    setRatingError(false)
    remove()
      .then(() => {
        // The deleted <li> unmounts and focus would drop to <body> outside the
        // sheet — land it back on the section heading (returnFocus pattern).
        sectionRef.current?.focus()
      })
      .catch((err) => setSubmitError(reviewError(err)))
      .finally(() => setBusy(false))
  }

  const sectionLabel = copy.section || t('reviews.section')
  const saveLabel = mine ? (copy.update || t('reviews.update')) : (copy.save || t('reviews.save'))
  const busyLabel = mine ? (copy.saving || t('reviews.saving')) : (copy.posting || t('reviews.posting'))

  // What sits between the section heading and the composer. Three quiet
  // states — loading, load-error (with a retry), and the ready thread. The
  // composer always stays available below (a write doesn't need the list).
  let statusContent
  if (status === 'loading') {
    // Distinct quiet loading line — never a misleading "no reviews" empty
    // state on a slow link.
    statusContent = <p className="reviews-loading">{t('common.loading')}</p>
  } else if (status === 'error') {
    // Load failure → quiet fallback with a retry. Never throws, never
    // dark-screens.
    statusContent = (
      <div className="reviews-load-error-block">
        <p className="reviews-load-error">{t('reviews.loadError')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>
          {t('common.retry')}
        </button>
      </div>
    )
  } else {
    statusContent = (
      <>
        {aggregateCount > 0 && (
          <div className="reviews-aggregate">
            <Stars value={aggregateAvg} />
            <span className="reviews-aggregate-text">
              {t('reviews.avg', { avg: formatAvg(aggregateAvg) })} · {countLabel(aggregateCount)}
            </span>
          </div>
        )}

        {/* Empty state is only truthful once the thread is ready AND empty. */}
        {list.length === 0 ? (
          <div className="reviews-empty">
            <p className="reviews-empty-title">{t('reviews.emptyTitle')}</p>
            <p className="reviews-empty-body">{t('reviews.emptyBody', { entity })}</p>
          </div>
        ) : (
          <ul className="reviews-list">
            {list.map((r, i) => {
              const owned = isMine(r)
              return (
                <li key={r?.id || `r${i}`} className={`review-item${owned ? ' owned' : ''}`}>
                  <div className="review-header">
                    <span className="review-author">{r?.authorName || t('reviews.anonymous')}</span>
                    <span className="review-date">{relativeTime(r?.updatedAt || r?.createdAt)}</span>
                  </div>
                  <div className="review-stars-line"><Stars value={r?.rating} /></div>
                  {r?.body ? <p className="review-body">{r.body}</p> : null}
                  {owned && (
                    <div className="review-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={handleEdit} disabled={busy}>
                        {t('reviews.edit')}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${confirmDelete ? 'btn-danger-filled' : 'btn-danger'}`}
                        onClick={handleDelete}
                        disabled={busy}
                      >
                        {confirmDelete ? t('reviews.deleteConfirm') : t('reviews.delete')}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </>
    )
  }

  return (
    <section className="reviews-section">
      {/* tabIndex lets us move focus here after a delete (returnFocus pattern). */}
      <p ref={sectionRef} tabIndex={-1} className="detail-section-label">{sectionLabel}</p>

      {statusContent}

      {canReview && (
        <form className="reviews-composer" onSubmit={handleSubmit} ref={composerRef}>
          <fieldset
            className="reviews-rating-field"
            aria-invalid={ratingError || undefined}
            aria-describedby={ratingError ? 'reviews-submit-error' : undefined}
          >
            <legend>
              {t('reviews.ratingField')}
              <span className="visually-hidden"> — {t('reviews.ratingHint')}</span>
            </legend>
            <div className="reviews-stars-input">
              {Array.from({ length: STAR_MAX }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`reviews-star-btn${rating === n ? ' selected' : ''}`}
                  onClick={() => { touchedRef.current = true; setRating(n); setSubmitError(''); setRatingError(false) }}
                  aria-pressed={rating === n}
                  aria-label={t('reviews.starAria', { n })}
                >
                  ★
                </button>
              ))}
            </div>
          </fieldset>

          <label className="reviews-body-label">
            <span className="visually-hidden">{t('reviews.bodyLabel')}</span>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => { touchedRef.current = true; setBody(e.target.value) }}
              placeholder={t('reviews.bodyPlaceholder')}
              rows={3}
            />
          </label>

          {submitError && (
            <p id="reviews-submit-error" className="reviews-error" role="alert">{submitError}</p>
          )}

          <div className="reviews-composer-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? busyLabel : saveLabel}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
