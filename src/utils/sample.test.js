import { describe, expect, it } from 'vitest'
import { SAMPLE_RECORD, SAMPLE_BOOK } from './sample'

// C2.3 (issue #85, epic #84): the curated "Try a sample" items are fed
// straight into the result flow — no lookup API, no token, no network. They
// must be client-side copies of the demo seed items in the app's real item
// shape (title as "Artist - Album" / "Author - Title", year, label, genre,
// coverImage, barcode, kind-specific id).
describe('try-a-sample curated items (issue #85, epic #84 C2.3)', () => {
  it('ships the exact curated record in the real item shape', () => {
    expect(SAMPLE_RECORD.title).toBe('Pink Floyd - The Dark Side of the Moon')
    expect(SAMPLE_RECORD.year).toBe(1973)
    expect(SAMPLE_RECORD.label).toBe('Harvest')
    expect(SAMPLE_RECORD.catno).toBe('SHVL 804')
    expect(SAMPLE_RECORD.formatType).toBe('LP')
    expect(SAMPLE_RECORD.genre).toEqual(['Rock', 'Progressive Rock'])
    expect(SAMPLE_RECORD.coverImage).toBe('https://upload.wikimedia.org/wikipedia/en/3/3b/Dark_Side_of_the_Moon.png')
    expect(SAMPLE_RECORD.barcode).toBe('0077774602129')
    expect(SAMPLE_RECORD.discogsId).toBe(372469)
  })

  it('ships the exact curated book in the real item shape', () => {
    expect(SAMPLE_BOOK.title).toBe('George Orwell - 1984')
    expect(SAMPLE_BOOK.year).toBe(1949)
    expect(SAMPLE_BOOK.label).toBe('Secker & Warburg')
    expect(SAMPLE_BOOK.genre).toEqual(['Fiction', 'Dystopian'])
    expect(SAMPLE_BOOK.coverImage).toBe('https://covers.openlibrary.org/b/isbn/9780452284234-M.jpg')
    expect(SAMPLE_BOOK.barcode).toBe('9780452284234')
    expect(SAMPLE_BOOK.googleBooksId).toBe('k5hUDwAAQBAJ')
    expect(SAMPLE_BOOK.pageCount).toBe(328)
    expect(SAMPLE_BOOK.description).toMatch(/Winston Smith rewrites history for the Party/)
  })
})
