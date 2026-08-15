import { splitArtistTitle } from '../utils/match'
import { isOverdue } from '../utils/lending'
import Highlight from './Highlight'
import LoanIcon from './LoanIcon'
import './BookCard.css'

export default function BookCard({ item, onOpen, lendingEnabled = false, copy = {}, query = '' }) {
  const { artist: author, album: bookTitle } = splitArtistTitle(item.title)

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
    <button type="button" className="book-card" onClick={() => onOpen(item)}>
      <span className="book-cover">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="book-cover-placeholder">{bookTitle?.[0] || '?'}</span>}
        {isOut && (
          <LoanIcon
            overdue={overdue}
            label={manageLabel}
            onActivate={() => onOpen(item, { focus: 'lending' })}
          />
        )}
      </span>
      <span className="book-card-info">
        <span className="book-card-title"><Highlight text={bookTitle} query={query} /></span>
        <span className="book-card-author"><Highlight text={author} query={query} /></span>
      </span>
    </button>
  )
}
