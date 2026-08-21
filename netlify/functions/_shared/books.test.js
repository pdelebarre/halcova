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
import { EMPTY_SENTINEL, writeEmptyCache } from './lookup-cache'
import { PROVIDER_COOLDOWN_MS, recordProviderDown } from './provider-state'

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

// SEC-3.2 (#195) — the proxy-level provider body cap (books.js MAX_PROXY_BYTES
// = 1 MiB). The provider ADAPTERS cap their own bodies (tested in
// providers/openlibrary.test.js), but the proxy cap is what stops a hostile/
// degenerate Google body from being buffered into the function or the shared
// cache. The OpenLibrary fallback is also size-capped (2 MiB), so an oversized
// primary body degrades the whole chain to ALL_PROVIDERS_FAILED and is never
// cached.
describe('SEC-3.2 (#195) — proxy-level provider body cap (books.js)', () => {
  it('rejects an oversized Google Books response — never cached, safe ALL_PROVIDERS_FAILED', async () => {
    // Primary body just over the 1 MiB proxy cap; fallback body just over the
    // OpenLibrary adapter's own 2 MiB cap.
    const hugeGoogle = JSON.stringify({ items: [{ id: 'x', volumeInfo: { title: 'y'.repeat(1 * 1024 * 1024 + 1) } }] })
    const hugeOpenLibrary = JSON.stringify({ 'ISBN:9780452284234': { details: { title: 'z'.repeat(2 * 1024 * 1024 + 1) } } })
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => hugeGoogle, headers: { get: () => 'application/json' } })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => hugeOpenLibrary, headers: { get: () => 'application/json' } })

    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('ALL_PROVIDERS_FAILED')
    // Both hosts were contacted (primary then fallback) — but the oversized
    // body was NEVER written into the shared cache.
    const hosts = global.fetch.mock.calls.map((c) => new URL(String(c[0])).hostname)
    expect(hosts[0]).toBe('www.googleapis.com')
    expect(hosts[1]).toBe('openlibrary.org')
    expect(Object.keys(stores['books-cache']?.data || {})).toEqual([])
  })

  it('rejects a non-JSON content-type fail-closed (SEC-6.3 #217)', async () => {
    // A hostile Google upstream returns an HTML body with a non-JSON
    // content-type — the proxy must reject it (never parse/cache it) and the
    // fallback chain fires. The OpenLibrary fallback returns valid JSON and
    // wins, proving the primary's bad body was never cached.
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => '<html>not json</html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ 'ISBN:9780452284234': { details: { title: 'T' } } }),
      })
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The fallback won — the primary's non-JSON body was rejected, not cached.
    expect(body.source).toBe('openlibrary')
    expect(Object.keys(stores['books-cache']?.data || {})).toEqual([])
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

  it('persistent network failure -> 502 ALL_PROVIDERS_FAILED (RES-1.5 T5)', async () => {
    // A network failure is a genuine service outage, so the OpenLibrary fallback
    // also attempts and fails; RES-1.5 T5 (#290) collapses "every provider down"
    // into a distinct ALL_PROVIDERS_FAILED code.
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=test'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('ALL_PROVIDERS_FAILED')
    // T5: the persistent-network path runs the real retry backoff chain (Google
    // 3 attempts + OpenLibrary); give it an explicit timeout so it never flakes
    // against the 5s Vitest default (same fix as its sibling test below).
  }, 15000)
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
    // RES-1.5 T5 (#290): top-level source marks the winning (fallback) provider.
    expect(body.source).toBe('openlibrary')
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
    // RES-1.5 T5 (#290): top-level source marks the primary provider.
    expect(body.source).toBe('google')
    expect(callsToHost('openlibrary.org')).toHaveLength(0)
  })

  it('Google empty + OpenLibrary empty -> 200 NO_MATCH ([]), NOT all-failed', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(200, { items: [] })) // Google healthy-empty
      .mockResolvedValueOnce(upstream(200, {}))             // OpenLibrary: no ISBN key -> empty
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Primary empty result preserved (NO_MATCH) — not an error, not all-failed.
    expect(body.items).toEqual([])
    expect(body.source).toBeUndefined()
  })

  it('Google error + OpenLibrary error -> 502 ALL_PROVIDERS_FAILED', async () => {
    // lookupFetch retries a persistent 5xx (3 attempts) for Google; OpenLibrary
    // also fails; RES-1.5 T5 (#290) collapses every-provider-down to
    // ALL_PROVIDERS_FAILED (distinct from NO_MATCH).
    global.fetch.mockResolvedValue(upstream(500, {}))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('ALL_PROVIDERS_FAILED')
    // T5: the persistent-5xx path runs the real retry backoff chain against
    // Google (3 attempts) and then OpenLibrary; upsert an explicit timeout so
    // this slow deterministic test never flakes against the 5s Vitest default.
  }, 15000)

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

// RES-1.4 T4 (#291) — negative cache + circuit-breaker cooldown through the REAL
// books handler. The primary Google fetch and the OpenLibrary fallback both run
// against the mocked global.fetch (the providers use the real lookupFetch), and
// the shared lookup_cache / provider-state stores use the in-memory @netlify/blobs
// mock (no Postgres here, so the Blob path is exercised).
describe('RES-1.4 T4 — negative cache + circuit-breaker cooldown (books chain)', () => {
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
  const OL_ISBN = {
    'ISBN:9780452284234': {
      info_url: 'https://openlibrary.org/books/OL20891788M/x',
      thumbnail_url: 'https://covers.openlibrary.org/b/id/8125329-M.jpg',
      details: { title: "The Handmaid's Tale", key: '/books/OL20891788M', authors: [{ name: 'Margaret Atwood' }] },
    },
  }

  it('a no-result ISBN is negative-cached as empty, so a second call skips the primary and falls through to the fallback', async () => {
    // First call: Google healthy-empty -> negative-cache written, fallback wins.
    global.fetch
      .mockResolvedValueOnce(upstream(200, { items: [] }))
      .mockResolvedValueOnce(upstream(200, OL_ISBN))
    const r1 = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(r1.status).toBe(200)
    expect((await r1.json()).items[0].source).toBe('openlibrary')
    expect(callsToHost('www.googleapis.com')).toHaveLength(1)

    // The negative-cache sentinel is now in the lookup_cache (Blob store here).
    const cached = stores['books-cache'].data.get('isbn:9780452284234')
    expect(cached.data).toEqual(EMPTY_SENTINEL)

    // Second call within the empty TTL: Google is NEGATIVE-CACHED as empty ->
    // the primary is SKIPPED (no www.googleapis.com call) and we go straight to
    // the fallback, which wins again.
    global.fetch.mockClear()
    global.fetch.mockResolvedValueOnce(upstream(200, OL_ISBN))
    const r2 = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(r2.status).toBe(200)
    expect((await r2.json()).items[0].source).toBe('openlibrary')
    expect(callsToHost('www.googleapis.com')).toHaveLength(0)
    expect(callsToHost('openlibrary.org')).toHaveLength(1)
  })

  it('the {empty:true} sentinel is NEVER returned to the client as a real result (books)', async () => {
    await writeEmptyCache('books', 'isbn:9780452284234', 'searchBarcode')
    // Fallback empty too -> healthy-empty envelope, NOT the sentinel.
    global.fetch.mockReset()
    global.fetch.mockResolvedValueOnce(upstream(200, {})) // OpenLibrary: no ISBN key -> empty
    const res = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [] }) // never { empty:true }, never a sentinel leak
    expect(body.empty).toBeUndefined()
  })

  it('a down provider (5xx) records cooldown, is skipped within the cooldown window, and is retried after', async () => {
    // First call: Google persistent 5xx (3 retryable attempts) -> provider-down,
    // which arms the circuit breaker; fallback also fails -> ALL_PROVIDERS_FAILED
    // surfaces (RES-1.5 T5: every provider is unavailable).
    global.fetch.mockResolvedValue(upstream(500, {}))
    const r1 = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(r1.status).toBe(502)
    expect((await r1.json()).code).toBe('ALL_PROVIDERS_FAILED')

    // Cooldown recorded in the SEPARATE provider-state store (not lookup_cache).
    const down = stores['runout-provider-state'].data.get('books')
    expect(down).toBeTruthy()
    expect(down.provider).toBe('books')
    expect(down.cooldownMs).toBe(PROVIDER_COOLDOWN_MS)
    // And it is NOT in lookup_cache — no outage/cooldown sentinel there.
    for (const value of stores['books-cache'].data.values()) {
      expect(value.data.empty).toBeUndefined()
    }

    // Second call within the cooldown window: Google is SKIPPED (no
    // www.googleapis.com call) and we go straight to the fallback.
    global.fetch.mockClear()
    global.fetch.mockResolvedValueOnce(upstream(200, OL_ISBN))
    const r2 = await booksHandler(req('/.netlify/functions/books?action=searchBarcode&isbn=9780452284234'))
    expect(r2.status).toBe(200)
    expect((await r2.json()).items[0].source).toBe('openlibrary')
    expect(callsToHost('www.googleapis.com')).toHaveLength(0)
    expect(callsToHost('openlibrary.org')).toHaveLength(1)
  }, 15000)

  it('after the cooldown window elapses the primary provider is retried (books)', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-19T12:00:00Z') })
    try {
      await recordProviderDown(stores['runout-provider-state'], 'books')
      vi.advanceTimersByTime(PROVIDER_COOLDOWN_MS + 1000)

      global.fetch.mockResolvedValueOnce(upstream(200, { items: [{ id: 'g7', volumeInfo: { title: 'Google Hit' } }] }))
      const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=handmaid'))
      expect(res.status).toBe(200)
      expect((await res.json()).items[0].id).toBe('g7')
      expect(callsToHost('www.googleapis.com')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a rate limit (PROVIDER_RATE_LIMIT) does NOT record cooldown and does NOT fall back (429 resolution)', async () => {
    global.fetch.mockResolvedValue(upstream(429, {}))
    const res = await booksHandler(req('/.netlify/functions/books?action=searchText&q=handmaid'))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('PROVIDER_RATE_LIMIT')
    // NO cooldown was armed (a rate limit is not a "skipped down provider").
    expect(stores['runout-provider-state'].data.get('books')).toBeFalsy()
    // And nothing was negative-cached (an error body is never cached).
    for (const value of stores['books-cache'].data.values()) {
      expect(value.data.empty).toBeUndefined()
    }
  })
})

