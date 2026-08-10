import { splitArtistTitle } from '../utils/match'
import './BookCard.css'

export default function BookCard({ item, onOpen }) {
  const { artist: author, album: bookTitle } = splitArtistTitle(item.title)

  return (
    <button className="book-card" onClick={() => onOpen(item)}>
      <span className="book-cover">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="book-cover-placeholder">{bookTitle?.[0] || '?'}</span>}
      </span>
      <span className="book-card-info">
        <span className="book-card-title">{bookTitle}</span>
        <span className="book-card-author">{author}</span>
      </span>
    </button>
  )
}
