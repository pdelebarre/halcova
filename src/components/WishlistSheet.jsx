import { useEffect, useRef } from 'react'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import './WishlistSheet.css'

// The format disc + badge reuse the record/badge visual language (.record-peek
// / .format-badge + the .fmt-* colors from AlbumCard). Only KNOWN record
// formats get the vinyl disc peeking out behind the cover; unknown formats
// (e.g. a book's empty formatType) render the cover alone. The format badge
// still falls back to the neutral `other` class for an unknown-but-present
// format, so the sheet stays generic across catalogs — and never crashes.
const FMT_CLASS = { LP: 'lp', EP: 'ep', CD: 'cd', '7"': 'seven', '12"': 'lp' }

/**
 * The Wishlist (§ Fix): a list of UNOWNED "wants" (e.g. scanned in a shop).
 * Rows are full cards — a larger cover, title, artist, and a year · label ·
 * genre meta block with a format badge. The WHOLE row is tappable to open the
 * item's Detail sheet via `onOpenItem`. Each row also offers "Add to crate"
 * (convert → owned, appears on the shelf/Floor) and "Remove". Owned items
 * never appear here — they live in the collection.
 */
export default function WishlistSheet({ items = [], onConvert, onRemove, onClose, onOpenItem, copy = {}, isDemo = false, isFree = false }) {
  const wl = copy.wishlist || {}
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

  const canOpen = typeof onOpenItem === 'function'
  // Guard the row actions like canOpen: a non-demo render without a convert or
  // remove handler must not render (or call) a button that could dark-screen.
  const canConvert = typeof onConvert === 'function'
  const canRemove = typeof onRemove === 'function'

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={wl.title || 'Wishlist'}>
      <div className="sheet wishlist-sheet">
        <div className="sheet-header">
          <h2>{wl.title || 'Wishlist'}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="wishlist-body">
          {items.length === 0 && (
            <>
              <p className="wishlist-empty">{wl.empty || 'Your wishlist is empty.'}</p>
              {/* D-7 (#171): free-only, factual line — wants are unlimited and
                  don't use a spot on the plan. Free members only; demo and
                  paid/owner never see it. Copy lives in catalog.copy / i18n. */}
              {isFree && !isDemo && (
                <p className="wishlist-free-note">{wl.freeNote || t('wishlist.freeNote') || ''}</p>
              )}
            </>
          )}

          <ul className="wishlist-list">
            {items.map((item) => {
              const { artist, album } = splitArtistTitle(item?.title)
              // Whole-card meta — every field optional-chained and filtered so
              // a missing/weird field can never crash the row (no error
              // boundary → dark screen). Genre may be an array or a string.
              const genres = Array.isArray(item?.genre)
                ? item.genre.filter(Boolean).join(', ')
                : String(item?.genre || '')
              const meta = [item?.year, item?.label, genres].filter(Boolean).join(' · ')
              const fmtClass = FMT_CLASS[item?.formatType] || 'other'
              // Only KNOWN record formats get the vinyl disc peeking out behind
              // the cover — a book (empty/unknown formatType) renders the cover
              // alone, no disc. The badge below still honors item.formatType.
              const isRecordFormat = Boolean(FMT_CLASS[item?.formatType])
              // Always give the row button an accessible name — fall back to the
              // placeholder letter (or '?') when the title is missing.
              const openAria = (wl.openDetailAria || 'Open details for {title}')
                .replace('{title}', item?.title || album?.[0] || '?')

              const main = (
                <>
                  <span className="wishlist-cover" aria-hidden="true">
                    {isRecordFormat && <span className={`record-peek fmt-${fmtClass}`} aria-hidden="true" />}
                    {item?.coverImage
                      ? <img src={item.coverImage} alt="" loading="lazy" />
                      : <span className="wishlist-cover-placeholder">{album?.[0] || '?'}</span>}
                  </span>
                  <span className="wishlist-info">
                    <span className="wishlist-title">{album || item?.title}</span>
                    {artist && <span className="wishlist-artist">{artist}</span>}
                    <span className="wishlist-meta">
                      <span>{meta}</span>
                      {item?.formatType && <span className={`format-badge ${fmtClass}`}>{item.formatType}</span>}
                    </span>
                  </span>
                </>
              )

              return (
                <li key={item?.id} className="wishlist-row">
                  {canOpen ? (
                    <button
                      type="button"
                      className="wishlist-main"
                      onClick={() => onOpenItem(item)}
                      aria-label={openAria}
                    >
                      {main}
                    </button>
                  ) : (
                    <span className="wishlist-main">{main}</span>
                  )}

                  {!isDemo && (canConvert || canRemove) && (
                    <span className="wishlist-actions">
                      {canConvert && (
                        <button
                          type="button"
                          className="btn btn-primary wishlist-own"
                          onClick={() => onConvert(item)}
                        >
                          {wl.addToCrate || 'Add to crate'}
                        </button>
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          className="btn btn-ghost wishlist-remove"
                          onClick={() => onRemove(item)}
                          aria-label={wl.remove || 'Remove from wishlist'}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>

          {isDemo && items.length > 0 && (
            <p className="demo-readonly-notice">{t('demo.readOnlyNotice')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
