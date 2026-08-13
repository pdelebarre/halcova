import { splitArtistTitle } from '../utils/match'
import { isOverdue } from '../utils/lending'
import Highlight from './Highlight'
import './AlbumCard.css'

const badgeClass = {
  LP: 'lp', EP: 'ep', CD: 'cd', '7"': 'seven', '12"': 'lp',
}

export default function AlbumCard({ item, onOpen, lendingEnabled = false, copy = {}, query = '' }) {
  const { artist, album: albumTitle } = splitArtistTitle(item.title)

  // W7: on-loan badge — only when lending is enabled for this member. Overdue
  // is derived client-side (day-granularity, local) from item.lending.dueOn;
  // optional-chaining + isOverdue's NaN guard keep weird shapes from crashing.
  const lending = item?.lending
  const isOut = lendingEnabled && !!lending
  const overdue = isOut && isOverdue(lending?.dueOn)
  const lendingCopy = copy?.lending || {}
  let badgeLabel = ''
  if (isOut) {
    badgeLabel = overdue ? lendingCopy.badgeOverdue : lendingCopy.badge
  }

  return (
    <button type="button" className="album-card" onClick={() => onOpen(item)}>
      <span className={`record-peek fmt-${(badgeClass[item.formatType] || 'other')}`} aria-hidden="true" />
      <span className="sleeve">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="sleeve-placeholder">{albumTitle?.[0] || '?'}</span>}
        {badgeLabel && (
          <span className={`lending-badge${overdue ? ' overdue' : ''}`}>{badgeLabel}</span>
        )}
      </span>
      <span className="album-card-info">
        <span className="album-card-title"><Highlight text={albumTitle} query={query} /></span>
        <span className="album-card-artist"><Highlight text={artist} query={query} /></span>
      </span>
    </button>
  )
}
