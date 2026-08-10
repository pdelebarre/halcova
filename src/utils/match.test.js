import { describe, expect, it } from 'vitest'
import { splitArtistTitle, findRelated } from './match'

describe('splitArtistTitle', () => {
  it('splits "Artist - Album" on the first separator', () => {
    expect(splitArtistTitle('Miles Davis - Kind of Blue')).toEqual({
      artist: 'Miles Davis',
      album: 'Kind of Blue',
    })
  })

  it('handles empty / falsy input', () => {
    expect(splitArtistTitle('')).toEqual({ artist: '', album: '' })
    expect(splitArtistTitle(null)).toEqual({ artist: '', album: '' })
    expect(splitArtistTitle(undefined)).toEqual({ artist: '', album: '' })
  })

  it('treats a string without a separator as an album with no artist', () => {
    expect(splitArtistTitle('Just An Album Title')).toEqual({ artist: '', album: 'Just An Album Title' })
  })

  it('trims surrounding whitespace on both parts', () => {
    expect(splitArtistTitle('  Miles Davis  -  Kind of Blue  ')).toEqual({
      artist: 'Miles Davis',
      album: 'Kind of Blue',
    })
  })

  it('keeps the rest of the title when there are multiple separators', () => {
    expect(splitArtistTitle('Author - Series - Book')).toEqual({
      artist: 'Author',
      album: 'Series - Book',
    })
  })
})

describe('findRelated', () => {
  const items = [
    { id: '1', title: 'Miles Davis - Kind of Blue', discogsId: 111, barcode: '1111' },
    { id: '2', title: 'Miles Davis - Bitches Brew', discogsId: 222, barcode: '2222' },
    { id: '3', title: 'John Coltrane - A Love Supreme', googleBooksId: 'gb3', barcode: '3333' },
  ]

  it('flags an exact match by discogsId', () => {
    const res = findRelated({ title: 'Miles Davis - Kind of Blue', discogsId: 111 }, items)
    expect(res.ownedExact).toEqual(items[0])
    expect(res.sameAlbum).toEqual([])
    expect(res.otherArtist.map((i) => i.id)).toEqual(['2'])
  })

  it('flags an exact match by googleBooksId', () => {
    const res = findRelated({ title: 'John Coltrane - A Love Supreme', googleBooksId: 'gb3' }, items)
    expect(res.ownedExact).toEqual(items[2])
  })

  it('flags an exact match by barcode', () => {
    const res = findRelated({ title: 'Miles Davis - Kind of Blue', barcode: '1111' }, items)
    expect(res.ownedExact).toEqual(items[0])
    expect(res.sameAlbum).toEqual([])
  })

  it('groups same-album pressings and other albums separately', () => {
    const res = findRelated({ title: 'Miles Davis - Kind of Blue', barcode: '9999' }, items)
    expect(res.ownedExact).toBeNull()
    expect(res.sameAlbum.map((i) => i.id)).toEqual(['1'])
    expect(res.otherArtist.map((i) => i.id)).toEqual(['2'])
  })

  it('returns empty groups when the candidate has no artist', () => {
    const res = findRelated({ title: 'An album with no artist' }, items)
    expect(res.ownedExact).toBeNull()
    expect(res.sameAlbum).toEqual([])
    expect(res.otherArtist).toEqual([])
  })

  it('matches artists and albums case-insensitively', () => {
    const res = findRelated({ title: 'miles davis - kind of blue' }, items)
    expect(res.sameAlbum.map((i) => i.id)).toEqual(['1'])
  })

  it('does not treat the owned exact match as a related row but still lists other albums', () => {
    const res = findRelated({ title: 'Miles Davis - Kind of Blue', discogsId: 111 }, items)
    expect(res.ownedExact).toEqual(items[0])
    expect(res.sameAlbum).toEqual([])
    expect(res.otherArtist.map((i) => i.id)).toEqual(['2'])
  })

  it('returns no owned match and empty groups for unrelated candidates', () => {
    const res = findRelated({ title: 'Nina Simone - Pastel Blues', barcode: '5555' }, items)
    expect(res.ownedExact).toBeNull()
    expect(res.sameAlbum).toEqual([])
    expect(res.otherArtist).toEqual([])
  })
})
