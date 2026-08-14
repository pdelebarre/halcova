// @vitest-environment node
//
// Handler-level tests for the PUBLIC `action=cover` image proxy added in
// Phase 0 (T6) — the network path of handleCover as reached through the real
// discogs.js / books.js function handlers. The pure SSRF allowlist is already
// covered by _shared/cover.test.js; these tests exercise the fetch + response
// behavior with a mocked global fetch so no real network is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import discogsHandler from '../discogs'
import booksHandler from '../books'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key) {
        const value = this.data.get(String(key))
        return value === undefined ? null : JSON.parse(JSON.stringify(value))
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({
  getStore: (name) => {
    if (!stores[name]) stores[name] = createStore()
    return stores[name]
  },
}))

const DISC = '/.netlify/functions/discogs'
const BOOKS = '/.netlify/functions/books'

// A small realistic JPEG-ish byte payload.
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])

function coverReq(fnPath, url) {
  return {
    method: 'GET',
    url: `http://localhost${fnPath}?action=cover&url=${encodeURIComponent(url)}`,
    headers: { get: () => null },
  }
}

function imageResponse(contentType = 'image/jpeg', body = IMG) {
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer,
  }
}

// A 3xx upstream response (redirect: 'manual' surfaces it as the raw
// response, so the proxy must reject it instead of following).
function redirectResponse(location) {
  return {
    ok: false,
    status: 302,
    headers: { get: (k) => (String(k).toLowerCase() === 'location' ? location : null) },
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const originalFetch = global.fetch

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('cover action — public proxied image (T6)', () => {
  it('proxies an allowlisted https cover with image bytes, content-type and Cache-Control', async () => {
    global.fetch.mockResolvedValue(imageResponse('image/jpeg'))

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/cover-1.jpeg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('max-age=')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes)).toEqual(Array.from(IMG))
    // The upstream fetch hit the exact allowed URL.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe('https://i.discogs.com/hash/cover-1.jpeg')
  })

  it('passes an abort signal to the upstream fetch (timeout guard)', async () => {
    let capturedSignal = null
    global.fetch.mockImplementation((_url, init) => {
      capturedSignal = init?.signal
      return Promise.resolve(imageResponse())
    })

    await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/cover-1.jpeg'))
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })

  it('rejects an off-allowlist host with 400 without touching the network', async () => {
    const res = await discogsHandler(coverReq(DISC, 'https://evil.example.com/steal.png'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Cover URL not allowed.' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a non-https cover with 400 even on an allowed host', async () => {
    const res = await discogsHandler(coverReq(DISC, 'http://i.discogs.com/hash/cover-1.jpeg'))
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns a graceful 502 when the upstream request fails (HTTP status)', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/missing.jpeg'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('HTTP_ERROR')
  })

  it('returns a graceful 502 when the upstream network call rejects (e.g. timeout abort)', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    global.fetch.mockRejectedValue(abortError)

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/cover-1.jpeg'))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('HTTP_ERROR')
  })

  it('rejects an oversized body with 502', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    global.fetch.mockResolvedValue(imageResponse('image/png', big))

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/big.png'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('large')
    expect(body.code).toBe('HTTP_ERROR')
  })

  it('rejects non-image content with 502', async () => {
    global.fetch.mockResolvedValue(imageResponse('text/html', new TextEncoder().encode('<html></html>')))

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/page.html'))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('HTTP_ERROR')
  })

  it('serves a repeat request from the shared cover cache without a second upstream fetch', async () => {
    global.fetch.mockResolvedValue(imageResponse('image/jpeg'))
    const url = 'https://i.discogs.com/hash/cover-1.jpeg'

    expect((await discogsHandler(coverReq(DISC, url))).status).toBe(200)
    expect((await discogsHandler(coverReq(DISC, url))).status).toBe(200)
    // One upstream fetch total — the second request came from the cache.
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('serves a cache hit with the same Cache-Control and content-type', async () => {
    global.fetch.mockResolvedValue(imageResponse('image/webp'))
    const url = 'https://i.discogs.com/hash/cover-1.jpeg'
    await discogsHandler(coverReq(DISC, url)) // prime the cache

    const res = await discogsHandler(coverReq(DISC, url))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toContain('max-age=')
  })

  it('routes the cover action through the books function identically', async () => {
    global.fetch.mockResolvedValue(imageResponse('image/jpeg'))

    const res = await booksHandler(
      coverReq(BOOKS, 'https://books.google.com/books/content?id=abc&printsec=frontcover'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes)).toEqual(Array.from(IMG))
  })

  it('rejects a books cover from an off-allowlist host via the books function', async () => {
    const res = await booksHandler(coverReq(BOOKS, 'https://covers.openlibrary.org/b/isbn/123-M.jpg'))
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does NOT follow a 302 to an off-allowlist host (SSRF guard)', async () => {
    const evilUrl = 'https://evil.com/x.jpg'
    global.fetch.mockResolvedValue(redirectResponse(evilUrl))

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/cover-1.jpeg'))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('HTTP_ERROR')
    // The redirect target must never be fetched — only the initial URL.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe('https://i.discogs.com/hash/cover-1.jpeg')
    expect(global.fetch.mock.calls.some(([url]) => url === evilUrl)).toBe(false)
  })

  it('rejects a redirect even to an allowed host — the proxy never follows 3xx', async () => {
    const target = 'https://i.discogs.com/hash/other-2.jpeg'
    global.fetch.mockResolvedValue(redirectResponse(target))

    const res = await discogsHandler(coverReq(DISC, 'https://i.discogs.com/hash/cover-1.jpeg'))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('redirect')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls.some(([url]) => url === target)).toBe(false)
  })
})
