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
    text: async () => JSON.stringify({ items: [] }),
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
