import BookCard from './BookCard'
// Books share the responsive grid layout used for records.
import './AlbumGrid.css'

export default function BookGrid({ items, onOpen }) {
  return (
    <div className="album-grid">
      {items.map((item) => (
        <BookCard key={item.id} item={item} onOpen={onOpen} />
      ))}
    </div>
  )
}
