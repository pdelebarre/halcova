import { useEffect, useState } from 'react'
import { splitArtistTitle } from '../utils/match'
import './AlbumDetail.css'
import './BookDetail.css'

export default function BookDetail({ item, onClose, onDelete, onSaveNotes, catalog }) {
  const { artist: author, album: bookTitle } = splitArtistTitle(item.title)

  const [description, setDescription] = useState(item.description || '')
  const [pageCount, setPageCount] = useState(item.pageCount || '')
  const [descError, setDescError] = useState('')
  const [notes, setNotes] = useState(item.notes || '')
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  function saveNotes() {
    if (notes !== (item.notes || '')) onSaveNotes(notes)
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={bookTitle}>
      <div className="sheet detail-sheet">
        <div className="sheet-header">
          <h2 className="visually-hidden">{bookTitle}</h2>
          <span />
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
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
            {item.formatRaw && <div><dt>Format</dt><dd>{item.formatRaw}</dd></div>}
            {item.year && <div><dt>Year</dt><dd>{item.year}</dd></div>}
            {item.label && <div><dt>Publisher</dt><dd>{item.label}</dd></div>}
            {pageCount && <div><dt>Pages</dt><dd>{pageCount}</dd></div>}
            {item.isbn && <div><dt>ISBN</dt><dd className="mono">{item.isbn}</dd></div>}
            {item.genre?.length ? (
              <div><dt>Categories</dt><dd>{item.genre.join(', ')}</dd></div>
            ) : null}
          </dl>

          <div className="detail-notes">
            <p className="detail-section-label">About this book</p>
            {!description && !descError && <p className="detail-loading">Loading…</p>}
            {descError && <p className="detail-loading">Couldn't load the description.</p>}
            {description && <p className="book-description">{description}</p>}
          </div>

          <div className="detail-notes">
            <p className="detail-section-label">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Condition, where you got it, whether it's signed…"
              rows={3}
            />
          </div>

          {item.infoLink && (
            <a
              className="detail-discogs-link"
              href={item.infoLink}
              target="_blank"
              rel="noreferrer"
            >
              View on Google Books ↗
            </a>
          )}
        </div>

        <div className="sheet-actions">
          {!confirmDelete ? (
            <button className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
              Remove from shelf
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => onDelete(item.id)}>Confirm remove</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
