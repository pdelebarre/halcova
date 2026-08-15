import { useEffect, useRef, useState } from 'react'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import LendingControls from './LendingControls'
import ReviewsSection from './ReviewsSection'
import './AlbumDetail.css'
import './BookDetail.css'

export default function BookDetail({ item, onClose, onDelete, onSaveNotes, onTogglePinned, catalog, lendingEnabled, lendingGate = false, onLend, onReturn, showToast, isDemo = false, onOpenPaywall }) {
  const { artist: author, album: bookTitle } = splitArtistTitle(item.title)
  const copy = catalog?.copy || {}

  // Community rating (Task 1 reviews): star + average + count, shown only when
  // the provider surfaced one. Guarded — never render/throw on absent data.
  const rating = Number(item.rating)
  const ratingCount = Number(item.ratingCount)
  const hasRating = rating > 0 || ratingCount > 0
  const ratingValue = Number.isFinite(rating) && rating > 0 ? (Math.round(rating * 10) / 10).toString() : ''

  // A wishlist "want" is unowned: it gets none of the owned-only affordances
  // (pin, lending) and its remove copy says "wishlist", not shelf/crate.
  const isWant = !!item.wishlist
  const closeRef = useRef(null)

  // Focus into the sheet on open; Esc closes (same pattern as WishlistSheet).
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const [description, setDescription] = useState(item.description || '')
  const [pageCount, setPageCount] = useState(item.pageCount || '')
  const [descError, setDescError] = useState('')
  const [notes, setNotes] = useState(item.notes || '')
  const [notesError, setNotesError] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef(null)

  // Search results come with a short description; pull the full one (and page
  // count) from the volume detail when it wasn't included up front.
  useEffect(() => {
    let cancelled = false
    if (item.googleBooksId && !item.description) {
      catalog.getDetail(item.googleBooksId)
        .then((d) => {
          if (!cancelled) {
            if (d.description) setDescription(d.description)
            if (d.pageCount) setPageCount(d.pageCount)
          }
        })
        .catch((err) => { if (!cancelled) setDescError(err.message) })
    }
    return () => { cancelled = true }
  }, [item.googleBooksId, item.description, catalog])

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

  // Explicit Save button — no silent save-on-blur (§4.13).
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

  const hasExternalLink = !!(item.googleBooksId || item.infoLink)

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={bookTitle}>
      <div className="sheet detail-sheet">
        <div className="sheet-header">
          <h2 className="visually-hidden">{bookTitle}</h2>
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

        <div className="detail-scroll">
          <div className="detail-cover book">
            {item.coverImage
              ? <img src={item.coverImage} alt="" />
              : <span className="detail-cover-placeholder">{bookTitle?.[0] || '?'}</span>}
          </div>

          <div className="detail-heading">
            <p className="detail-title">{bookTitle}</p>
            <p className="detail-artist">{author}</p>
          </div>

          <dl className="detail-meta">
            {item.formatRaw && <div><dt>{t('add.format')}</dt><dd>{item.formatRaw}</dd></div>}
            {item.year && <div><dt>{t('add.year')}</dt><dd>{item.year}</dd></div>}
            {item.label && <div><dt>{t('add.publisher')}</dt><dd>{item.label}</dd></div>}
            {pageCount && <div><dt>{t('detail.pages')}</dt><dd>{pageCount}</dd></div>}
            {item.isbn && <div><dt>{t('detail.isbn')}</dt><dd className="mono">{item.isbn}</dd></div>}
            {item.genre?.length ? (
              <div><dt>{t('detail.categories')}</dt><dd>{item.genre.join(', ')}</dd></div>
            ) : null}
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

          {(description || item.googleBooksId) && (
            <div className="detail-notes">
              <p className="detail-section-label">{t('detail.aboutThisBook')}</p>
              {item.googleBooksId && !description && !descError && <p className="detail-loading">{t('common.loading')}</p>}
              {descError && <p className="detail-loading">{t('detail.descriptionError')}</p>}
              {description && <p className="book-description">{description}</p>}
            </div>
          )}

          <ReviewsSection
            kind={catalog.kind}
            sourceId={typeof catalog.reviewKey === 'function' ? catalog.reviewKey(item) : item.googleBooksId}
            catalog={catalog}
            showToast={showToast}
          />

          <div className="detail-notes">
            <p className="detail-section-label">{t('detail.notes')}</p>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); if (notesError) setNotesError('') }}
              placeholder={t('detail.notesPlaceholderBook')}
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
            />
          )}
        </div>

        <div className="sheet-actions detail-actions">
          {hasExternalLink && (
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
