import { useEffect, useRef, useState } from 'react'
import { splitArtistTitle } from '../utils/match'
import { t } from '../i18n'
import './ScanResult.css'

// Cap noisy "other pressings/editions" lists so a big collection can't
// overflow the sheet (§4.10, §4.18).
const RELATED_CAP = 5

const BANNER_ICONS = {
  good: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  owned: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.4 2.4 4.6-4.8" />
    </svg>
  ),
  caution: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
}

function RelatedRow({ item, onOpen }) {
  const { album } = splitArtistTitle(item.title)
  return (
    <button className="related-row" onClick={() => onOpen(item)}>
      <span className="related-cover">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="related-cover-placeholder" aria-hidden="true" />}
      </span>
      <span className="related-info">
        <span className="related-title">{album}</span>
        <span className="related-meta">{[item.formatType, item.year].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  )
}

function RelatedSection({ heading, items, onOpen, moreLabel }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, RELATED_CAP)
  const extra = items.length - visible.length
  return (
    <div className="related-section">
      <p className="related-heading">{heading}</p>
      <div className="related-list">
        {visible.map((it) => <RelatedRow key={it.id} item={it} onOpen={onOpen} />)}
      </div>
      {extra > 0 && (
        <button type="button" className="related-more" onClick={() => setExpanded(true)}>
          {moreLabel(extra)}
        </button>
      )}
    </div>
  )
}

export default function ScanResult({ candidate, ownedExact, sameAlbum, otherArtist, onAdd, onOpenItem, onScanNext, onClose, copy }) {
  const { artist, album } = splitArtistTitle(candidate.title)
  const [adding, setAdding] = useState(false)
  const addTimer = useRef(null)

  useEffect(() => () => { if (addTimer.current) clearTimeout(addTimer.current) }, [])

  let banner = { tone: 'good', ...copy.resultGood }
  if (ownedExact) {
    banner = { tone: 'owned', ...copy.resultOwned }
  } else if (sameAlbum.length > 0) {
    banner = { tone: 'caution', ...copy.resultSame }
  }

  // On add: brief spinning-disc "Added" state (~0.8s) with a haptic + visual
  // pulse, then the parent's add() runs and fires the toast (§4.10, §6).
  function handleAdd() {
    if (adding) return
    setAdding(true)
    navigator.vibrate?.(30)
    addTimer.current = setTimeout(() => {
      setAdding(false)
      onAdd(candidate)
    }, 800)
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('detail.albumByArtist', { album, artist })}>
      <div className="sheet result-sheet">
        <div className="sheet-header">
          <span />
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="result-scroll">
          <div className="result-top">
            <div className="result-cover">
              {candidate.coverImage
                ? <img src={candidate.coverImage} alt="" />
                : <span className="result-cover-placeholder">{album?.[0] || '?'}</span>}
            </div>
            <div className="result-heading">
              <p className="result-title">{album}</p>
              <p className="result-artist">{artist}</p>
              <p className="result-sub">
                {[candidate.formatType, candidate.year, candidate.label].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className={`ownership-banner tone-${banner.tone}`}>
            <div className="ownership-main">
              <span className="ownership-icon" aria-hidden="true">{BANNER_ICONS[banner.tone]}</span>
              <span className="ownership-text">
                <span className="ownership-label">{banner.label}</span>
                <span className="ownership-sub">{banner.sub}</span>
              </span>
            </div>
            {ownedExact && (
              <button className="ownership-view" onClick={() => onOpenItem(ownedExact)}>{t('detail.viewInCollection')}</button>
            )}
          </div>

          {sameAlbum.length > 0 && (
            <RelatedSection heading={copy.sameHeading} items={sameAlbum} onOpen={onOpenItem} moreLabel={copy.moreRelated} />
          )}

          {otherArtist.length > 0 ? (
            <RelatedSection heading={copy.moreBy(artist, otherArtist.length)} items={otherArtist} onOpen={onOpenItem} moreLabel={copy.moreRelated} />
          ) : (
            <div className="related-section">
              <p className="related-heading">{copy.nothingElseBy(artist)}</p>
            </div>
          )}
        </div>

        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onScanNext}>{copy.scanNext}</button>
          <button
            type="button"
            className={`btn btn-primary btn-add${adding ? ' adding' : ''}`}
            onClick={handleAdd}
            disabled={adding}
            aria-busy={adding}
          >
            {adding ? (
              <>
                <span className="add-disc" aria-hidden="true" />
                {copy.addDone || t('catalog.addDone')}
              </>
            ) : (
              <>{ownedExact ? (copy.addAnyway || t('catalog.addAnyway')) : (copy.add || t('catalog.add', { collectionLabel: '' }))}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
