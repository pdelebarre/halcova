// @vitest-environment node
//
// SSRF regression suite for the Discogs lookup proxy (netlify/functions/
// discogs.js, SEC-6.3 #217). The cover action is the PUBLIC SSRF surface and is
// exercised handler-level here (the pure URL allowlist is in _shared/cover.test.js
// and the fetch/redirect/size behavior in _shared/cover-action.test.js). The
// lookup actions (searchBarcode / searchText / release) must NEVER forward a
// user-supplied host — the fetch is only ever called with the fixed
// DISCOGS_BASE — which is asserted directly against a mocked global fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import discogsHandler from '../discogs'
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
  process.env.RUNOUT_DISCOGS_TOKEN = 'tok_test'
  for (const key of Object.keys(stores)) delete stores[key]
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ results: [] }),
    headers: { get: () => 'application/json' },
  })
  TOKEN = await adminSessionToken()
})

afterEach(() => {
  delete process.env.RUNOUT_DISCOGS_TOKEN
  global.fetch = originalFetch
})

// An authenticated GET request against the discogs function.
function req(path, token = TOKEN) {
  return {
    method: 'GET',
    url: `http://localhost${path}`,
    headers: { get: (n) => (String(n).toLowerCase() === 'authorization' ? `Bearer ${token}` : '') },
  }
}

describe('lookup actions — fixed base host only (no host injection)', () => {
  it('searchText with a URL-shaped query still fetches only the Discogs API base', async () => {
    await discogsHandler(req(`/.netlify/functions/discogs?action=searchText&q=${encodeURIComponent('https://evil.example.com/steal')}`))
    const fetched = String(global.fetch.mock.calls[0][0])
    const parsed = new URL(fetched)
    // The HOST is always the fixed Discogs API — the malicious string only ever
    // rides as an encoded query-param VALUE, never as the connect host.
    expect(parsed.hostname).toBe('api.discogs.com')
    expect(parsed.origin + parsed.pathname).toBe('https://api.discogs.com/database/search')
  })

  it('release id is sanitized to digits — no path traversal or host injection', async () => {
    await discogsHandler(req('/.netlify/functions/discogs?action=release&id=123%40evil.com//x'))
    const fetched = String(global.fetch.mock.calls[0][0])
    expect(fetched.startsWith('https://api.discogs.com/releases/123')).toBe(true)
    expect(fetched).not.toContain('evil.com')
  })

  it('searchBarcode sends only the fixed base with the digits as a param', async () => {
    await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=0012345'))
    const fetched = String(global.fetch.mock.calls[0][0])
    expect(fetched.startsWith('https://api.discogs.com/')).toBe(true)
  })

  it('non-cover fetches use redirect: manual so a hostile 3xx is never followed (NIT M5)', async () => {
    await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=0012345'))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][1].redirect).toBe('manual')
  })
})

describe('cover action — public SSRF surface (via the discogs handler)', () => {
  const malicious = [
    'https://127.0.0.1/x.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://discogs.com.evil.com/x.jpg',
    'https://evil-discogs.com/x.jpg',
    'http://i.discogs.com/x.jpg',
    'https://[::1]/x.jpg',
  ]
  for (const url of malicious) {
    it(`rejects ${url} with 400 and never touches the network`, async () => {
      const res = await discogsHandler(req(`/.netlify/functions/discogs?action=cover&url=${encodeURIComponent(url)}`))
      expect(res.status).toBe(400)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  }

  it('does NOT follow a redirect to an off-allowlist host (SSRF guard)', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'https://169.254.169.254/latest/meta-data/' : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const res = await discogsHandler(req(`/.netlify/functions/discogs?action=cover&url=${encodeURIComponent('https://i.discogs.com/hash/x.jpeg')}`))
    expect(res.status).toBe(502) // rejected as a redirect, not followed
    // Only the initial (allowlisted) URL was fetched — the redirect target never is.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(String(global.fetch.mock.calls[0][0])).toBe('https://i.discogs.com/hash/x.jpeg')
  })
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

  it('transient 429 then 200 -> returns the results payload (success)', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(429, {}))
      .mockResolvedValueOnce(upstream(200, { results: [{ id: 123 }] }))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toEqual([{ id: 123 }])
    // The 429 was actually retried through the helper, not returned to the user.
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('persistent 429 -> PROVIDER_RATE_LIMIT (distinct from our own RATE_LIMIT)', async () => {
    global.fetch.mockResolvedValue(upstream(429, {}))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=test'))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('PROVIDER_RATE_LIMIT')
    // The provider's upstream 429 must surface as PROVIDER_RATE_LIMIT, never
    // our own client-facing RATE_LIMIT used for our throttling.
    expect(body.code).not.toBe('RATE_LIMIT')
  })

  it('persistent network failure -> 502 HTTP_ERROR', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=test'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('HTTP_ERROR')
  })

  it('upstream 401 -> BAD_TOKEN with no retry (non-retryable)', async () => {
    global.fetch.mockResolvedValue(upstream(401, { message: 'invalid token' }))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=test'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('BAD_TOKEN')
    // A 401 is a non-retryable upstream status — the helper must NOT retry it.
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
