import { useEffect, useRef, useState } from 'react'
import * as discogs from '../api/discogs'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import LendingControls from './LendingControls'
import './AlbumDetail.css'

export default function AlbumDetail({ item, onClose, onDelete, onSaveNotes, catalog, lendingEnabled, onLend, onReturn, showToast, isDemo = false }) {
  const { artist, album: albumTitle } = splitArtistTitle(item.title)
  const copy = catalog?.copy || {}

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

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  const notesDirty = notes !== (item.notes || '')

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
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="detail-scroll">
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
              {confirmDelete ? (copy.removeConfirm || t('catalog.removeConfirm')) : (copy.removeLabel || t('catalog.removeLabel', { collectionLabel: catalog.collectionLabel }))}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
