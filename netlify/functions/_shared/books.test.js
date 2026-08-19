// @vitest-environment node
//
// SSRF regression suite for the Google Books lookup proxy (netlify/functions/
// books.js, SEC-6.3 #217). The lookup actions (searchBarcode / searchText /
// detail) build their endpoint from a FIXED GOOGLE_BASE — user input only rides
// as encoded query/path params, never as the host — which is asserted here
// against a mocked global fetch. The public cover action is also exercised
// through this handler (the pure allowlist lives in _shared/cover.test.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import booksHandler from '../books'
import { adminSessionToken } from './session-test-helpers'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key) { const v = this.data.get(String(key)); return v === undefined ? null : JSON.parse(JSON.stringify(v)) },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({ getStore: (name) => stores[name] || (stores[name] = createStore()) }))

const originalFetch = global.fetch
let TOKEN = ''

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    // Non-empty so the SSRF/host tests exercise the Google PRIMARY path only
    // (the OpenLibrary fallback wouldn't fire on a healthy non-empty result,
    // keeping these tests fast and focused on the fixed-Google-host assertion).
    text: async () => JSON.stringify({ items: [{ id: 'seed-primary' }] }),
    headers: { get: () => 'application/json' },
  })
  TOKEN = await adminSessionToken()
})

afterEach(() => {
  global.fetch = originalFetch
})

function req(path, token = TOKEN) {
  return {
    method: 'GET',
    url: `http://localhost${path}`,
    headers: { get: (n) => (String(n).toLowerCase() === 'authorization' ? `Bearer ${token}` : '') },
  }
}

describe('lookup actions — fixed base host only (no host injection)', () => {
  it('searchText with a URL-shaped query still fetches only the Google Books base', async () => {
    await booksHandler(req(`/.netlify/functions/books?action=searchText&q=${encodeURIComponent('https://evil.example.com/steal')}`))
    const fetched = String(global.fetch.mock.calls[0][0])
    const parsed = new URL(fetched)
    // The HOST is always the fixed Google Books API — the malicious string only
    // ever rides as an encoded query-param VALUE, never as the connect host.
    expect(parsed.hostname).toBe('www.googleapis.com')
    expect(parsed.origin + parsed.pathname).toBe('https://www.googleapis.com/books/v1/volumes')
  })

  it('detail id is URL-encoded into the fixed path — no host/path escape', async () => {
    await booksHandler(req(`/.netlify/functions/books?action=detail&id=${encodeURIComponent('../@evil.com/x')}`))
    const fetched = String(global.fetch.mock.calls[0][0])
    const parsed = new URL(fetched)
    // Host is fixed; the malicious value is a SINGLE percent-encoded path
    // segment (..%2F… won't decode into a traversal or a new host).
    expect(parsed.hostname).toBe('www.googleapis.com')
    expect(parsed.pathname.startsWith('/books/v1/volumes/')).toBe(true)
    expect(fetched).not.toContain('@evil.com')
    expect(parsed.pathname).not.toContain('/../')
  })

  it('non-cover fetches use redirect: manual so a hostile 3xx is never followed (NIT M5)', async () => {
    await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780140328721'))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][1].redirect).toBe('manual')
  })

  it('searchBarcode sends only the fixed base with the digits as a param', async () => {
    await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780140328721'))
    const fetched = String(global.fetch.mock.calls[0][0])
    expect(fetched.startsWith('https://www.googleapis.com/books/v1/')).toBe(true)
  })
})

describe('cover action — public SSRF surface (via the books handler)', () => {
  const malicious = [
    'https://127.0.0.1/x.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://books.google.com.evil.com/x.jpg',
    'https://evil-discogs.com/x.jpg',
    'http://books.google.com/x.jpg',
    'https://[::1]/x.jpg',
  ]
  for (const url of malicious) {
    it(`rejects ${url} with 400 and never touches the network`, async () => {
      const res = await booksHandler(req(`/.netlify/functions/books?action=cover&url=${encodeURIComponent(url)}`))
      expect(res.status).toBe(400)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  }
})

describe('error-code mapping through the real lookupFetch (T1 handler integration, #284)', () => {
  // Drive the ACTUAL handler with a mocked global.fetch. The shared T1 helper
  // (lookup-fetch.js) runs for REAL inside the handler — we do not stub the
  // helper, only the network. `retry-after: 1` keeps the helper's real backoff
  // deterministic (each retry sleeps exactly ~1s instead of random jitter).
  function upstream(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '1' : 'application/json') },
      text: async () => JSON.stringify(body),
    }
  }

  it('transient 429 then 200 -> returns the items payload (success)', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(429, {}))
      .mockResolvedValueOnce(upstream(200, { items: [{ id: 'b1' }] }))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([{ id: 'b1' }])
    // The 429 was actually retried through the helper, not returned to the user.
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('persistent 429 -> PROVIDER_RATE_LIMIT (distinct from our own RATE_LIMIT)', async () => {
    global.fetch.mockResolvedValue(upstream(429, {}))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=test'))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('PROVIDER_RATE_LIMIT')
    // The provider's upstream 429 must surface as PROVIDER_RATE_LIMIT, never
    // our own client-facing RATE_LIMIT used for our throttling.
    expect(body.code).not.toBe('RATE_LIMIT')
  })

  it('persistent network failure -> 502 HTTP_ERROR', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=test'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('HTTP_ERROR')
  })
})

// RES-1.3 T3 (#283) — OpenLibrary fallback chain through the REAL handler.
//
// The OpenLibrary adapter (providers/openlibrary.js) calls the REAL shared T1
// lookupFetch helper, which in turn uses global.fetch — so we drive the whole
// chain with a sequenced global.fetch mock: Google primary first, then the
// OpenLibrary fallback request when it fires. `retry-after: 1` keeps the T1
// helper's real backoff deterministic (each retry sleeps ~1s instead of jitter).
describe('OpenLibrary fallback chain (RES-1.3 T3, #283)', () => {
  function upstream(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '1' : 'application/json') },
      text: async () => JSON.stringify(body),
    }
  }

  function callsToHost(host) {
    return global.fetch.mock.calls
      .map(([u]) => { try { return new URL(String(u)).hostname } catch { return '' } })
      .filter((h) => h === host)
  }

  // A realistic OpenLibrary /api/books jscmd=data ISBN response.
  const OL_ISBN = {
    'ISBN:9780452284234': {
      info_url: 'https://openlibrary.org/books/OL20891788M/x',
      thumbnail_url: 'https://covers.openlibrary.org/b/id/8125329-M.jpg',
      details: {
        title: "The Handmaid's Tale",
        key: '/books/OL20891788M',
        authors: [{ name: 'Margaret Atwood' }],
        publishers: ['Anchor Books'],
        publish_date: '1998',
        number_of_pages: 311,
        covers: [8125329],
      },
    },
  }

  it('Google healthy-empty -> OpenLibrary fallback resolves the ISBN (source/openLibraryId, googleBooksId null)', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(200, { items: [] })) // Google healthy-empty
      .mockResolvedValueOnce(upstream(200, OL_ISBN))        // OpenLibrary fallback
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items).toHaveLength(1)
    const v = body.items[0]
    // The fallback hit is marked + carries the additive id; googleBooksId null.
    expect(v.source).toBe('openlibrary')
    expect(v.openLibraryId).toBe('OL20891788M') // edition OLID for the ISBN endpoint
    expect(v.id).toBeNull()
    // The fallback hit normalized into the Google envelope (toBookItem shape).
    expect(v.volumeInfo.title).toBe("The Handmaid's Tale")
    expect(v.volumeInfo.imageLinks.thumbnail).toBe('https://covers.openlibrary.org/b/id/8125329-M.jpg')
    // OpenLibrary WAS contacted (Google was empty).
    expect(callsToHost('openlibrary.org')).toHaveLength(1)
  })

  it('Google service error (5xx) -> OpenLibrary fallback fires', async () => {
    // lookupFetch retries a persistent 5xx across 3 attempts, then books maps
    // the last 500 to HTTP_ERROR (not a NO_FALLBACK code) -> fallback fires.
    global.fetch
      .mockResolvedValueOnce(upstream(500, {}))
      .mockResolvedValueOnce(upstream(500, {}))
      .mockResolvedValueOnce(upstream(500, {}))
      .mockResolvedValueOnce(upstream(200, OL_ISBN))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].source).toBe('openlibrary')
    expect(callsToHost('openlibrary.org')).toHaveLength(1)
  })

  it('Google non-empty -> primary wins, OpenLibrary never contacted', async () => {
    global.fetch.mockResolvedValue(upstream(200, { items: [{ id: 'g1', volumeInfo: { title: 'Google Hit' } }] }))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('g1')
    expect(callsToHost('openlibrary.org')).toHaveLength(0)
  })

  it('Google empty + OpenLibrary empty -> primary empty result is preserved', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(200, { items: [] })) // Google healthy-empty
      .mockResolvedValueOnce(upstream(200, {}))             // OpenLibrary: no ISBN key -> empty
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Primary empty result preserved, not an error, not a fallback hit.
    expect(body.items).toEqual([])
  })

  it('NO_FALLBACK on a provider rate limit — OpenLibrary is never contacted', async () => {
    global.fetch.mockResolvedValue(upstream(429, {}))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=handmaid'))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('PROVIDER_RATE_LIMIT')
    // The rate-limited primary is authoritative — no extra load on the fallback.
    expect(callsToHost('openlibrary.org')).toHaveLength(0)
  })

  it('NO_FALLBACK on HTTP-related auth codes is honored by the books chain (additive ids not offered for detail)', async () => {
    // books has no fallback surface for `detail` at all — only search actions do.
    global.fetch.mockResolvedValue(upstream(200, { id: 'g1', volumeInfo: { title: 'X' } }))
    const res = await booksHandler(req('/.netlify/functions/books?action=detail&id=g1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('g1')
    // detail is Google-only and must never touch OpenLibrary.
    expect(callsToHost('openlibrary.org')).toHaveLength(0)
  })
})

