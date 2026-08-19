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
    // Use a NON-EMPTY Discogs result so the MusicBrainz fallback (RES-1.2 T2)
    // does not fire — this test is about the single primary lookup fetch's
    // redirect policy.
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ id: 1, title: 'A - B' }] }),
      headers: { get: () => 'application/json' },
    })
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
    // A network failure is a genuine service outage, so the MusicBrainz fallback
    // (RES-1.2 T2) also attempts and also fails; the PRIMARY's 502 HTTP_ERROR
    // is still what surfaces. The fallback's ~1 req/s throttle + retry backoff
    // make this slower than the pre-fallback path, so give it a larger timeout.
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=test'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('HTTP_ERROR')
  }, 15000)

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

describe('MusicBrainz fallback chain (RES-1.2 T2, #288)', () => {
  const MBID = 'b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12'
  // A realistic MusicBrainz release-search payload (what the fallback provider
  // consumes via its REAL lookupFetch -> global.fetch mock).
  const mbRelease = {
    id: MBID,
    title: 'Kind of Blue',
    date: '1959-08-17',
    country: 'US',
    'artist-credit': [{ name: 'Miles Davis', artist: { id: 'a1', name: 'Miles Davis' } }],
    'label-info': [{ label: { name: 'Columbia' }, 'catalog-number': 'CL 1355' }],
    media: [{ format: 'CD' }],
  }

  // Fallback only fires on a Discogs error OR healthy-empty. In these tests the
  // Discogs call and the MusicBrainz call both run against the mocked
  // global.fetch (the provider's real lookupFetch resolves against it), so we
  // queue Discogs-first then MusicBrainz.
  function upstream(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '1' : 'application/json') },
      text: async () => JSON.stringify(body),
    }
  }
  function mbUpstream(status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n) => (String(n).toLowerCase() === 'retry-after' ? '1' : 'application/json') },
      text: async () => JSON.stringify({ releases: [mbRelease] }),
    }
  }

  it('Discogs error -> MusicBrainz fallback fires and wins with source + mbid', async () => {
    // A 404 is a NON-retryable upstream service error: lookupFetch returns it on
    // the first attempt (no retry-loop noise), fetchDiscogs maps it to HTTP_ERROR
    // 502, and the fallback fires exactly one MusicBrainz call.
    global.fetch
      .mockResolvedValueOnce(upstream(404, {}))            // Discogs upstream error
      .mockResolvedValueOnce(mbUpstream(200))              // MusicBrainz
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=07464405491'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results).toHaveLength(1)
    const hit = body.results[0]
    expect(hit.source).toBe('musicbrainz')
    expect(hit.mbid).toBe(MBID)
    expect(hit.id).toBeNull() // discogsId stays null for a fallback hit
    // The first (Discogs) fetch was the primary; the second was the fallback host.
    const first = new URL(String(global.fetch.mock.calls[0][0]))
    expect(first.hostname).toBe('api.discogs.com')
    const second = new URL(String(global.fetch.mock.calls[1][0]))
    expect(second.hostname).toBe('musicbrainz.org')
  })

  it('Discogs healthy-empty -> MusicBrainz fallback fires and wins', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(200, { results: [] })) // Discogs healthy-empty
      .mockResolvedValueOnce(mbUpstream(200))                 // MusicBrainz
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results[0].source).toBe('musicbrainz')
    expect(body.results[0].mbid).toBe(MBID)
  })

  it('Discogs non-empty -> primary wins and the fallback never fires (no MB call)', async () => {
    // Only ONE network call: Discogs returns a non-empty result set.
    global.fetch.mockResolvedValueOnce(upstream(200, { results: [{ id: 101, title: 'Miles Davis - Kind of Blue' }] }))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=07464405491'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results[0].id).toBe(101)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const only = new URL(String(global.fetch.mock.calls[0][0]))
    expect(only.hostname).toBe('api.discogs.com') // MusicBrainz never contacted
  })

  it('Discogs error + MusicBrainz empty -> returns the ORIGINAL primary error', async () => {
    global.fetch
      .mockResolvedValueOnce(upstream(404, {}))            // Discogs upstream error (non-retryable)
      .mockResolvedValueOnce(upstream(200, { releases: [] })) // MusicBrainz healthy-empty
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=07464405491'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('HTTP_ERROR') // primary's original error code preserved
  })

  // Explicit regression pin for the NO_FALLBACK_CODES suppression behavior
  // ({BAD_TOKEN, SERVER_NO_TOKEN, PROVIDER_RATE_LIMIT, RATE_LIMIT}): a token /
  // config problem is an ops signal that must NOT be masked by quietly routing
  // every lookup to MusicBrainz, and a rate limit must not pile extra load onto
  // the fallback provider while Discogs is already throttled. In each case the
  // fallback never fires — MusicBrainz (musicbrainz.org) is never contacted.

  it('fallback does NOT fire on a Discogs 401 (BAD_TOKEN) — MusicBrainz never contacted', async () => {
    // A 401 is a non-retryable upstream status, so lookupFetch returns after a
    // SINGLE Discogs fetch — exactly once, and never on musicbrainz.org.
    global.fetch.mockResolvedValue(upstream(401, { message: 'invalid token' }))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('BAD_TOKEN')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const only = new URL(String(global.fetch.mock.calls[0][0]))
    expect(only.hostname).toBe('api.discogs.com') // MusicBrainz never contacted
  })

  it('fallback does NOT fire on a Discogs 429 (PROVIDER_RATE_LIMIT) — no MB load piled on', async () => {
    // 429 is RETRYABLE through the real lookupFetch helper, so the Discogs host
    // may legitimately be hit more than once. What we pin here is that NOT A
    // SINGLE call ever leaves for musicbrainz.org, and the server-side
    // PROVIDER_RATE_LIMIT code surfaces unchanged to the client.
    global.fetch.mockResolvedValue(upstream(429, { message: 'rate limited' }))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('PROVIDER_RATE_LIMIT')
    expect(global.fetch.mock.calls.length).toBeGreaterThan(0)
    for (const call of global.fetch.mock.calls) {
      expect(new URL(String(call[0])).hostname).toBe('api.discogs.com') // never musicbrainz.org
    }
  })

  it('fallback does NOT fire when the token is missing (SERVER_NO_TOKEN) — no fetch at all', async () => {
    // A missing token is a server misconfiguration (SERVER_NO_TOKEN in
    // NO_FALLBACK_CODES). It short-circuits before ANY network call, so neither
    // Discogs nor MusicBrainz is contacted and the fallback never fires.
    delete process.env.RUNOUT_DISCOGS_TOKEN
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('SERVER_NO_TOKEN')
    expect(global.fetch).not.toHaveBeenCalled() // neither Discogs nor MusicBrainz
  })
})

// RES-1.4 T4 (#291) — negative cache + circuit-breaker cooldown through the REAL
// discogs handler. The primary Discogs fetch and the MusicBrainz fallback both
// run against the mocked global.fetch (the providers use the real lookupFetch),
// and the shared lookup_cache / provider-state stores use the in-memory
// @netlify/blobs mock (no Postgres here, so the Blob path is exercised).
describe('RES-1.4 T4 — negative cache + circuit-breaker cooldown (discogs chain)', () => {
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
  const MBID = 'b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12'
  const mbRelease = {
    id: MBID, title: 'Kind of Blue', date: '1959-08-17', country: 'US',
    'artist-credit': [{ name: 'Miles Davis', artist: { id: 'a1', name: 'Miles Davis' } }],
    'label-info': [{ label: { name: 'Columbia' }, 'catalog-number': 'CL 1355' }],
    media: [{ format: 'CD' }],
  }
  function mbUpstream() {
    return upstream(200, { releases: [mbRelease] })
  }

  it('a no-result barcode is negative-cached as empty, so a second call reuses the negative cache, skips the primary, and falls through to the fallback', async () => {
    // First call: Discogs healthy-empty -> negative-cache written, fallback wins.
    global.fetch
      .mockResolvedValueOnce(upstream(200, { results: [] }))
      .mockResolvedValueOnce(mbUpstream())
    const r1 = await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=07464405491'))
    expect(r1.status).toBe(200)
    expect((await r1.json()).results[0].source).toBe('musicbrainz')
    // Only ONE Discogs call happened (the empty one was freshly fetched).
    expect(callsToHost('api.discogs.com')).toHaveLength(1)

    // The negative-cache sentinel is now in the lookup_cache (Blob store here).
    const cached = stores['discogs-cache'].data.get('barcode:07464405491')
    expect(cached.data).toEqual(EMPTY_SENTINEL)

    // Second call: within the empty TTL, Discogs is NEGATIVE-CACHED as empty ->
    // the primary is SKIPPED (no api.discogs.com call) and we go straight to
    // the fallback, which wins again.
    global.fetch.mockClear()
    global.fetch.mockResolvedValueOnce(mbUpstream())
    const r2 = await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=07464405491'))
    expect(r2.status).toBe(200)
    expect((await r2.json()).results[0].source).toBe('musicbrainz')
    // Discogs was NEVER hit on the second call — only MusicBrainz.
    expect(callsToHost('api.discogs.com')).toHaveLength(0)
    expect(callsToHost('musicbrainz.org')).toHaveLength(1)
  })

  it('the {empty:true} sentinel is NEVER returned to the client as a real result', async () => {
    // Pre-seed the negative-cache sentinel directly.
    await writeEmptyCache('discogs', 'barcode:07464405491', 'searchBarcode')
    // Fallback is empty too -> the chain returns a healthy-empty envelope, NOT
    // the sentinel payload.
    global.fetch.mockReset()
    global.fetch.mockResolvedValueOnce(upstream(200, { releases: [] })) // MusicBrainz empty
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchBarcode&barcode=07464405491'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ results: [] }) // never { empty:true }, never a sentinel leak
    expect(body.empty).toBeUndefined()
  })

  it('a down provider (5xx) records cooldown, is skipped within the cooldown window, and is retried after', async () => {
    // First call: Discogs persistent 5xx (3 retryable attempts) -> HTTP_ERROR,
    // which arms the circuit breaker; fallback also fails -> HTTP_ERROR surfaces.
    global.fetch.mockResolvedValue(upstream(500, {}))
    const r1 = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(r1.status).toBe(502)
    expect((await r1.json()).code).toBe('HTTP_ERROR')

    // Cooldown recorded in the SEPARATE provider-state store (not lookup_cache).
    const down = stores['runout-provider-state'].data.get('discogs')
    expect(down).toBeTruthy()
    expect(down.provider).toBe('discogs')
    expect(down.cooldownMs).toBe(PROVIDER_COOLDOWN_MS)
    // And it is NOT in lookup_cache — no outage/cooldown sentinel there.
    for (const [key, value] of stores['discogs-cache'].data.entries()) {
      expect(value.data).not.toEqual(EMPTY_SENTINEL)
      expect(value.data.empty).toBeUndefined()
    }

    // Second call within the cooldown window: Discogs is SKIPPED (no
    // api.discogs.com call at all) and we go straight to the fallback.
    global.fetch.mockClear()
    global.fetch.mockResolvedValueOnce(mbUpstream())
    const r2 = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(r2.status).toBe(200)
    expect((await r2.json()).results[0].source).toBe('musicbrainz')
    expect(callsToHost('api.discogs.com')).toHaveLength(0)
    expect(callsToHost('musicbrainz.org')).toHaveLength(1)
  }, 15000)

  it('after the cooldown window elapses the primary provider is retried', async () => {
    // Fake timers let us elapse the ~60s cooldown deterministically, then we
    // restore real timers (the lookup-fetch path sleeps in real time).
    vi.useFakeTimers({ now: new Date('2026-08-19T12:00:00Z') })
    try {
      // Seed a cooldown, then elapse the window.
      await recordProviderDown(stores['runout-provider-state'], 'discogs')
      vi.advanceTimersByTime(PROVIDER_COOLDOWN_MS + 1000)

      // Provider recovered -> a normal primary hit succeeds.
      global.fetch.mockResolvedValueOnce(upstream(200, { results: [{ id: 7, title: 'Miles Davis - Kind of Blue' }] }))
      const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
      expect(res.status).toBe(200)
      expect((await res.json()).results[0].id).toBe(7)
      // api.discogs.com WAS hit again after cooldown.
      expect(callsToHost('api.discogs.com')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a network failure records cooldown (genuine provider-down) and skips the primary within the window', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const r1 = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(r1.status).toBe(502)
    expect((await r1.json()).code).toBe('HTTP_ERROR')
    expect(stores['runout-provider-state'].data.get('discogs')).toBeTruthy()

    // Within the window: Discogs skipped, MusicBrainz fallback consulted.
    global.fetch.mockClear()
    global.fetch.mockResolvedValueOnce(mbUpstream())
    const r2 = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(r2.status).toBe(200)
    expect(callsToHost('api.discogs.com')).toHaveLength(0)
    expect(callsToHost('musicbrainz.org')).toHaveLength(1)
  }, 15000)

  it('a rate limit (PROVIDER_RATE_LIMIT) does NOT record cooldown and does NOT fall back (429 resolution)', async () => {
    global.fetch.mockResolvedValue(upstream(429, {}))
    const res = await discogsHandler(req('/.netlify/functions/discogs?action=searchText&q=kind of blue'))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('PROVIDER_RATE_LIMIT')
    // NO cooldown was armed (a rate limit is not a "skipped down provider").
    expect(stores['runout-provider-state'].data.get('discogs')).toBeFalsy()
    // And nothing was negative-cached (an error body is never cached).
    for (const value of stores['discogs-cache'].data.values()) {
      expect(value.data.empty).toBeUndefined()
    }
  })
})
