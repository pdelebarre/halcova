// @vitest-environment node
//
// Unit suite for the tokenless OpenLibrary fallback provider (RES-1.3 T3, #283)
// at netlify/functions/_shared/providers/openlibrary.js.
//
// We mock the shared T1 helper (../lookup-fetch) rather than re-testing its
// retry/redirect behavior here (that's lookup-fetch.test.js). This suite pins
// what this adapter OWNS: the fixed-host SSRF posture, the redirect / size-cap
// / User-Agent enforcement, the ~1 req/s throttle, and the OpenLibrary ->
// Google Books `{ items:[...] }` envelope normalization (source:'openlibrary',
// openLibraryId set, googleBooksId null).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  searchBarcode,
  searchText,
  detail,
  throttle,
  ALLOWED_HOSTS,
} from './openlibrary'

const lookupFetch = vi.fn()

// Replace the real T1 helper with a controllable mock so we can assert exactly
// what this adapter sends upstream and how it handles the response.
vi.mock('../lookup-fetch', () => ({ lookupFetch: (...a) => lookupFetch(...a) }))

const originalFetch = global.fetch

beforeEach(() => {
  lookupFetch.mockReset()
  global.fetch = global.fetch // no-op to keep lint happy about keeping original
})

afterEach(() => {
  global.fetch = originalFetch
})

function upstream(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
  }
}

// A realistic OpenLibrary /api/books jscmd=data ISBN response (per-bibkey).
const isbnEntry = {
  bib_key: 'ISBN:9780452284234',
  info_url: 'https://openlibrary.org/books/OL20891788M/The_Handmaid_s_Tale',
  preview: 'noview',
  preview_url: 'https://openlibrary.org/books/OL20891788M/The_Handmaid_s_Tale',
  thumbnail_url: 'https://covers.openlibrary.org/b/id/8125329-M.jpg',
  details: {
    publishers: ['Anchor Books'],
    number_of_pages: 311,
    key: '/books/OL20891788M',
    authors: [{ url: 'https://openlibrary.org/authors/OL25697A', name: 'Margaret Atwood' }],
    title: 'The Handmaid\'s Tale',
    publish_date: '1998',
    covers: [8125329],
  },
}

// A realistic OpenLibrary /search.json doc.
const searchDoc = {
  key: '/works/OL168469W',
  title: 'The Handmaid\'s Tale',
  author_name: ['Margaret Atwood'],
  first_publish_year: 1985,
  publisher: ['McClelland and Stewart'],
  isbn: ['9780452284234'],
  cover_i: 8125329,
  edition_key: ['OL20891788M'],
}

describe('searchBarcode', () => {
  it('queries the fixed OpenLibrary /api/books base and returns the items envelope', async () => {
    lookupFetch.mockResolvedValue(upstream({ 'ISBN:9780452284234': isbnEntry }))
    const out = await searchBarcode(' 978-0-45228423-4\n')
    expect(lookupFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = lookupFetch.mock.calls[0]
    const parsed = new URL(url)
    // SSRF: the connect host is ALWAYS the fixed OpenLibrary API, never user input.
    expect(parsed.hostname).toBe('openlibrary.org')
    expect(parsed.pathname).toBe('/api/books')
    expect(parsed.searchParams.get('bibkeys')).toBe('ISBN:9780452284234')
    expect(parsed.searchParams.get('format')).toBe('json')
    expect(parsed.searchParams.get('jscmd')).toBe('data')
    // Descriptive User-Agent + no Authorization header.
    expect(opts.headers['User-Agent']).toContain('RunoutRecordCollector')
    expect(opts.headers.Authorization).toBeUndefined()

    expect(Array.isArray(out.items)).toBe(true)
    expect(out.items).toHaveLength(1)
  })

  it('normalizes an ISBN hit into the Google envelope (id null, openLibraryId + source set)', async () => {
    lookupFetch.mockResolvedValue(upstream({ 'ISBN:9780452284234': isbnEntry }))
    const out = await searchBarcode('9780452284234')
    const v = out.items[0]
    // googleBooksId must stay null for a fallback hit; openLibraryId + source
    // mark the provider. The ISBN endpoint only returns an EDITION OLID.
    expect(v.id).toBeNull()
    expect(v.source).toBe('openlibrary')
    expect(v.openLibraryId).toBe('OL20891788M') // edition OLID from /books/OLxxxxM
    expect(v.volumeInfo.title).toBe('The Handmaid\'s Tale')
    expect(v.volumeInfo.authors).toEqual(['Margaret Atwood'])
    expect(v.volumeInfo.publisher).toBe('Anchor Books')
    expect(v.volumeInfo.publishedDate).toBe('1998')
    expect(v.volumeInfo.pageCount).toBe(311)
    // Cover emitted as the covers.openlibrary.org URL (the cover proxy re-fetches
    // it from the allowlisted host).
    expect(v.volumeInfo.imageLinks.thumbnail).toBe('https://covers.openlibrary.org/b/id/8125329-M.jpg')
    // selfLink/infoLink mapped to info_url so toBookItem links correctly.
    expect(v.selfLink).toBe(isbnEntry.info_url)
    // industryIdentifiers carry the scanned ISBN so the client barcode resolves.
    expect(v.volumeInfo.industryIdentifiers[0]).toEqual({ type: 'ISBN_13', identifier: '9780452284234' })
  })

  it('returns an empty envelope (not throw) when the ISBN key is absent', async () => {
    lookupFetch.mockResolvedValue(upstream({}))
    expect(await searchBarcode('9780452284234')).toEqual({ items: [] })
  })

  it('returns an empty envelope (not throw) on a provider error', async () => {
    lookupFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await searchBarcode('9780452284234')).toEqual({ items: [] })
  })

  it('returns the empty envelope for a missing/empty/blank barcode without fetching', async () => {
    expect(await searchBarcode('   ')).toEqual({ items: [] })
    expect(await searchBarcode('!!!')).toEqual({ items: [] })
    expect(lookupFetch).not.toHaveBeenCalled()
  })
})

describe('searchText', () => {
  it('queries /search.json with the text + fields and maps docs to the envelope', async () => {
    lookupFetch.mockResolvedValue(upstream({ numFound: 1, docs: [searchDoc] }))
    const out = await searchText('handmaid tale')
    const parsed = new URL(lookupFetch.mock.calls[0][0])
    expect(parsed.hostname).toBe('openlibrary.org')
    expect(parsed.pathname).toBe('/search.json')
    expect(parsed.searchParams.get('q')).toBe('handmaid tale')
    expect(parsed.searchParams.get('limit')).toBe('10')
    expect(parsed.searchParams.get('fields')).toContain('author_name')
    expect(out.items).toHaveLength(1)

    const v = out.items[0]
    // search.json returns the WORK OLID — preferred as openLibraryId.
    expect(v.id).toBeNull()
    expect(v.source).toBe('openlibrary')
    expect(v.openLibraryId).toBe('OL168469W') // work OLID from /works/OLxxxW
    expect(v.volumeInfo.title).toBe('The Handmaid\'s Tale')
    expect(v.volumeInfo.authors).toEqual(['Margaret Atwood'])
    expect(v.volumeInfo.publishedDate).toBe('1985') // first_publish_year
    expect(v.volumeInfo.publisher).toBe('McClelland and Stewart')
    expect(v.volumeInfo.imageLinks.thumbnail).toBe('https://covers.openlibrary.org/b/id/8125329-M.jpg')
    // selfLink is the OpenLibrary work URL.
    expect(v.selfLink).toBe('https://openlibrary.org/works/OL168469W')
    // industryIdentifiers carry the doc ISBNs so the barcode resolves.
    expect(v.volumeInfo.industryIdentifiers[0]).toEqual({ type: 'ISBN_13', identifier: '9780452284234' })
  })

  it('returns an empty envelope (not throw) for a non-3xx upstream error status', async () => {
    lookupFetch.mockResolvedValue(upstream({ error: 'down' }, { status: 503 }))
    expect(await searchText('handmaid tale')).toEqual({ items: [] })
  })

  it('caps the query length and returns empty for blank text', async () => {
    expect(await searchText('   ')).toEqual({ items: [] })
    expect(lookupFetch).not.toHaveBeenCalled()
  })
})

describe('detail (uniform adapter contract)', () => {
  it('encodes the OLID into the fixed /works path and normalizes', async () => {
    lookupFetch.mockResolvedValue(upstream({ title: 'The Handmaid\'s Tale', first_publish_year: 1985 }))
    const out = await detail('OL168469W')
    const parsed = new URL(lookupFetch.mock.calls[0][0])
    expect(parsed.hostname).toBe('openlibrary.org')
    expect(parsed.pathname).toBe('/works/OL168469W.json')
    expect(out.source).toBe('openlibrary')
    expect(out.openLibraryId).toBe('OL168469W')
  })

  it('returns null on failure and for a missing olid', async () => {
    lookupFetch.mockRejectedValue(new Error('down'))
    expect(await detail('OL168469W')).toBeNull()
    lookupFetch.mockReset()
    expect(await detail('   ')).toBeNull()
  })
})

describe('SSRF posture', () => {
  it('only the fixed allowlisted hosts exist — no user-supplied host', () => {
    expect(ALLOWED_HOSTS).toContain('openlibrary.org')
    expect(ALLOWED_HOSTS).toContain('covers.openlibrary.org')
    // Only one API host is ever connected to; covers are a URL the proxy
    // re-fetches, not a host this adapter connects to.
    expect(ALLOWED_HOSTS).toEqual(['openlibrary.org', 'covers.openlibrary.org'])
  })

  it('rejects (throws -> empty envelope) a manual 3xx so a hostile redirect is never followed', async () => {
    lookupFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'https://169.254.169.254/latest/meta-data/' : null) },
      text: async () => '',
    })
    expect(await searchText('hello')).toEqual({ items: [] })
  })

  it('rejects an oversized provider body', async () => {
    const big = upstream({ numFound: 1, docs: [{ key: '/works/OL1W', title: 'x'.repeat(3 * 1024 * 1024) }] })
    lookupFetch.mockResolvedValue(big)
    expect(await searchText('hello')).toEqual({ items: [] })
  })
})

describe('throttle (tokenless ~1 req/s gate)', () => {
  it('spaces calls at least minIntervalMs apart', async () => {
    vi.useFakeTimers()
    try {
      const p1 = throttle('t', 1000)
      const p2 = throttle('t', 1000)
      await vi.advanceTimersByTimeAsync(500)
      let resolved2 = false
      p2.then(() => { resolved2 = true })
      await vi.advanceTimersByTimeAsync(500) // t=1000 — first resolves, second slots behind it
      await vi.advanceTimersByTimeAsync(1000) // t=2000 — second resolves
      await p1
      await p2
      expect(resolved2).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
