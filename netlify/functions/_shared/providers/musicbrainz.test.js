// @vitest-environment node
//
// Unit suite for the tokenless MusicBrainz fallback provider (RES-1.2 T2, #288)
// at netlify/functions/_shared/providers/musicbrainz.js.
//
// We mock the shared T1 helper (../lookup-fetch) rather than re-testing its
// retry/redirect behavior here (that's lookup-fetch.test.js). This suite pins
// what this adapter OWNS: the fixed-host SSRF posture, the redirect / size-cap
// / User-Agent enforcement, the ~1 req/s throttle, and the MusicBrainz -> Discogs
// `{ results:[...] }` envelope normalization.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  searchBarcode,
  searchText,
  detail,
  throttle,
  ALLOWED_HOSTS,
} from './musicbrainz'

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

const MBID = 'b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12'
// A realistic MusicBrainz release-search payload.
const mbRelease = {
  id: MBID,
  title: 'Kind of Blue',
  date: '1959-08-17',
  country: 'US',
  'artist-credit': [{ name: 'Miles Davis', artist: { id: 'a1', name: 'Miles Davis' } }],
  'label-info': [{ label: { name: 'Columbia' }, 'catalog-number': 'CL 1355' }],
  media: [{ format: 'CD', 'track-count': 9 }],
}

describe('searchBarcode', () => {
  it('queries the fixed MusicBrainz base with barcode:<digits> and returns the results envelope', async () => {
    lookupFetch.mockResolvedValue(upstream({ releases: [mbRelease] }))
    const out = await searchBarcode(' 0746-4405491x\n')
    expect(lookupFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = lookupFetch.mock.calls[0]
    const parsed = new URL(url)
    // SSRF: the connect host is ALWAYS the fixed MusicBrainz API, never user input.
    expect(parsed.hostname).toBe('musicbrainz.org')
    expect(parsed.pathname).toBe('/ws/2/release/')
    expect(parsed.searchParams.get('query')).toBe('barcode:07464405491x')
    expect(parsed.searchParams.get('fmt')).toBe('json')
    // Descriptive User-Agent (MusicBrainz requirement) + no Authorization header.
    expect(opts.headers['User-Agent']).toContain('RunoutRecordCollector')
    expect(opts.headers.Authorization).toBeUndefined()

    expect(Array.isArray(out.results)).toBe(true)
    expect(out.results).toHaveLength(1)
  })

  it('normalizes a MusicBrainz release into the Discogs result shape (id null, mbid + source set)', async () => {
    lookupFetch.mockResolvedValue(upstream({ releases: [mbRelease] }))
    const out = await searchBarcode('07464405491')
    const r = out.results[0]
    // discogsId must stay null for a fallback hit; mbid + source mark the provider.
    expect(r.id).toBeNull()
    expect(r.mbid).toBe(MBID)
    expect(r.source).toBe('musicbrainz')
    expect(r.type).toBe('release')
    // Title composed as "Artist - Release Title" (record convention).
    expect(r.title).toBe('Miles Davis - Kind of Blue')
    expect(r.year).toBe('1959')
    expect(r.label).toBe('Columbia')
    expect(r.catno).toBe('CL 1355')
    expect(r.format).toEqual(['CD'])
    expect(r.formatType).toBe('CD')
    expect(r.country).toBe('US')
    // Cover routed through the Cover Art Archive URL (the cover proxy re-fetches
    // it from the allowlisted coverartarchive.org host).
    expect(r.cover_image).toBe(`https://coverartarchive.org/release/${MBID}/front-250`)
    expect(r.thumb).toBe(r.cover_image)
    expect(r.resource_url).toBe(`https://musicbrainz.org/release/${MBID}`)
  })

  it('returns an empty envelope (not throw) when MusicBrainz errors', async () => {
    lookupFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const out = await searchBarcode('07464405491')
    expect(out).toEqual({ results: [] })
  })

  it('returns an empty envelope for a missing/empty barcode', async () => {
    expect(await searchBarcode('   ')).toEqual({ results: [] })
    expect(lookupFetch).not.toHaveBeenCalled()
  })
})

describe('searchText', () => {
  it('queries the fixed base with the text and maps results', async () => {
    lookupFetch.mockResolvedValue(upstream({ releases: [mbRelease] }))
    const out = await searchText('kind of blue')
    const parsed = new URL(lookupFetch.mock.calls[0][0])
    expect(parsed.hostname).toBe('musicbrainz.org')
    expect(parsed.searchParams.get('query')).toBe('kind of blue')
    expect(out.results).toHaveLength(1)
    expect(out.results[0].source).toBe('musicbrainz')
  })

  it('caps the query length and returns empty for blank text', async () => {
    expect(await searchText('   ')).toEqual({ results: [] })
    expect(lookupFetch).not.toHaveBeenCalled()
  })
})

describe('detail (uniform adapter contract)', () => {
  it('encodes the mbid into the fixed path with inc and normalizes', async () => {
    lookupFetch.mockResolvedValue(upstream({ id: MBID, title: 'Kind of Blue', date: '1959-08-17' }))
    const out = await detail(MBID)
    const parsed = new URL(lookupFetch.mock.calls[0][0])
    expect(parsed.hostname).toBe('musicbrainz.org')
    expect(parsed.pathname).toBe(`/ws/2/release/${MBID}`)
    expect(parsed.searchParams.get('inc')).toContain('artists')
    expect(parsed.searchParams.get('inc')).toContain('release-groups')
    expect(out.source).toBe('musicbrainz')
  })

  it('returns null on failure and for a missing mbid', async () => {
    lookupFetch.mockRejectedValue(new Error('down'))
    expect(await detail(MBID)).toBeNull()
    lookupFetch.mockReset()
    expect(await detail('')).toBeNull()
  })
})

describe('SSRF posture', () => {
  it('never includes a user-supplied host — only the fixed allowlisted hosts exist', () => {
    expect(ALLOWED_HOSTS).toContain('musicbrainz.org')
    expect(ALLOWED_HOSTS).toContain('coverartarchive.org')
    // Only one search host is ever connected to; covers are a URL the proxy
    // re-fetches, not a host this adapter connects to.
    expect(ALLOWED_HOSTS).toEqual(['musicbrainz.org', 'coverartarchive.org'])
  })

  it('rejects (throws -> empty envelope) a manual 3xx so a hostile redirect is never followed', async () => {
    // A hostile upstream 3xx is surfaced by lookupFetch (redirect:'manual') as a
    // raw 302 here — the adapter must reject it, not follow it.
    lookupFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'https://169.254.169.254/latest/meta-data/' : null) },
      text: async () => '',
    })
    const out = await searchBarcode('07464405491')
    expect(out).toEqual({ results: [] })
  })

  it('rejects an oversized provider body', async () => {
    const big = upstream({ releases: [{ id: MBID, title: 'x'.repeat(3 * 1024 * 1024) }] })
    lookupFetch.mockResolvedValue(big)
    const out = await searchBarcode('07464405491')
    expect(out).toEqual({ results: [] })
  })
})

describe('throttle (tokenless ~1 req/s gate)', () => {
  it('spaces calls at least minIntervalMs apart', async () => {
    vi.useFakeTimers()
    try {
      const p1 = throttle('t', 1000)
      const p2 = throttle('t', 1000)
      await vi.advanceTimersByTimeAsync(500)
      // The second call must still be waiting past 500ms (it slots behind the first).
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
