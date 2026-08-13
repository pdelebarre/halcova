import './CoverShelf.css'

/**
 * A horizontal, swipeable shelf of cards for the collection "Floor"
 * (§ Phase 1) — the shop-front display. Reuses the catalog's Card
 * (AlbumCard/BookCard) with the exact same props the grid passes, so covers
 * render identically to the wall.
 */
export default function CoverShelf({ items = [], Card, onOpen, lendingEnabled = false, copy = {}, label = '' }) {
  return (
    <div className="cover-shelf" role="group" aria-label={label}>
      {items.map((item) => (
        <Card key={item.id} item={item} onOpen={onOpen} lendingEnabled={lendingEnabled} copy={copy} />
      ))}
    </div>
  )
}
