// @vitest-environment node
//
// Tests for the @hourly lookup-queue drain function (T6, #285). Closes the
// #399 gate gap: exercises the REAL drain logic — providerLookupFor /
// runFixedLookup / normalizeHit / genreOf and a real non-mocked `handler()`
// happy-path — in addition to the schedule config and the service-only
// counter summary (queue/payload never echoed to a client).
//
// The only modules doubled are the two seams the function depends on:
//   - ./repository  -> getRepository() hands back an in-memory queue + items
//                      double (no Postgres / Blobs site context).
//   - ./lookup-fetch -> lookupFetch is configurable per-test via lookupFetchRef
//                      so the SSRF-safe fixed-host fetch is exercised against
//                      controlled responses (no real network).
// The SSRF fixed-host assertion is explicit: providerLookupFor may only fetch
// within FIXED_BASES for the queued provider, never an arbitrary host.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  config,
  handler,
  providerLookupFor,
  runFixedLookup,
  normalizeHit,
  genreOf,
  FIXED_BASES,
} from '../lookup-queue-drain'

// Configurable lookupFetch: each test sets lookupFetchRef.current to the
// response it wants (a Response-shaped object: { ok, status, json() }). The
// mocked lookupFetch always records the URL it was called with into fetchCalls,
// regardless of which response the test installs.
const { lookupFetchRef, fetchCalls } = vi.hoisted(() => ({
  lookupFetchRef: { current: async () => ({ ok: false, status: 503, json: async () => ({}) }) },
  fetchCalls: [],
}))
vi.mock('./lookup-fetch', () => ({
  lookupFetch: (url) => {
    fetchCalls.push(url)
    return lookupFetchRef.current(url)
  },
}))

// Mutable repository: getRepository() returns whatever repoRef.current holds.
const { repoRef } = vi.hoisted(() => ({ repoRef: { current: null } }))
vi.mock('./repository', () => ({ getRepository: () => repoRef.current }))

const OK = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  fetchCalls.length = 0
  repoRef.current = { lookupQueue: null, items: null }
})

// A minimal in-memory queue + items double for the real handler path.
function makeQueueDouble({ listPendingUsers = [], dueRows = [], rows = {} } = {}) {
  return {
    _rows: rows,
    async listPendingUsers() { return listPendingUsers },
    async claimDue() { return dueRows },
    async markDone(userId, id) { rows[id] = { ...(rows[id] || {}), status: 'done' } },
    async markFailed() {},
  }
}
function makeItemsDouble() {
  return {
    async mergeEnriched(ownerId, kind, id, additions) {
      return { ...additions, metadataPending: false, enrichedAt: new Date().toISOString() }
    },
  }
}

describe('providerLookupFor — real drain resolution logic', () => {
  it('rejects an UNKNOWN_PROVIDER as a permanent failure without fetching', async () => {
    const row = { payload: { provider: 'spotify', action: 'barcode', barcode: '123' } }
    const out = await providerLookupFor(row)
    expect(out).toEqual({ ok: false, permanent: true, error: 'UNKNOWN_PROVIDER' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('returns NO_RETRIGGER_KEY when the payload holds no reusable key', async () => {
    const row = { payload: { provider: 'discogs', action: 'manual' } }
    const out = await providerLookupFor(row)
    expect(out).toEqual({ ok: false, permanent: true, error: 'NO_RETRIGGER_KEY' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('maps a 4xx to a PERMANENT failure (never retried more than once)', async () => {
    lookupFetchRef.current = async () => ({ ok: false, status: 404, json: async () => ({}) })
    const row = { payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' } }
    const out = await providerLookupFor(row)
    expect(out).toEqual({ ok: false, permanent: true, error: 'HTTP_404' })
  })

  it('maps a 5xx to a NON-permanent (transient) failure so the row backs off', async () => {
    lookupFetchRef.current = async () => ({ ok: false, status: 503, json: async () => ({}) })
    const row = { payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' } }
    const out = await providerLookupFor(row)
    expect(out).toEqual({ ok: false, permanent: false, error: 'HTTP_503' })
  })

  it('maps an EMPTY result set to a permanent failure', async () => {
    lookupFetchRef.current = async () => OK({ results: [] })
    const row = { payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' } }
    const out = await providerLookupFor(row)
    expect(out).toEqual({ ok: false, permanent: true, error: 'EMPTY' })
  })

  it('resolves a successful Discogs hit and normalizes it', async () => {
    lookupFetchRef.current = async () => OK({ results: [{ title: 'A', year: 1984, genres: ['Rock'], cover_image: 'c' }] })
    const row = { payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' } }
    const out = await providerLookupFor(row)
    expect(out.ok).toBe(true)
    expect(out.data.title).toBe('A')
    expect(out.data.year).toBe(1984)
    expect(out.data.genre).toEqual(['Rock'])
    expect(out.data.coverImage).toBe('c')
  })

  it('SSRF fixed-host: only fetches the allow-listed base for the queued provider', async () => {
    lookupFetchRef.current = async () => OK({ results: [] })
    await providerLookupFor({ payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' } })
    await providerLookupFor({ payload: { provider: 'books', action: 'barcode', barcode: '9780140328721' } })
    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0].startsWith(FIXED_BASES.discogs)).toBe(true)
    expect(fetchCalls[1].startsWith(FIXED_BASES.books)).toBe(true)
    // No call may target any host outside the allow-list.
    for (const url of fetchCalls) {
      expect(Object.values(FIXED_BASES).some((base) => url.startsWith(base))).toBe(true)
    }
  })
})

describe('runFixedLookup — fetch + parse + empty mapping', () => {
  it('returns a permanent EMPTY on an empty body and null on a null result', async () => {
    lookupFetchRef.current = async () => OK({ results: null })
    expect(await runFixedLookup('https://api.discogs.com/database/search?q=x')).toEqual(
      { ok: false, permanent: true, error: 'EMPTY' },
    )
  })

  it('returns ok:true with the first result on a populated response', async () => {
    lookupFetchRef.current = async () => OK({ items: [{ title: 'GB', volumeInfo: { publishedDate: '2001' } }] })
    const out = await runFixedLookup('https://www.googleapis.com/books/v1/volumes?q=y')
    expect(out.ok).toBe(true)
    expect(out.data.title).toBe('GB')
    expect(out.data.year).toBe(2001)
  })

  it('coerces an upstream fetch throw to a non-permanent LOOKUP_ERROR', async () => {
    lookupFetchRef.current = async () => { throw new Error('boom') }
    const out = await runFixedLookup('https://api.discogs.com/database/search?q=x')
    expect(out).toEqual({ ok: false, error: 'LOOKUP_ERROR' })
  })
})

describe('normalizeHit / genreOf — defensive normalization', () => {
  it('genreOf returns genres array, single genre, or undefined', () => {
    expect(genreOf({ genres: ['Rock', 'Jazz'] })).toEqual(['Rock', 'Jazz'])
    expect(genreOf({ genre: 'Indie' })).toEqual(['Indie'])
    expect(genreOf({})).toBeUndefined()
  })

  it('normalizeHit maps both the Discogs and Google Books shapes', () => {
    const discogs = normalizeHit({ title: 'D', year: 1999, labels: [{ name: 'Lab' }], cover_image: 'ci', format: [{ name: 'LP' }] })
    expect(discogs).toMatchObject({ title: 'D', year: 1999, label: 'Lab', coverImage: 'ci', formatType: 'LP' })

    const gb = normalizeHit({ title: 'G', volumeInfo: { publishedDate: '2005-06-01' }, thumbnail: 't', major_formats: ['CD'] })
    expect(gb).toMatchObject({ title: 'G', year: 2005, coverImage: 't', formatType: 'CD' })
  })

  it('normalizeHit is sparse: unknown/absent fields are left undefined', () => {
    expect(normalizeHit({})).toEqual({
      title: undefined, year: undefined, label: undefined, genre: undefined,
      coverImage: undefined, formatType: undefined,
    })
  })
})

describe('lookup-queue-drain scheduled function', () => {
  it('declares the Netlify @hourly schedule', () => {
    expect(config.schedule).toBe('@hourly')
  })

  it('real handler happy-path: enriches a due row and returns a counter-only summary', async () => {
    const rows = { 'row-1': { status: 'pending', userId: 'u1' } }
    const dueRow = {
      id: 'row-1', kind: 'records', item_id: 'item-1', attempts: 0,
      payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' },
    }
    repoRef.current = {
      lookupQueue: makeQueueDouble({ listPendingUsers: ['u1'], dueRows: [dueRow], rows }),
      items: makeItemsDouble(),
    }
    lookupFetchRef.current = async () => OK({ results: [{ title: 'Found', year: 1984 }] })

    const res = await handler()
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.summary.processed).toBe(1)
    expect(res.body.summary.enriched).toBe(1)
    expect(res.body.summary.failed).toBe(0)
    expect(res.body.summary.abandoned).toBe(0)
    // Service-only: no queue rows, ids, keys or payloads in the body.
    expect(JSON.stringify(res.body)).not.toMatch(/row-1|item-1|barcode:|0123456789012/)
  })

  it('returns a service-only summary (queue never echoed to a client)', async () => {
    const res = await handler()
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.summary).toEqual({ processed: 0, enriched: 0, failed: 0, abandoned: 0 })
    expect(JSON.stringify(res.body)).not.toMatch(/item:|id|payload|queued/)
  })

  it('the handler never surfaces internals on failure (safeError integrity)', async () => {
    // A repo with no queue/items still yields a safe, counter-only response.
    repoRef.current = { lookupQueue: null, items: null }
    const res = await handler()
    expect([200, 500]).toContain(res.statusCode)
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|Error|stack|token|key|payload|item:/)
  })
})
