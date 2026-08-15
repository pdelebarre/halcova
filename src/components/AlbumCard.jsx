import { splitArtistTitle } from '../utils/match'
import { isOverdue } from '../utils/lending'
import Highlight from './Highlight'
import LoanIcon from './LoanIcon'
import './AlbumCard.css'

const badgeClass = {
  LP: 'lp', EP: 'ep', CD: 'cd', '7"': 'seven', '12"': 'lp',
}

export default function AlbumCard({ item, onOpen, lendingEnabled = false, copy = {}, query = '' }) {
  const { artist, album: albumTitle } = splitArtistTitle(item.title)

  // A5.6 (#117): on-loan icon — replaces the text badge. Overdue is derived
  // client-side (day-granularity, local) from item.lending.dueOn;
  // optional-chaining + isOverdue's NaN guard keep weird shapes from crashing
  // (no error boundary — dark-screen safety). The icon's aria-label comes
  // from copy.lending.manageLoan*, falling back to the badge text.
  const lending = item?.lending
  const isOut = lendingEnabled && !!lending
  const overdue = isOut && isOverdue(lending?.dueOn)
  const lendingCopy = copy?.lending || {}
  const borrowerName = lending?.borrower?.name || ''
  let manageLabel
  if (overdue) {
    manageLabel = typeof lendingCopy.manageLoanOverdue === 'function'
      ? lendingCopy.manageLoanOverdue(borrowerName)
      : (lendingCopy.badgeOverdue || 'Overdue')
  } else {
    manageLabel = typeof lendingCopy.manageLoan === 'function'
      ? lendingCopy.manageLoan(borrowerName)
      : (lendingCopy.badge || 'On loan')
  }

  return (
    <button type="button" className="album-card" onClick={() => onOpen(item)}>
      <span className={`record-peek fmt-${(badgeClass[item.formatType] || 'other')}`} aria-hidden="true" />
      <span className="sleeve">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="sleeve-placeholder">{albumTitle?.[0] || '?'}</span>}
        {isOut && (
          <LoanIcon
            overdue={overdue}
            label={manageLabel}
            onActivate={() => onOpen(item, { focus: 'lending' })}
          />
        )}
      </span>
      <span className="album-card-info">
        <span className="album-card-title"><Highlight text={albumTitle} query={query} /></span>
        <span className="album-card-artist"><Highlight text={artist} query={query} /></span>
      </span>
    </button>
  )
}
