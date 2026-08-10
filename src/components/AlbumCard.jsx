import { splitArtistTitle } from '../utils/match'
import './AlbumCard.css'

const badgeClass = {
  LP: 'lp', EP: 'ep', CD: 'cd', '7"': 'seven', '12"': 'lp',
}

export default function AlbumCard({ item, onOpen }) {
  const { artist, album: albumTitle } = splitArtistTitle(item.title)

  return (
    <button className="album-card" onClick={() => onOpen(item)}>
      <span className={`record-peek fmt-${(badgeClass[item.formatType] || 'other')}`} aria-hidden="true" />
      <span className="sleeve">
        {item.coverImage
          ? <img src={item.coverImage} alt="" loading="lazy" />
          : <span className="sleeve-placeholder">{albumTitle?.[0] || '?'}</span>}
      </span>
      <span className="album-card-info">
        <span className="album-card-title">{albumTitle}</span>
        <span className="album-card-artist">{artist}</span>
      </span>
    </button>
  )
}
