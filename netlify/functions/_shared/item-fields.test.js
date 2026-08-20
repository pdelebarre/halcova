// @vitest-environment node
//
// Tests for the collection item field allowlist + schema validation
// (SEC-EPIC-2 #188 mass-assignment defense, SEC-EPIC-3 #194 input validation).

import { describe, expect, it } from 'vitest'
import {
  ARTISTS_MAX,
  AUTHORS_MAX,
  ITEM_FIELD_ALLOWLIST,
  ITEM_PROTECTED_FIELDS,
  pickItemFields,
  SNIPPET_MAX,
  TRACKLIST_MAX,
  validateItem,
} from './item-fields'

describe('pickItemFields — allowlist (SEC-EPIC-2 #188)', () => {
  it('keeps only allowlisted fields and drops protected identity/privilege fields', () => {
    const out = pickItemFields({
      title: 'A - B',
      year: 2020,
      ownerId: 'owner',
      userId: 'u1',
      role: 'admin',
      plan: 'unlimited',
      id: 'forged',
      code: 'RU-X',
      notes: 'ok',
    })
    expect(out).toEqual({ title: 'A - B', year: 2020, notes: 'ok' })
    expect(out.ownerId).toBeUndefined()
    expect(out.id).toBeUndefined()
  })

  it('yields an empty object for junk / non-objects', () => {
    expect(pickItemFields(null)).toEqual({})
    expect(pickItemFields('x')).toEqual({})
    expect(pickItemFields([1, 2])).toEqual({})
  })

  it('exposes the protected-field list for the negative tests', () => {
    expect(ITEM_PROTECTED_FIELDS.has('ownerId')).toBe(true)
    expect(ITEM_PROTECTED_FIELDS.has('role')).toBe(true)
    expect(ITEM_FIELD_ALLOWLIST.has('title')).toBe(true)
  })
})

describe('validateItem — schema validation (SEC-EPIC-3 #194)', () => {
  it('accepts a valid full item and trims string values', () => {
    const { item, error } = validateItem({ title: '  A - B  ', year: 2020, wishlist: true })
    expect(error).toBeUndefined()
    expect(item.title).toBe('A - B')
    expect(item.year).toBe(2020)
  })

  it('rejects a missing title with REQUIRED', () => {
    expect(validateItem({ year: 2020 }).error.code).toBe('REQUIRED')
  })

  it('rejects a title that is not a string (type mismatch)', () => {
    expect(validateItem({ title: 42 }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects an over-length notes field', () => {
    expect(validateItem({ title: 'A', notes: 'x'.repeat(6000) }).error.code).toBe('TOO_LONG')
  })

  it('rejects an out-of-range year', () => {
    expect(validateItem({ title: 'A', year: 999 }).error.code).toBe('OUT_OF_RANGE')
  })

  it('rejects a non-boolean wishlist', () => {
    expect(validateItem({ title: 'A', wishlist: 'yes' }).error.code).toBe('TYPE_ERROR')
  })

  it('a partial (PUT) patch may omit title but still validates the present fields', () => {
    const { item, error } = validateItem({ notes: 'x' }, { partial: true })
    expect(error).toBeUndefined()
    expect(item.notes).toBe('x')
    // A type-mismatch in a partial patch is still rejected.
    expect(validateItem({ year: 'nope' }, { partial: true }).error.code).toBe('TYPE_ERROR')
  })
})

describe('pickItemFields — Phase A enrichment does not widen the privilege surface (FEAT-EPIC-5 #276)', () => {
  it('keeps the new enrichment fields but still drops protected identity/privilege fields', () => {
    const out = pickItemFields({
      title: 'A - B',
      artists: [{ id: 1, name: 'X' }],
      masterId: 9,
      ownerId: 'owner',
      role: 'admin',
      code: 'RU-X',
      userId: 'u1',
    })
    expect(out.artists).toEqual([{ id: 1, name: 'X' }])
    expect(out.masterId).toBe(9)
    expect(out.ownerId).toBeUndefined()
    expect(out.role).toBeUndefined()
    expect(out.code).toBeUndefined()
    expect(out.userId).toBeUndefined()
  })

  it('does not expose rating/ratingCount on the collection item write surface', () => {
    expect(ITEM_FIELD_ALLOWLIST.has('rating')).toBe(false)
    expect(ITEM_FIELD_ALLOWLIST.has('ratingCount')).toBe(false)
    expect(pickItemFields({ rating: 5, ratingCount: 3 })).toEqual({})
  })

  it('carries the additive mbid fallback id (RES-1.2 T2 #288) alongside discogsId', () => {
    expect(ITEM_FIELD_ALLOWLIST.has('mbid')).toBe(true)
    const out = pickItemFields({
      title: 'Miles Davis - Kind of Blue',
      discogsId: null, // null for a MusicBrainz fallback hit
      mbid: 'b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12',
    })
    expect(out.discogsId).toBeNull()
    expect(out.mbid).toBe('b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12')
  })

  it('validates mbid as an optional string and rejects a non-string', () => {
    const { item, error } = validateItem({ title: 'A - B', mbid: 'b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12' })
    expect(error).toBeUndefined()
    expect(item.mbid).toBe('b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12')
    // A numeric mbid is a type error (MBIDs are UUID strings).
    expect(validateItem({ title: 'A - B', mbid: 123 }).error.code).toBe('TYPE_ERROR')
    // An over-length mbid is rejected.
    expect(validateItem({ title: 'A - B', mbid: 'x'.repeat(100) }).error.code).toBe('TOO_LONG')
  })

  it('carries the additive openLibraryId fallback id (RES-1.3 T3 #283) alongside googleBooksId', () => {
    expect(ITEM_FIELD_ALLOWLIST.has('openLibraryId')).toBe(true)
    const out = pickItemFields({
      title: 'Margaret Atwood - The Handmaid\'s Tale',
      googleBooksId: null, // null for an OpenLibrary fallback hit
      openLibraryId: 'OL168469W',
    })
    expect(out.googleBooksId).toBeNull()
    expect(out.openLibraryId).toBe('OL168469W')
  })

  it('validates openLibraryId as an optional string and rejects a non-string', () => {
    const { item, error } = validateItem({ title: 'A - B', openLibraryId: 'OL168469W' })
    expect(error).toBeUndefined()
    expect(item.openLibraryId).toBe('OL168469W')
    // A numeric openLibraryId is a type error (OLIDs are strings).
    expect(validateItem({ title: 'A - B', openLibraryId: 123 }).error.code).toBe('TYPE_ERROR')
    // An over-length openLibraryId is rejected.
    expect(validateItem({ title: 'A - B', openLibraryId: 'x'.repeat(300) }).error.code).toBe('TOO_LONG')
  })
})

describe('validateItem — accepts well-formed Phase A enrichment (FEAT-EPIC-5 #276)', () => {
  it('accepts a well-formed enriched record (artists, masterId, tracklist, released)', () => {
    const { item, error } = validateItem({
      title: 'The Artist - Album',
      artists: [
        { id: 123, name: 'The Artist', anv: 'T.A.', role: 'Main' },
        { id: 456, name: 'Guest' },
      ],
      masterId: 999,
      tracklist: [
        { position: 'A1', title: 'Song One', duration: '3:45' },
        { position: 'A2', title: 'Song Two' },
      ],
      released: '1987-05-15',
    })
    expect(error).toBeUndefined()
    expect(item.artists).toEqual([
      { id: 123, name: 'The Artist', anv: 'T.A.', role: 'Main' },
      { id: 456, name: 'Guest' },
    ])
    expect(item.masterId).toBe(999)
    expect(item.tracklist[1]).toEqual({ position: 'A2', title: 'Song Two' })
    expect(item.released).toBe('1987-05-15')
  })

  it('accepts a well-formed enriched book (authorsList, subtitle, series, mainCategory, snippet)', () => {
    const { item, error } = validateItem({
      title: 'Author - Book',
      authorsList: [{ name: 'Jane Doe', id: 'book-id-1' }, { name: 'John Roe' }],
      subtitle: 'A Subtitle',
      series: 'The Series',
      mainCategory: 'Fiction',
      snippet: 'A short blurb about the book.',
    })
    expect(error).toBeUndefined()
    expect(item.authorsList).toEqual([
      { name: 'Jane Doe', id: 'book-id-1' },
      { name: 'John Roe' },
    ])
    expect(item.subtitle).toBe('A Subtitle')
    expect(item.series).toBe('The Series')
    expect(item.mainCategory).toBe('Fiction')
    expect(item.snippet).toBe('A short blurb about the book.')
  })

  it('stores the trimmed, sub-key-scoped entries rather than the raw body arrays', () => {
    const { item, error } = validateItem({
      title: 'A - B',
      artists: [{ id: 1, name: '  Artist  ', anv: '  A.  ' }],
      tracklist: [{ position: ' A1 ', title: '  Song  ' }],
      authorsList: [{ name: '  Author  ', id: '  id  ' }],
    })
    expect(error).toBeUndefined()
    expect(item.artists[0]).toEqual({ id: 1, name: 'Artist', anv: 'A.' })
    expect(item.tracklist[0]).toEqual({ position: 'A1', title: 'Song' })
    expect(item.authorsList[0]).toEqual({ name: 'Author', id: 'id' })
  })

  it('tolerates absent / null / empty enrichment (full or partial writes)', () => {
    const { item, error } = validateItem({
      title: 'A - B',
      artists: null,
      masterId: null,
      released: '',
      authorsList: [],
    })
    expect(error).toBeUndefined()
    expect(item.artists).toBeNull()
    expect(item.masterId).toBeNull()
    expect(item.released).toBe('')
    expect(item.authorsList).toEqual([])
    expect(validateItem({ snippet: 'x' }, { partial: true }).item.snippet).toBe('x')
  })
})

describe('validateItem — rejects malformed Phase A enrichment (FEAT-EPIC-5 #276, §11.11 threat model)', () => {
  // artists[] (cap ARTISTS_MAX)
  it('rejects an oversized artists array', () => {
    const artists = Array.from({ length: ARTISTS_MAX + 1 }, (_, i) => ({ id: i + 1, name: `A${i}` }))
    expect(validateItem({ title: 'A', artists }).error.code).toBe('TOO_LONG')
  })

  it('rejects a non-array artists field', () => {
    expect(validateItem({ title: 'A', artists: 'not-an-array' }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects an artist entry that is a primitive, an array, or null', () => {
    expect(validateItem({ title: 'A', artists: ['Nope'] }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', artists: [[1]] }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', artists: [null] }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects an artist entry with an unknown/extra sub-key (deep hostile object)', () => {
    expect(validateItem({ title: 'A', artists: [{ id: 1, name: 'X', payload: { evil: true } }] }).error.code).toBe('UNKNOWN_FIELD')
  })

  it('rejects an artist entry with a nested object where a string is expected', () => {
    expect(validateItem({ title: 'A', artists: [{ id: 1, name: { nested: true } }] }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects an artist entry with a non-integer id and a missing name', () => {
    expect(validateItem({ title: 'A', artists: [{ id: '1', name: 'X' }] }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', artists: [{ id: 1 }] }).error.code).toBe('REQUIRED')
  })

  it('rejects an artist name that is over-length', () => {
    expect(validateItem({ title: 'A', artists: [{ id: 1, name: 'x'.repeat(301) }] }).error.code).toBe('TOO_LONG')
  })

  // tracklist[] (cap TRACKLIST_MAX)
  it('rejects a huge tracklist', () => {
    const tracklist = Array.from({ length: TRACKLIST_MAX + 1 }, (_, i) => ({ position: `A${i}`, title: `T${i}` }))
    expect(validateItem({ title: 'A', tracklist }).error.code).toBe('TOO_LONG')
  })

  it('rejects a track missing its title and a non-string position', () => {
    expect(validateItem({ title: 'A', tracklist: [{ position: 'A1' }] }).error.code).toBe('REQUIRED')
    expect(validateItem({ title: 'A', tracklist: [{ position: 1, title: 'T' }] }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects a track entry with an unknown sub-key', () => {
    expect(validateItem({ title: 'A', tracklist: [{ position: 'A1', title: 'T', lyrics: 'x' }] }).error.code).toBe('UNKNOWN_FIELD')
  })

  // masterId
  it('rejects a non-number masterId and an out-of-range one', () => {
    expect(validateItem({ title: 'A', masterId: '999' }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', masterId: 0 }).error.code).toBe('OUT_OF_RANGE')
  })

  // released
  it('rejects a non-string released and a non-date released', () => {
    expect(validateItem({ title: 'A', released: 1987 }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', released: 'May 1987' }).error.code).toBe('TYPE_ERROR')
  })

  // authorsList[] (cap AUTHORS_MAX)
  it('rejects an oversized authorsList', () => {
    const authorsList = Array.from({ length: AUTHORS_MAX + 1 }, (_, i) => ({ name: `A${i}` }))
    expect(validateItem({ title: 'A', authorsList }).error.code).toBe('TOO_LONG')
  })

  it('rejects an author entry with a non-string name and a nested id', () => {
    expect(validateItem({ title: 'A', authorsList: [{ name: 42 }] }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', authorsList: [{ name: 'X', id: { deep: 1 } }] }).error.code).toBe('TYPE_ERROR')
  })

  // scalar strings
  it('rejects non-string subtitle, series, and mainCategory', () => {
    expect(validateItem({ title: 'A', subtitle: 1 }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', series: [] }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', mainCategory: {} }).error.code).toBe('TYPE_ERROR')
  })

  it('rejects a non-string snippet and an over-length snippet', () => {
    expect(validateItem({ title: 'A', snippet: ['x'] }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ title: 'A', snippet: 'x'.repeat(SNIPPET_MAX + 1) }).error.code).toBe('TOO_LONG')
  })

  it('rejects malformed enrichment in a partial (PUT) patch too', () => {
    expect(validateItem({ artists: [{ id: 1, name: 'X', role: { deep: true } }] }, { partial: true }).error.code).toBe('TYPE_ERROR')
    expect(validateItem({ snippet: 123 }, { partial: true }).error.code).toBe('TYPE_ERROR')
  })
})

describe('validateItem — rejects XSS payloads in item fields (SEC-7.5, #409)', () => {
  // Defense-in-depth: `str()` fails closed on script tags / event handlers /
  // embedded dangerous elements / javascript: URIs across the whole
  // client-writable text surface (title, notes, description, arrays, …).

  it('rejects a title containing a <script> tag', () => {
    expect(validateItem({ title: '<script>alert(1)</script>' }).error.code).toBe('HTML_REJECTED')
    expect(validateItem({ title: '<SCRIPT>alert(1)</SCRIPT>' }).error.code).toBe('HTML_REJECTED')
  })

  it('rejects dangerous content in every string item field', () => {
    const cases = [
      { notes: '<script>alert(1)</script>' },
      { description: 'see <img src=x onerror=alert(1)>' },
      { subtitle: 'javascript:alert(1)' },
      { series: '<svg onload=alert(1)>' },
      { mainCategory: '<iframe src=evil>' },
      { label: 'x onmouseover=alert(1)' },
      { snippet: 'more <object>junk</object>' },
    ]
    for (const body of cases) {
      expect(validateItem({ title: 'A', ...body }).error.code, JSON.stringify(body)).toBe('HTML_REJECTED')
    }
  })

  it('rejects XSS payloads inside structured enrichment arrays', () => {
    expect(validateItem({ title: 'A', artists: [{ id: 1, name: '<script>alert(1)</script>' }] }).error.code).toBe('HTML_REJECTED')
    expect(validateItem({ title: 'A', tracklist: [{ position: 'A1', title: 'x onerror=alert(1)' }] }).error.code).toBe('HTML_REJECTED')
    expect(validateItem({ title: 'A', authorsList: [{ name: '<img src=x onerror=alert(1)>' }] }).error.code).toBe('HTML_REJECTED')
  })

  it('still rejects XSS in a partial (PUT) patch', () => {
    expect(validateItem({ notes: '<script>alert(1)</script>' }, { partial: true }).error.code).toBe('HTML_REJECTED')
  })

  it('accepts benign text that is not an event-handler attribute', () => {
    const { item, error } = validateItem({ title: 'The Artist - Album', notes: 'phone one = two, a > b, c < d' })
    expect(error).toBeUndefined()
    expect(item.title).toBe('The Artist - Album')
  })
})
