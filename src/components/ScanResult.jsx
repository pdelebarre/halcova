import { splitArtistTitle } from '../utils/match'
import './ScanResult.css'

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

export default function ScanResult({ candidate, ownedExact, sameAlbum, otherArtist, onAdd, onOpenItem, onScanNext, onClose, copy }) {
  const { artist, album } = splitArtistTitle(candidate.title)

  let banner = { tone: 'good', ...copy.resultGood }
  if (ownedExact) {
    banner = { tone: 'owned', ...copy.resultOwned }
  } else if (sameAlbum.length > 0) {
    banner = { tone: 'caution', ...copy.resultSame }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={`${album} by ${artist}`}>
      <div className="sheet result-sheet">
        <div className="sheet-header">
          <span />
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
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
            <span className="ownership-label">{banner.label}</span>
            <span className="ownership-sub">{banner.sub}</span>
            {ownedExact && (
              <button className="ownership-view" onClick={() => onOpenItem(ownedExact)}>View in collection →</button>
            )}
          </div>

          {sameAlbum.length > 0 && (
            <div className="related-section">
              <p className="related-heading">{copy.sameHeading}</p>
              <div className="related-list">
                {sameAlbum.map((it) => <RelatedRow key={it.id} item={it} onOpen={onOpenItem} />)}
              </div>
            </div>
          )}

          <div className="related-section">
            <p className="related-heading">
              {otherArtist.length > 0
                ? copy.moreBy(artist, otherArtist.length)
                : copy.nothingElseBy(artist)}
            </p>
            {otherArtist.length > 0 && (
              <div className="related-list">
                {otherArtist.map((it) => <RelatedRow key={it.id} item={it} onOpen={onOpenItem} />)}
              </div>
            )}
          </div>
        </div>

        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onScanNext}>{copy.scanNext}</button>
          <button className="btn btn-primary" onClick={() => onAdd(candidate)}>
            {ownedExact ? copy.addAnyway : copy.add}
          </button>
        </div>
      </div>
    </div>
  )
}
