import { useEffect, useRef, useState } from 'react'
import * as discogs from '../api/discogs'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import LendingControls from './LendingControls'
import ReviewsSection from './ReviewsSection'
import './AlbumDetail.css'

export default function AlbumDetail({ item, onClose, onDelete, onSaveNotes, onTogglePinned, catalog, lendingEnabled, lendingGate = false, onLend, onReturn, showToast, isDemo = false, onOpenPaywall, focusSection }) {
  const { artist, album: albumTitle } = splitArtistTitle(item.title)
  const copy = catalog?.copy || {}

  // Community rating (Task 1 reviews): star + average + count, shown only when
  // the provider surfaced one. Guarded — never render/throw on absent data.
  const rating = Number(item.rating)
  const ratingCount = Number(item.ratingCount)
  const hasRating = rating > 0 || ratingCount > 0
  const ratingValue = Number.isFinite(rating) && rating > 0 ? (Math.round(rating * 10) / 10).toString() : ''

  // A wishlist "want" is unowned: it gets none of the owned-only affordances
  // (pin, lending) and its remove copy says "wishlist", not crate.
  const isWant = !!item.wishlist
  const closeRef = useRef(null)
  const scrollRef = useRef(null)
  const lendingRef = useRef(null)

  // Focus into the sheet on open; Esc closes (same pattern as WishlistSheet).
  // A5.6 (#117): a 'lending' focus hint skips the close-button focus — the
  // deep-link effect below scrolls to + focuses the lending section instead.
  // If the section isn't present (wishlist want, gated-off) we fall back to
  // the normal close-button focus so the sheet never opens unfocused.
  useEffect(() => {
    if (!(focusSection === 'lending' && lendingRef.current)) closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, focusSection])

  // A5.6 (#117): deep-link to the lend card — scroll .detail-scroll to the
  // LendingControls wrapper and move focus there. Null-checks the section ref
  // and the scroll target (no error boundary → dark-screen safety); when the
  // section isn't present this is a no-op and the sheet opens normally.
  useEffect(() => {
    if (focusSection !== 'lending') return undefined
    const scrollEl = scrollRef.current
    const target = lendingRef.current
    if (!scrollEl || !target) return undefined
    const raf = requestAnimationFrame(() => {
      try {
        const top = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
        const reduceMotion = typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)')?.matches
        if (typeof scrollEl.scrollTo === 'function') {
          scrollEl.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' })
        }
        // P2-4: self-correcting — redundant with the manual math above, but the
        // browser resolves the true position (async content may have shifted
        // the section between the RAF capture and now).
        if (typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
        }
      } catch {
        // jsdom / older engines without scrollTo/scrollIntoView — scroll
        // position is a progressive enhancement; never throw from here.
      }
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [focusSection])

  const [tracklist, setTracklist] = useState(null)
  const [trackError, setTrackError] = useState('')
  const [notes, setNotes] = useState(item.notes || '')
  const [notesError, setNotesError] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (item.discogsId) {
      discogs.getReleaseDetail(item.discogsId)
        .then((d) => { if (!cancelled) setTracklist(d.tracklist) })
        .catch((err) => { if (!cancelled) setTrackError(err.message) })
    }
    return () => { cancelled = true }
  }, [item.discogsId])

  // P2-4: async content (Discogs tracklist, ReviewsSection) renders ABOVE
  // LendingControls and can shift the section after the one-shot RAF above
  // lands. Whenever that async state settles, re-run the browser-native
  // scrollIntoView — redundant with the manual math but self-correcting.
  // Null-guarded + try/catch (no error boundary → dark-screen safety).
  useEffect(() => {
    if (focusSection !== 'lending') return undefined
    const target = lendingRef.current
    if (!target) return undefined
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)')?.matches
    try {
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
      }
    } catch {
      // progressive enhancement — never throw from here.
    }
    return undefined
  }, [focusSection, tracklist, trackError])

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  const notesDirty = notes !== (item.notes || '')

  // Remove labels: a wishlist want gets wishlist copy ("Remove from wishlist"),
  // an owned item keeps the catalog's crate/shelf remove copy.
  const removeLabel = isWant
    ? (copy.wishlist?.remove || 'Remove from wishlist')
    : (copy.removeLabel || t('catalog.removeLabel', { collectionLabel: catalog.collectionLabel }))
  const removeConfirmLabel = isWant
    ? (copy.wishlist?.removeConfirm || 'Remove from wishlist?')
    : (copy.removeConfirm || t('catalog.removeConfirm'))

  // Explicit Save button — no silent save-on-blur (§4.13). Persists via the
  // existing onSaveNotes prop and shows a brief confirm state.
  async function saveNotes() {
    if (!notesDirty) return
    setNotesError('')
    try {
      await onSaveNotes(notes)
      setNotesSaved(true)
      window.setTimeout(() => setNotesSaved(false), 1200)
    } catch (err) {
      setNotesError(err?.message || t('detail.couldNotSaveNotes'))
    }
  }

  // Remove → inline confirm step on the button (auto-reverts after ~3s).
  function handleRemove() {
    if (confirmDelete) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      onDelete(item.id)
      return
    }
    setConfirmDelete(true)
    confirmTimer.current = window.setTimeout(() => setConfirmDelete(false), 3000)
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={albumTitle}>
      <div className="sheet detail-sheet">
        <div className="sheet-header">
          <h2 className="visually-hidden">{albumTitle}</h2>
          <span />
          <div className="detail-header-actions">
            {!isDemo && !isWant && onTogglePinned && (
              <button
                type="button"
                className={`icon-btn detail-pin${item.pinned ? ' pinned' : ''}`}
                onClick={onTogglePinned}
                aria-pressed={!!item.pinned}
                aria-label={item.pinned ? (copy.floor?.unpin || 'Unpin') : (copy.floor?.pin || 'Pin to top')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={item.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 3h6M12 3v5l-3 3v2h6v-2l-3-3V3M12 13v8" />
                </svg>
              </button>
            )}
            <button ref={closeRef} className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
          </div>
        </div>

        <div className="detail-scroll" ref={scrollRef}>
          <div className="detail-cover">
            {item.coverImage
              ? <img src={item.coverImage} alt="" />
              : <span className="detail-cover-placeholder">{albumTitle?.[0] || '?'}</span>}
          </div>

          <div className="detail-heading">
            <p className="detail-title">{albumTitle}</p>
            <p className="detail-artist">{artist}</p>
          </div>

          <dl className="detail-meta">
            {item.formatType && <div><dt>{t('add.format')}</dt><dd>{item.formatRaw || item.formatType}</dd></div>}
            {item.year && <div><dt>{t('add.year')}</dt><dd>{item.year}</dd></div>}
            {item.label && <div><dt>{t('add.label')}</dt><dd>{item.label}</dd></div>}
            {item.catno && <div><dt>{t('add.catalogNumber')}</dt><dd>{item.catno}</dd></div>}
            {item.country && <div><dt>{t('detail.country')}</dt><dd>{item.country}</dd></div>}
            {(item.genre?.length || item.style?.length) ? (
              <div><dt>{t('add.genre')}</dt><dd>{[...(item.genre || []), ...(item.style || [])].join(', ')}</dd></div>
            ) : null}
            {item.barcode && <div><dt>{t('detail.barcode')}</dt><dd className="mono">{item.barcode}</dd></div>}
            {hasRating && (
              <div className="detail-meta-rating">
                <dt>{t('detail.rating')}</dt>
                <dd className="detail-rating">
                  <span className="rating-star" aria-hidden="true">★</span>
                  <span className="rating-value">{ratingValue}</span>
                  {ratingCount > 0 && (
                    <span className="rating-count">{t('detail.ratingCount', { n: ratingCount })}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>

          {item.discogsId && (
            <div className="detail-tracklist">
              <p className="detail-section-label">{t('detail.tracklist')}</p>
              {!tracklist && !trackError && <p className="detail-loading">{t('common.loading')}</p>}
              {trackError && <p className="detail-loading">{t('detail.tracklistError')}</p>}
              {tracklist && tracklist.length === 0 && <p className="detail-loading">{t('detail.noTracklist')}</p>}
              {tracklist && tracklist.length > 0 && (
                <ol className="track-list">
                  {tracklist.map((t, i) => (
                    <li key={i}>
                      <span className="track-pos">{t.position || i + 1}</span>
                      <span className="track-title">{t.title}</span>
                      <span className="track-duration">{t.duration}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <ReviewsSection
            kind={catalog.kind}
            sourceId={typeof catalog.reviewKey === 'function' ? catalog.reviewKey(item) : item.discogsId}
            catalog={catalog}
            showToast={showToast}
          />

          <div className="detail-notes">
            <p className="detail-section-label">{t('detail.notes')}</p>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); if (notesError) setNotesError('') }}
              placeholder={t('detail.notesPlaceholderRecord')}
              rows={3}
              readOnly={isDemo}
              disabled={isDemo}
              aria-invalid={!!notesError}
              aria-describedby={notesError ? 'detail-notes-error' : undefined}
            />
            {isDemo ? (
              // Read-only demo (ADR-0001): notes can't be edited — show a hint
              // instead of the Save action.
              <p className="demo-notes-hint">{t('demo.notesReadOnly')}</p>
            ) : (
              <>
                <div className="detail-notes-actions">
                  <button type="button" className="btn btn-ghost" onClick={saveNotes} disabled={!notesDirty}>
                    {notesSaved ? (copy.notesSaved || t('catalog.notesSaved')) : (copy.notesSave || t('catalog.notesSave'))}
                  </button>
                </div>
                {notesError && (
                  <p id="detail-notes-error" className="detail-field-error" role="alert">{notesError}</p>
                )}
              </>
            )}
          </div>

          {!isWant && (
            <LendingControls
              item={item}
              catalog={catalog}
              lendingEnabled={lendingEnabled}
              lendingGate={lendingGate}
              onLend={onLend}
              onReturn={onReturn}
              showToast={showToast}
              onOpenPaywall={onOpenPaywall}
              wrapperRef={lendingRef}
            />
          )}
        </div>

        <div className="sheet-actions detail-actions">
          {item.discogsId && (
            <a
              className="btn btn-ghost"
              href={catalog.detailLink(item)}
              target="_blank"
              rel="noreferrer"
            >
              {catalog.detailLinkLabel}
            </a>
          )}
          {!isDemo && (
            <button
              type="button"
              className={`btn ${confirmDelete ? 'btn-danger-filled' : 'btn-danger'}`}
              onClick={handleRemove}
            >
              {confirmDelete ? removeConfirmLabel : removeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
