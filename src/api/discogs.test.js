import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as discogs from './discogs'
import { saveSession } from '../utils/session'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

function statusJson(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

describe('token helpers', () => {
  beforeEach(() => localStorage.clear())

  it('tracks whether a token is set', () => {
    expect(discogs.hasToken()).toBe(false)
    discogs.setToken('  abc123  ')
    expect(discogs.hasToken()).toBe(true)
    expect(localStorage.getItem('runout_discogs_token_local')).toBe('abc123')
    discogs.clearToken()
    expect(discogs.hasToken()).toBe(false)
  })

  it('namespaces the token per signed-in user', () => {
    saveSession({ user: { id: 'u42' }, code: 'RU-XXXX' })
    discogs.setToken('mine')
    expect(localStorage.getItem('runout_discogs_token_u42')).toBe('mine')
    expect(discogs.hasToken()).toBe(true)
  })
})

describe('searchByBarcode', () => {
  beforeEach(() => {
    discogs.setToken('tok')
    global.fetch = vi.fn()
  })

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
    const url = new URL(global.fetch.mock.calls[0][0])
    expect(url.pathname).toBe('/database/search')
    expect(url.searchParams.get('barcode')).toBe('07464405491')
    expect(url.searchParams.get('token')).toBe('tok')
    expect(url.searchParams.get('type')).toBe('release')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      discogsId: 101, title: 'Miles Davis - Kind of Blue', year: 1959,
      label: 'Columbia', catno: 'CL 1355', formatRaw: 'Vinyl, LP, Album',
      formatType: 'LP', genre: ['Jazz'], style: ['Modal'], country: 'US',
      coverImage: 'https://img/cover.jpg', barcode: '07464405491',
    })
  })

  it('maps a missing results array to an empty list', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    const results = await discogs.searchByBarcode('123')
    expect(results).toEqual([])
  })

  it('throws NO_TOKEN and does not fetch when no token is set', async () => {
    discogs.clearToken()
    await expect(discogs.searchByBarcode('123')).rejects.toMatchObject({ code: 'NO_TOKEN' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throws BAD_TOKEN on 401', async () => {
    global.fetch.mockResolvedValue(statusJson(401, {}))
    await expect(discogs.searchByBarcode('123')).rejects.toMatchObject({ code: 'BAD_TOKEN' })
  })

  it('throws RATE_LIMIT on 429', async () => {
    global.fetch.mockResolvedValue(statusJson(429, {}))
    await expect(discogs.searchByBarcode('123')).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('throws HTTP_ERROR on other non-ok responses', async () => {
    global.fetch.mockResolvedValue(statusJson(500, {}))
    await expect(discogs.searchByBarcode('123')).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  })
})

describe('parseFormatType (via searchByText)', () => {
  beforeEach(() => {
    discogs.setToken('tok')
    global.fetch = vi.fn()
  })

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
  beforeEach(() => {
    discogs.setToken('tok')
    global.fetch = vi.fn()
  })

  it('caps results at 20 and passes the query', async () => {
    const results = Array.from({ length: 30 }, (_, i) => ({ id: i, title: `R${i}` }))
    global.fetch.mockResolvedValue(okJson({ results }))
    const out = await discogs.searchByText('blah')
    expect(out).toHaveLength(20)
    const url = new URL(global.fetch.mock.calls[0][0])
    expect(url.searchParams.get('q')).toBe('blah')
    expect(out[0].barcode).toBe('')
  })
})

describe('getReleaseDetail', () => {
  beforeEach(() => {
    discogs.setToken('tok')
    global.fetch = vi.fn()
  })

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
    expect(global.fetch.mock.calls[0][0]).toContain('/releases/101')
  })

  it('defaults missing tracklist and images', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    const detail = await discogs.getReleaseDetail(101)
    expect(detail.tracklist).toEqual([])
    expect(detail.images).toEqual([])
    expect(detail.notes).toBe('')
  })
})
