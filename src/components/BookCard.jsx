import { splitArtistTitle } from '../utils/match'
import { isOverdue } from '../utils/lending'
import './BookCard.css'

export default function BookCard({ item, onOpen, lendingEnabled = false, copy = {} }) {
  const { artist: author, album: bookTitle } = splitArtistTitle(item.title)

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
    <button type="button" className="book-card" onClick={() => onOpen(item)}>
      <span className="book-cover">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="book-cover-placeholder">{bookTitle?.[0] || '?'}</span>}
        {badgeLabel && (
          <span className={`lending-badge${overdue ? ' overdue' : ''}`}>{badgeLabel}</span>
        )}
      </span>
      <span className="book-card-info">
        <span className="book-card-title">{bookTitle}</span>
        <span className="book-card-author">{author}</span>
      </span>
    </button>
  )
}
