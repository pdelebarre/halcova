import AlbumCard from './AlbumCard'
import './AlbumGrid.css'

export default function AlbumGrid({ items, onOpen, lendingEnabled = false, copy = {} }) {
  return (
    <div className="album-grid">
      {items.map((item) => (
        <AlbumCard key={item.id} item={item} onOpen={onOpen} lendingEnabled={lendingEnabled} copy={copy} />
      ))}
    </div>
  )
}
