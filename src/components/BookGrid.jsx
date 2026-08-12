import BookCard from './BookCard'
// Books share the responsive grid layout used for records.
import './AlbumGrid.css'

export default function BookGrid({ items, onOpen, lendingEnabled = false, copy = {} }) {
  return (
    <div className="album-grid album-grid--books">
      {items.map((item) => (
        <BookCard key={item.id} item={item} onOpen={onOpen} lendingEnabled={lendingEnabled} copy={copy} />
      ))}
    </div>
  )
}
