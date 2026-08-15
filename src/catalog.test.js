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

  it('exposes browse axes (Genre · Artist · Decade · Format · Label)', () => {
    expect(recordsCatalog.browseAxes.map((a) => a.id)).toEqual(['genre', 'artist', 'decade', 'format', 'label'])
    for (const axis of recordsCatalog.browseAxes) {
      expect(axis.label).toBeTypeOf('string')
      expect(axis.value).toBeTypeOf('function')
    }
    const decade = recordsCatalog.browseAxes.find((a) => a.id === 'decade')
    expect(decade.value({ year: 1963 })).toEqual(['1960s'])
    const artist = recordsCatalog.browseAxes.find((a) => a.id === 'artist')
    expect(artist.value({ title: 'Miles Davis - Kind of Blue' })).toEqual(['Miles Davis'])
    const format = recordsCatalog.browseAxes.find((a) => a.id === 'format')
    expect(format.value({ formatType: 'LP' })).toEqual(['LP'])
    expect(format.value({})).toEqual([])
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

  it('exposes browse axes (Category · Author · Year)', () => {
    expect(booksCatalog.browseAxes.map((a) => a.id)).toEqual(['category', 'author', 'year'])
    const author = booksCatalog.browseAxes.find((a) => a.id === 'author')
    expect(author.value({ title: 'Ursula K. Le Guin - The Left Hand of Darkness' })).toEqual(['Ursula K. Le Guin'])
    const year = booksCatalog.browseAxes.find((a) => a.id === 'year')
    expect(year.value({ year: 1969 })).toEqual(['1969'])
    expect(year.value({})).toEqual([])
  })
})

describe('community reviews contract (feat/reviews)', () => {
  it('anchors a review thread via reviewKey on both catalogs', () => {
    expect(recordsCatalog.reviewKey({ discogsId: 372469 })).toBe(372469)
    expect(recordsCatalog.reviewKey({ discogsId: undefined })).toBeUndefined()
    expect(booksCatalog.reviewKey({ googleBooksId: 'abc123' })).toBe('abc123')
    expect(booksCatalog.reviewKey({ googleBooksId: undefined })).toBeUndefined()
  })

  it('exposes the shared ReviewsSection copy on both catalogs', () => {
    for (const catalog of [recordsCatalog, booksCatalog]) {
      expect(catalog.copy.reviews.section).toBe('Community reviews')
      expect(catalog.copy.reviews.save).toBe('Post review')
      expect(catalog.copy.reviews.update).toBe('Update review')
      expect(catalog.copy.reviews.postedToast).toBe('Review posted')
      expect(catalog.copy.reviews.updatedToast).toBe('Review updated')
    }
  })
})

describe('gamification (Phase 1 § Play)', () => {
  // The Play surface is NOT a compile-time flag anymore: it is gated per
  // account by the admin-granted `features.games` entitlement (App.jsx reads
  // `user.features?.games`; see App.test.jsx for the gating cases).

  it('exposes a Play nav label and persona copy on both catalogs', () => {
    for (const catalog of [recordsCatalog, booksCatalog]) {
      expect(catalog.copy.gamif.nav).toBe('Play')
      expect(catalog.copy.gamif.persona.title).toBe('Your persona')
      expect(typeof catalog.copy.gamif.persona.headline).toBe('string')
      expect(catalog.copy.gamif.persona.hashtag).toBe('#WhatsInYourHalcova')
      expect(catalog.copy.gamif.persona.share).toBe('Export card')
      // Fallback archetype is present for every kind.
      expect(catalog.copy.gamif.persona.archetypes.fallback.name).toBe('A Young Collection')
      expect(catalog.copy.gamif.persona.archetypes.fallback.verdict).toMatch(/young/i)
    }
  })

  it('keeps records and books persona archetypes separate', () => {
    const recordNames = Object.keys(recordsCatalog.copy.gamif.persona.archetypes)
    const bookNames = Object.keys(booksCatalog.copy.gamif.persona.archetypes)
    expect(recordNames).toEqual(expect.arrayContaining(['crate-digger', 'time-traveler', 'genre-tourist', 'completist', 'impulse-buyer', 'one-timer', 'variant-collector', 'sophisticate', 'fallback']))
    expect(bookNames).toEqual(expect.arrayContaining(['couch-intellectual', 'series-starter', 'genre-hedonist', 'page-counter', 'one-series-wonder', 'first-edition-idealist', 'fallback']))
  })

  it('exposes the Play hub tabs on both catalogs', () => {
    for (const catalog of [recordsCatalog, booksCatalog]) {
      expect(catalog.copy.gamif.tabs.persona).toBe('Persona')
      expect(catalog.copy.gamif.tabs.progression).toBe('Progress')
      expect(catalog.copy.gamif.tabs.stories).toBe('Stories')
    }
  })

  it('exposes per-kind level ladders (copy-bank.md §4)', () => {
    expect(recordsCatalog.copy.gamif.progression.levels.map((l) => l.title)).toEqual([
      'Crate Sprout', 'Crate Nerd', 'Crate Digger', 'Vinyl Sage', 'Crate Deity',
    ])
    expect(booksCatalog.copy.gamif.progression.levels.map((l) => l.title)).toEqual([
      'Page Turner', 'Shelf Stacker', 'Bookworm', 'Literary Cartographer', 'Shelf Sovereign',
    ])
    for (const catalog of [recordsCatalog, booksCatalog]) {
      expect(catalog.copy.gamif.progression.levels).toHaveLength(5)
      for (const level of catalog.copy.gamif.progression.levels) {
        expect(level.toast).toBeTypeOf('string')
      }
    }
  })

  it('exposes the badge copy bank for every badge id the engine knows', () => {
    const ids = ['digger', 'pageturner', 'genre-tourist', 'time-traveler', 'completist', 'impulse-buyer', 'sleeve-sleuth', 'balanced-diet', 'one-timer', 'variant-hoarder', 'friend-of-crate', 'quiz-whiz']
    for (const catalog of [recordsCatalog, booksCatalog]) {
      for (const id of ids) {
        expect(catalog.copy.gamif.badges[id]).toBeDefined()
        expect(catalog.copy.gamif.badges[id].name).toBeTypeOf('string')
        expect(catalog.copy.gamif.badges[id].line).toBeTypeOf('string')
      }
    }
  })

  it('exposes Shelf Stories copy with cards for every story id', () => {
    const ids = ['year-span', 'decade-bias', 'era-lesson', 'country-mix', 'series', 'one-timer', 'notes-coverage', 'total-pages']
    for (const catalog of [recordsCatalog, booksCatalog]) {
      expect(catalog.copy.gamif.stories.headline).toMatch(/stories/i)
      expect(catalog.copy.gamif.stories.quest).toBe('Turn into a quest')
      for (const id of ids) {
        expect(catalog.copy.gamif.stories.cards[id]).toBeDefined()
        expect(catalog.copy.gamif.stories.cards[id].title).toBeTypeOf('string')
        expect(catalog.copy.gamif.stories.cards[id].body).toBeTypeOf('string')
      }
    }
  })
})
