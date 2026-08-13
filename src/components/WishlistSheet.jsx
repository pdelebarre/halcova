import { useEffect, useRef } from 'react'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import './WishlistSheet.css'

/**
 * The Wishlist (§ Fix): a list of UNOWNED "wants" (e.g. scanned in a shop).
 * Each row offers "Add to crate" (convert → owned, appears on the shelf/Floor)
 * and "Remove". Owned items never appear here — they live in the collection.
 */
export default function WishlistSheet({ items = [], onConvert, onRemove, onClose, copy = {}, isDemo = false }) {
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

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={wl.title || 'Wishlist'}>
      <div className="sheet wishlist-sheet">
        <div className="sheet-header">
          <h2>{wl.title || 'Wishlist'}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="wishlist-body">
          {items.length === 0 && (
            <p className="wishlist-empty">{wl.empty || 'Your wishlist is empty.'}</p>
          )}

          <ul className="wishlist-list">
            {items.map((item) => {
              const { artist, album } = splitArtistTitle(item.title)
              return (
                <li key={item.id} className="wishlist-row">
                  <span className="wishlist-cover">
                    {item.coverImage
                      ? <img src={item.coverImage} alt="" loading="lazy" />
                      : <span className="wishlist-cover-placeholder" aria-hidden="true">{album?.[0] || '?'}</span>}
                  </span>
                  <span className="wishlist-info">
                    <span className="wishlist-title">{album}</span>
                    {artist && <span className="wishlist-artist">{artist}</span>}
                    <span className="wishlist-meta">
                      {[item.formatType, item.year, item.label].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {!isDemo && (
                    <span className="wishlist-actions">
                      <button
                        type="button"
                        className="btn btn-primary wishlist-own"
                        onClick={() => onConvert(item)}
                      >
                        {wl.addToCrate || 'Add to crate'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost wishlist-remove"
                        onClick={() => onRemove(item)}
                        aria-label={wl.remove || 'Remove from wishlist'}
                      >
                        ✕
                      </button>
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
