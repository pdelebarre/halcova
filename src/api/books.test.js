import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as books from './books'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

describe('searchByBarcode', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('cleans the ISBN, queries by isbn: and normalizes volumes', async () => {
    global.fetch.mockResolvedValue(okJson({
      items: [{
        id: 'vol1',
        volumeInfo: {
          title: 'A Wizard of Earthsea',
          authors: ['Ursula K. Le Guin'],
          publishedDate: '1968-11-01',
          publisher: 'Parnassus Press',
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780140349434' }],
          categories: ['Fantasy'],
          imageLinks: { thumbnail: 'http://books.google.com/thumb.jpg' },
          description: 'First book.',
          pageCount: 205,
          language: 'en',
        },
        selfLink: 'https://www.googleapis.com/books/v1/volumes/vol1',
      }],
    }))

    const results = await books.searchByBarcode('978-0-14-034943-4')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = new URL(global.fetch.mock.calls[0][0])
    expect(url.pathname).toBe('/books/v1/volumes')
    expect(url.searchParams.get('q')).toBe('isbn:9780140349434')
    expect(url.searchParams.get('country')).toBe('US')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      googleBooksId: 'vol1',
      title: 'Ursula K. Le Guin - A Wizard of Earthsea',
      year: '1968',
      label: 'Parnassus Press',
      isbn: '9780140349434',
      barcode: '9780140349434',
      genre: ['Fantasy'],
      coverImage: 'https://books.google.com/thumb.jpg', // http -> https
      description: 'First book.',
      pageCount: 205,
      language: 'en',
    })
  })

  it('falls back to ISBN_10 when no ISBN_13 is present', async () => {
    global.fetch.mockResolvedValue(okJson({
      items: [{
        id: 'vol2',
        volumeInfo: {
          title: 'No 13',
          industryIdentifiers: [{ type: 'ISBN_10', identifier: '0140349434' }],
        },
      }],
    }))
    const results = await books.searchByBarcode('0140349434')
    expect(results[0].isbn).toBe('0140349434')
    expect(results[0].barcode).toBe('0140349434')
  })

  it('handles volumes with no authors or no title', async () => {
    global.fetch.mockResolvedValue(okJson({
      items: [{
        id: 'vol3',
        volumeInfo: { title: 'Solo Title', publishedDate: '2020' },
      }],
    }))
    const results = await books.searchByBarcode('123')
    expect(results[0]).toMatchObject({
      title: 'Solo Title',
      year: '2020',
      isbn: '123',
    })
  })

  it('maps a missing items array to an empty list', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    expect(await books.searchByBarcode('123')).toEqual([])
  })
})

describe('searchByText', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('searches with maxResults and maps results', async () => {
    global.fetch.mockResolvedValue(okJson({
      items: [{ id: 'v', volumeInfo: { title: 'Earthsea', authors: ['Le Guin'] } }],
    }))
    const results = await books.searchByText('earthsea')
    const url = new URL(global.fetch.mock.calls[0][0])
    expect(url.searchParams.get('q')).toBe('earthsea')
    expect(url.searchParams.get('maxResults')).toBe('20')
    expect(results[0].title).toBe('Le Guin - Earthsea')
  })
})

describe('getBookDetail', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('returns description and pageCount', async () => {
    global.fetch.mockResolvedValue(okJson({
      volumeInfo: { description: 'Full desc', pageCount: 300 },
    }))
    const detail = await books.getBookDetail('vol1')
    expect(detail).toEqual({ description: 'Full desc', pageCount: 300 })
    expect(global.fetch.mock.calls[0][0]).toContain('/volumes/vol1')
  })

  it('defaults when volumeInfo is missing', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    const detail = await books.getBookDetail('vol1')
    expect(detail).toEqual({ description: '', pageCount: '' })
  })
})

describe('error handling', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('throws HTTP_ERROR on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    await expect(books.searchByText('x')).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  })
})
