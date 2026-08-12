import { describe, expect, it } from 'vitest'
import { recordsCatalog, booksCatalog } from './catalog'

describe('recordsCatalog', () => {
  it('is shaped for records and the crate flow', () => {
    expect(recordsCatalog.kind).toBe('records')
    expect(recordsCatalog.storage).toBe('records')
    expect(recordsCatalog.entity).toBe('record')
    expect(recordsCatalog.collectionLabel).toBe('crate')
    expect(recordsCatalog.lookupName).toBe('Discogs')
    expect(recordsCatalog.getDetail).toBeTypeOf('function')
    expect(recordsCatalog.formats).toEqual(['LP', 'EP', 'CD', '7"', '12"'])
    expect(recordsCatalog.sortOptions.map((o) => o.value)).toEqual(['added', 'artist', 'year', 'format'])
  })

  it('exposes render components and a detail link', () => {
    expect(recordsCatalog.components.Card).toBeTypeOf('function')
    expect(recordsCatalog.components.Grid).toBeTypeOf('function')
    expect(recordsCatalog.components.Detail).toBeTypeOf('function')
    expect(recordsCatalog.components.ManualAdd).toBeTypeOf('function')
    expect(recordsCatalog.detailLink({ discogsId: 42 })).toBe('https://www.discogs.com/release/42')
  })

  it('has the copy strings and helpers used by the UI', () => {
    expect(recordsCatalog.copy.emptyTitle).toBe('Your crate is empty')
    expect(recordsCatalog.copy.addToast).toBe('Added to your crate')
    expect(recordsCatalog.copy.moreBy('Miles Davis', 3)).toBe('More by Miles Davis in your crate (3)')
    expect(recordsCatalog.copy.nothingElseBy('Miles Davis')).toBe('Nothing else by Miles Davis in your crate')
    expect(recordsCatalog.copy.resultGood.label).toBe('Not in your crate yet')
  })
})

describe('booksCatalog', () => {
  it('is shaped for books and the shelf flow', () => {
    expect(booksCatalog.kind).toBe('books')
    expect(booksCatalog.storage).toBe('books')
    expect(booksCatalog.entity).toBe('book')
    expect(booksCatalog.collectionLabel).toBe('shelf')
    expect(booksCatalog.lookupName).toBe('Google Books')
    expect(booksCatalog.formats).toEqual([])
    expect(booksCatalog.genreLabel).toBe('Category')
    expect(booksCatalog.artistLabel).toBe('author')
    expect(booksCatalog.sortOptions.map((o) => o.value)).toEqual(['added', 'artist', 'title', 'year'])
  })

  it('builds a detail link from infoLink or googleBooksId', () => {
    expect(booksCatalog.detailLink({ infoLink: 'https://example.com/book', googleBooksId: 'abc' }))
      .toBe('https://example.com/book')
    expect(booksCatalog.detailLink({ infoLink: '', googleBooksId: 'abc' }))
      .toBe('https://books.google.com/books?id=abc')
  })

  it('has the book-specific copy', () => {
    expect(booksCatalog.copy.emptyTitle).toBe('Your shelf is empty')
    expect(booksCatalog.copy.addToast).toBe('Added to your shelf')
    expect(booksCatalog.copy.moreBy('Le Guin', 2)).toBe('More by Le Guin on your shelf (2)')
  })
})
