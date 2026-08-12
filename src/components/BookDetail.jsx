import { useEffect, useRef, useState } from 'react'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import LendingControls from './LendingControls'
import './AlbumDetail.css'
import './BookDetail.css'

export default function BookDetail({ item, onClose, onDelete, onSaveNotes, catalog, lendingEnabled, onLend, onReturn, showToast }) {
  const { artist: author, album: bookTitle } = splitArtistTitle(item.title)
  const copy = catalog?.copy || {}

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
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
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
          </dl>

          {(description || item.googleBooksId) && (
            <div className="detail-notes">
              <p className="detail-section-label">{t('detail.aboutThisBook')}</p>
              {item.googleBooksId && !description && !descError && <p className="detail-loading">{t('common.loading')}</p>}
              {descError && <p className="detail-loading">{t('detail.descriptionError')}</p>}
              {description && <p className="book-description">{description}</p>}
            </div>
          )}

          <div className="detail-notes">
            <p className="detail-section-label">{t('detail.notes')}</p>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); if (notesError) setNotesError('') }}
              placeholder={t('detail.notesPlaceholderBook')}
              rows={3}
              aria-invalid={!!notesError}
              aria-describedby={notesError ? 'detail-notes-error' : undefined}
            />
            <div className="detail-notes-actions">
              <button type="button" className="btn btn-ghost" onClick={saveNotes} disabled={!notesDirty}>
                {notesSaved ? (copy.notesSaved || t('catalog.notesSaved')) : (copy.notesSave || t('catalog.notesSave'))}
              </button>
            </div>
            {notesError && (
              <p id="detail-notes-error" className="detail-field-error" role="alert">{notesError}</p>
            )}
          </div>

          <LendingControls
            item={item}
            catalog={catalog}
            lendingEnabled={lendingEnabled}
            onLend={onLend}
            onReturn={onReturn}
            showToast={showToast}
          />
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
          <button
            type="button"
            className={`btn ${confirmDelete ? 'btn-danger-filled' : 'btn-danger'}`}
            onClick={handleRemove}
          >
            {confirmDelete ? (copy.removeConfirm || t('catalog.removeConfirm')) : (copy.removeLabel || t('catalog.removeLabel', { collectionLabel: catalog.collectionLabel }))}
          </button>
        </div>
      </div>
    </div>
  )
}
