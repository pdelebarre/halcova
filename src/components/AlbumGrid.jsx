import AlbumCard from './AlbumCard'
import './AlbumGrid.css'

export default function AlbumGrid({ items, onOpen, lendingEnabled = false, copy = {}, query = '' }) {
  return (
    <div className="album-grid">
      {items.map((item) => (
        <AlbumCard key={item.id} item={item} onOpen={onOpen} lendingEnabled={lendingEnabled} copy={copy} query={query} />
      ))}
    </div>
  )
}
