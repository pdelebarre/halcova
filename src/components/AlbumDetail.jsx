import { useEffect, useState } from 'react'
import * as discogs from '../api/discogs'
import { splitArtistTitle } from '../utils/match'
import './AlbumDetail.css'

export default function AlbumDetail({ item, onClose, onDelete, onSaveNotes }) {
  const { artist, album: albumTitle } = splitArtistTitle(item.title)

  const [tracklist, setTracklist] = useState(null)
  const [trackError, setTrackError] = useState('')
  const [notes, setNotes] = useState(item.notes || '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (item.discogsId) {
      discogs.getReleaseDetail(item.discogsId)
        .then((d) => { if (!cancelled) setTracklist(d.tracklist) })
        .catch((err) => { if (!cancelled) setTrackError(err.message) })
    }
    return () => { cancelled = true }
  }, [item.discogsId])

  function saveNotes() {
    if (notes !== (item.notes || '')) onSaveNotes(notes)
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={albumTitle}>
      <div className="sheet detail-sheet">
        <div className="sheet-header">
          <h2 className="visually-hidden">{albumTitle}</h2>
          <span />
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
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
            {item.formatType && <div><dt>Format</dt><dd>{item.formatRaw || item.formatType}</dd></div>}
            {item.year && <div><dt>Year</dt><dd>{item.year}</dd></div>}
            {item.label && <div><dt>Label</dt><dd>{item.label}</dd></div>}
            {item.catno && <div><dt>Catalog #</dt><dd>{item.catno}</dd></div>}
            {item.country && <div><dt>Country</dt><dd>{item.country}</dd></div>}
            {(item.genre?.length || item.style?.length) ? (
              <div><dt>Genre</dt><dd>{[...(item.genre || []), ...(item.style || [])].join(', ')}</dd></div>
            ) : null}
            {item.barcode && <div><dt>Barcode</dt><dd className="mono">{item.barcode}</dd></div>}
          </dl>

          {item.discogsId && (
            <div className="detail-tracklist">
              <p className="detail-section-label">Tracklist</p>
              {!tracklist && !trackError && <p className="detail-loading">Loading…</p>}
              {trackError && <p className="detail-loading">Couldn't load tracklist.</p>}
              {tracklist && tracklist.length === 0 && <p className="detail-loading">No tracklist on file.</p>}
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
            <p className="detail-section-label">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Condition, pressing details, where you found it…"
              rows={3}
            />
          </div>

          {item.discogsId && (
            <a
              className="detail-discogs-link"
              href={`https://www.discogs.com/release/${item.discogsId}`}
              target="_blank"
              rel="noreferrer"
            >
              View on Discogs ↗
            </a>
          )}
        </div>

        <div className="sheet-actions">
          {!confirmDelete ? (
            <button className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
              Remove from crate
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
