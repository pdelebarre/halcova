import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as discogs from './discogs'
import { saveSession } from '../utils/session'

const SESSION_TOKEN = 'tok-discogs-session-abc123'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

function errorJson(status, body = {}) {
  return { ok: false, status, json: async () => body }
}

beforeEach(() => {
  localStorage.clear()
  saveSession({ user: { id: 'u42' }, session: SESSION_TOKEN })
  global.fetch = vi.fn()
})

describe('searchByBarcode', () => {
  it('cleans the barcode to digits and normalizes results', async () => {
    global.fetch.mockResolvedValue(okJson({
      results: [{
        id: 101, type: 'release', title: 'Miles Davis - Kind of Blue', year: 1959,
        label: ['Columbia'], catno: 'CL 1355', format: ['Vinyl', 'LP', 'Album'],
        genre: ['Jazz'], style: ['Modal'], country: 'US',
        cover_image: 'https://img/cover.jpg', thumb: 'https://img/thumb.jpg',
        resource_url: 'https://api.discogs.com/releases/101',
      }],
    }))

    const results = await discogs.searchByBarcode('0 7464-40549-1\n')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/.netlify/functions/discogs')
    expect(url.searchParams.get('action')).toBe('searchBarcode')
    expect(url.searchParams.get('barcode')).toBe('07464405491')
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${SESSION_TOKEN}` })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      discogsId: 101, title: 'Miles Davis - Kind of Blue', year: 1959,
      label: 'Columbia', catno: 'CL 1355', formatRaw: 'Vinyl, LP, Album',
      formatType: 'LP', genre: ['Jazz'], style: ['Modal'], country: 'US',
      coverImage: `${url.pathname}?action=cover&url=${encodeURIComponent('https://img/cover.jpg')}`,
      barcode: '07464405491',
    })
  })

  it('maps a missing results array to an empty list', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    const results = await discogs.searchByBarcode('123')
    expect(results).toEqual([])
  })

  it('leaves the cover empty when the raw cover URL is missing or unsafe', async () => {
    global.fetch.mockResolvedValue(okJson({
      results: [
        { id: 1, title: 'No Cover' }, // no cover_image, no thumb
        { id: 2, title: 'Http Cover', cover_image: 'http://img/cover.jpg' }, // non-https — not proxied
      ],
    }))

    const results = await discogs.searchByBarcode('123')
    expect(results[0].coverImage).toBe('')
    expect(results[1].coverImage).toBe('')
  })

  it('surfaces the community rating and count when present', async () => {
    global.fetch.mockResolvedValue(okJson({
      results: [{
        id: 202, title: 'Miles Davis - Kind of Blue', year: 1959,
        community: { rating: 4.5, rating_count: 128 },
      }],
    }))

    const results = await discogs.searchByBarcode('123')
    expect(results[0]).toMatchObject({ rating: 4.5, ratingCount: 128 })
  })

  it('omits rating fields when the community block is absent or empty', async () => {
    global.fetch.mockResolvedValue(okJson({
      results: [
        { id: 1, title: 'No Community' },
        { id: 2, title: 'Zero rating', community: { rating: 0, rating_count: 0 } },
      ],
    }))

    const results = await discogs.searchByBarcode('123')
    expect(results[0].rating).toBeUndefined()
    expect(results[0].ratingCount).toBeUndefined()
    expect(results[1].rating).toBeUndefined()
    expect(results[1].ratingCount).toBeUndefined()
  })
})

describe('parseFormatType (via searchByText)', () => {
  it.each([
    [['CD'], 'CD'],
    [['Vinyl', 'LP'], 'LP'],
    [['Vinyl', 'EP'], 'EP'],
    [['Cassette'], 'Cassette'],
    [['Vinyl', '7"'], '7"'],
    [['Vinyl', '12"'], '12"'],
    [['Vinyl'], 'LP'], // bare "Vinyl" falls back to LP
    [['File', 'MP3'], 'Other'],
    [undefined, 'Other'],
  ])('maps %j to %s', async (format, expected) => {
    global.fetch.mockResolvedValue(okJson({ results: [{ id: 1, format }] }))
    const results = await discogs.searchByText('kind of blue')
    expect(results[0].formatType).toBe(expected)
  })
})

describe('searchByText', () => {
  it('caps results at 20 and passes the query', async () => {
    const results = Array.from({ length: 30 }, (_, i) => ({ id: i, title: `R${i}` }))
    global.fetch.mockResolvedValue(okJson({ results }))
    const out = await discogs.searchByText('blah')
    expect(out).toHaveLength(20)
    const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/.netlify/functions/discogs')
    expect(url.searchParams.get('action')).toBe('searchText')
    expect(url.searchParams.get('q')).toBe('blah')
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${SESSION_TOKEN}` })
    expect(out[0].barcode).toBe('')
  })
})

describe('getReleaseDetail', () => {
  it('normalizes tracklist, notes and images', async () => {
    global.fetch.mockResolvedValue(okJson({
      tracklist: [{ position: 'A1', title: 'So What', duration: '9:22' }],
      notes: 'Mono pressing',
      images: [{ resource_url: 'https://img/1.jpg' }, { resource_url: 'https://img/2.jpg' }],
    }))
    const detail = await discogs.getReleaseDetail(101)
    expect(detail).toEqual({
      tracklist: [{ position: 'A1', title: 'So What', duration: '9:22' }],
      notes: 'Mono pressing',
      images: ['https://img/1.jpg', 'https://img/2.jpg'],
    })
    const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/.netlify/functions/discogs')
    expect(url.searchParams.get('action')).toBe('release')
    expect(url.searchParams.get('id')).toBe('101')
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${SESSION_TOKEN}` })
  })

  it('defaults missing tracklist and images', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    const detail = await discogs.getReleaseDetail(101)
    expect(detail.tracklist).toEqual([])
    expect(detail.images).toEqual([])
    expect(detail.notes).toBe('')
  })

  it('surfaces the nested community rating from a release detail', async () => {
    global.fetch.mockResolvedValue(okJson({
      tracklist: [],
      notes: '',
      images: [],
      community: { rating: { count: 42, average: 4.2 } },
    }))
    const detail = await discogs.getReleaseDetail(101)
    expect(detail).toMatchObject({ rating: 4.2, ratingCount: 42 })
  })
})

describe('error mapping', () => {
  it.each([
    ['SERVER_NO_TOKEN', 500],
    ['BAD_TOKEN', 502],
    ['RATE_LIMIT', 429],
    ['HTTP_ERROR', 500],
  ])('surfaces the proxy %s code as err.code', async (code, status) => {
    global.fetch.mockResolvedValue(errorJson(status, { error: 'proxy failure', code }))
    await expect(discogs.searchByBarcode('123')).rejects.toMatchObject({ code })
  })

  it('falls back to HTTP_ERROR when the error body has no code', async () => {
    global.fetch.mockResolvedValue(errorJson(503, { error: 'boom' }))
    await expect(discogs.searchByBarcode('123')).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  })
})
