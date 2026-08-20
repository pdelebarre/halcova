// @vitest-environment node
//
// Contract suite for the common Metadata Provider Adapter layer (#317).
// Pins the acceptance criteria:
//   * common adapter contract supports search/detail/identifier lookup where
//     relevant;
//   * provider-specific DTOs NEVER leak into domain entities;
//   * provider IDs remain additive and preserved;
//   * responses are schema-validated and size-limited BEFORE normalization;
//   * provider outage/empty-result behaviour is deterministic;
//   * contract tests cover success, empty, malformed and failure.
import { describe, expect, it } from 'vitest'
import {
  createProviderAdapter,
  OUTCOME,
  ProviderAdapterError,
} from './adapter-contract'
import {
  guardProviderPayload,
  PAYLOAD_ERROR,
  isAllowedProviderUrl,
} from './payload-guard'
import {
  normalizeRecordsHit,
  normalizeBooksHit,
} from './normalize'
import {
  discogsAdapter,
  musicbrainzAdapter,
  googleBooksAdapter,
  openlibraryAdapter,
  PROVIDER_ADAPTERS,
  getProviderAdapter,
  adaptersForCatalog,
  PROVIDER_ALLOWED_HOSTS,
} from './adapters'

// ---------------------------------------------------------------------------
// 1. Common adapter contract
// ---------------------------------------------------------------------------
describe('common adapter contract', () => {
  it('exposes the four catalogue providers behind one frozen surface', () => {
    for (const name of ['discogs', 'musicbrainz', 'googleBooks', 'openlibrary']) {
      const a = getProviderAdapter(name)
      expect(a).toBeTruthy()
      expect(a.name).toBe(name)
      expect(a.catalog).toBe(a.catalog === 'records' ? 'records' : 'books')
      expect(Object.isFrozen(a)).toBe(true)
      expect(typeof a.normalize).toBe('function')
      expect(typeof a.normalizeMany).toBe('function')
      expect(Array.isArray(a.allowedHosts)).toBe(true)
    }
    expect(Object.keys(PROVIDER_ADAPTERS)).toEqual([
      'discogs', 'musicbrainz', 'googleBooks', 'openlibrary',
    ])
  })

  it('resolves ordered catalog adapters primary -> fallback (ADR-0017)', () => {
    expect(adaptersForCatalog('records').map((a) => a.name)).toEqual(['discogs', 'musicbrainz'])
    expect(adaptersForCatalog('books').map((a) => a.name)).toEqual(['googleBooks', 'openlibrary'])
    expect(adaptersForCatalog('nope')).toEqual([])
    expect(getProviderAdapter('nope')).toBeUndefined()
  })

  it('throws ProviderAdapterError for contract misuse', () => {
    expect(() => createProviderAdapter({ name: 'x' })).toThrow(ProviderAdapterError)
    expect(() => createProviderAdapter({ name: 'x', catalog: 'records' })).toThrow(ProviderAdapterError)
    expect(() => createProviderAdapter({ name: 'x', catalog: 'coins', normalizer: () => null }))
      .toThrow(/catalog/)
  })

  it('normalizes through the pure normalizer and never emits provider fields', () => {
    const hit = discogsAdapter.normalize({
      id: 123,
      title: 'Miles Davis - Kind of Blue',
      year: '1959',
      genre: ['Jazz', 'Modal'],
      cover_image: 'https://api.discogs.com/image/x.jpg',
      resource_url: 'https://api.discogs.com/releases/123',
      // provider-only junk that must never leak:
      barcode: ['724349000000'],
      extraRawField: 'leak me',
    })
    expect(hit.provider_ids).toEqual({ discogsId: 123 })
    expect(hit.canonical_attributes.title).toBe('Miles Davis - Kind of Blue')
    expect(hit.canonical_attributes.year).toBe(1959)
    expect(hit.canonical_attributes.genre).toEqual(['Jazz', 'Modal'])
    expect(hit.media.coverImage).toBe('https://api.discogs.com/image/x.jpg')
    expect(hit.source).toBe('discogs')
    // No provider-only field may reach the normalized DTO.
    expect(hit).not.toHaveProperty('barcode')
    expect(hit).not.toHaveProperty('extraRawField')
  })
})

// ---------------------------------------------------------------------------
// 2. Provider IDs remain additive and preserved
// ---------------------------------------------------------------------------
describe('provider IDs are additive and preserved', () => {
  it('records primary hit keeps discogsId and omits mbid', () => {
    const hit = discogsAdapter.normalize({ id: 42, source: 'discogs' })
    expect(hit.provider_ids).toEqual({ discogsId: 42 })
    expect(hit.provider_ids.mbid).toBeUndefined()
  })

  it('records fallback hit keeps mbid and discogsId stays absent (not invented)', () => {
    const hit = musicbrainzAdapter.normalize({ id: null, mbid: 'mbid-abc', source: 'musicbrainz' })
    expect(hit.provider_ids).toEqual({ mbid: 'mbid-abc' })
    expect(hit.provider_ids.discogsId).toBeUndefined()
  })

  it('books primary hit keeps googleBooksId + isbn; openLibraryId absent', () => {
    const hit = googleBooksAdapter.normalize({
      id: 'vol1',
      source: 'googleBooks',
      volumeInfo: { title: 'T', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780000000001' }] },
    })
    expect(hit.provider_ids.googleBooksId).toBe('vol1')
    expect(hit.provider_ids.isbn).toBe('9780000000001')
    expect(hit.provider_ids.openLibraryId).toBeUndefined()
  })

  it('books fallback hit keeps openLibraryId; googleBooksId absent', () => {
    const hit = openlibraryAdapter.normalize({ id: null, openLibraryId: 'OL1W', source: 'openlibrary', volumeInfo: { title: 'T' } })
    expect(hit.provider_ids.openLibraryId).toBe('OL1W')
    expect(hit.provider_ids.googleBooksId).toBeUndefined()
  })

  it('provider IDs are never authoritative for ownership — they are data only', () => {
    const hit = discogsAdapter.normalize({ id: 1, title: 'T' })
    expect(hit.provider_ids).toEqual({ discogsId: 1 })
    // No ownership/tenant field may ever be produced by an adapter.
    expect(hit).not.toHaveProperty('ownerId')
    expect(hit).not.toHaveProperty('userId')
    expect(hit).not.toHaveProperty('role')
  })
})

// ---------------------------------------------------------------------------
// 3. Schema-validated + size-limited BEFORE normalization (payload-guard)
// ---------------------------------------------------------------------------
describe('payload-guard validates + size-limits before normalization', () => {
  it('accepts a healthy records envelope', () => {
    const r = guardProviderPayload({ results: [{ id: 1 }] }, { envelopeKey: 'results' })
    expect(r.error).toBeUndefined()
    expect(r.value).toEqual([{ id: 1 }])
  })

  it('accepts a healthy books envelope', () => {
    const r = guardProviderPayload({ items: [{ id: 'x' }] }, { envelopeKey: 'items' })
    expect(r.value).toHaveLength(1)
  })

  it('accepts a healthy-empty envelope as NO_MATCH (not a failure)', () => {
    const r = guardProviderPayload({ results: [] }, { envelopeKey: 'results' })
    expect(r.value).toEqual([])
  })

  it('rejects a payload over the size cap', () => {
    const big = { results: [{ title: 'x'.repeat(3 * 1024 * 1024) }] }
    const r = guardProviderPayload(JSON.stringify(big), { envelopeKey: 'results', maxBytes: 2 * 1024 * 1024 })
    expect(r.error.code).toBe(PAYLOAD_ERROR.TOO_LARGE)
  })

  it('rejects invalid JSON', () => {
    expect(guardProviderPayload('{oops', { envelopeKey: 'results' }).error.code).toBe(PAYLOAD_ERROR.INVALID_JSON)
  })

  it('rejects a missing/incorrect envelope key (malformed)', () => {
    const r = guardProviderPayload({ results: 'not-an-array' }, { envelopeKey: 'results' })
    expect(r.error.code).toBe(PAYLOAD_ERROR.BAD_ENVELOPE)
    const r2 = guardProviderPayload({}, { envelopeKey: 'items' })
    expect(r2.error.code).toBe(PAYLOAD_ERROR.BAD_ENVELOPE)
  })

  it('rejects a non-object payload', () => {
    expect(guardProviderPayload('[]', { envelopeKey: 'results' }).error.code).toBe(PAYLOAD_ERROR.BAD_ENVELOPE)
  })

  it('rejects an off-allowlist URL (SSRF posture) in a hit', () => {
    const r = guardProviderPayload(
      { results: [{ id: 1, cover_image: 'https://evil.example.com/x' }] },
      { envelopeKey: 'results', allowedHosts: ['api.discogs.com'] },
    )
    expect(r.error.code).toBe(PAYLOAD_ERROR.BAD_HOST)
  })

  it('rejects an off-allowlist URL in a detail object', () => {
    const r = guardProviderPayload(
      { title: 'T', resource_url: 'http://169.254.169.254/meta' },
      { allowedHosts: ['musicbrainz.org'] },
    )
    expect(r.error.code).toBe(PAYLOAD_ERROR.BAD_HOST)
  })

  it('allows a non-URL string and an empty URL (no fetch target)', () => {
    expect(isAllowedProviderUrl('', ['api.discogs.com'])).toBe(true)
    expect(isAllowedProviderUrl('just a label', ['api.discogs.com'])).toBe(true)
    expect(isAllowedProviderUrl('https://api.discogs.com/x', ['api.discogs.com'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. XSS-safe canonical fields
// ---------------------------------------------------------------------------
describe('normalization is XSS-safe for rendered canonical fields', () => {
  it('drops a script tag from a canonical title', () => {
    const hit = normalizeRecordsHit({ id: 1, title: 'Good <script>alert(1)</script>', source: 'discogs' })
    expect(hit.canonical_attributes.title).toBeUndefined()
  })

  it('drops a javascript: URI and event-handler from canonical strings', () => {
    const hit = normalizeBooksHit({ id: 'x', source: 'googleBooks', volumeInfo: { title: 'javascript:alert(1)' } })
    expect(hit.canonical_attributes.title).toBeUndefined()
    const hit2 = normalizeRecordsHit({ id: 1, title: 'x <img src=x onerror=alert(1)>', source: 'discogs' })
    expect(hit2.canonical_attributes.title).toBeUndefined()
  })

  it('drops unsafe genre entries and caps array length', () => {
    const evil = '<svg/onload=alert(1)>'
    const hit = normalizeRecordsHit({ id: 1, title: 'T', genre: ['Jazz', evil, '<script>x</script>', 'Rock'], source: 'discogs' })
    expect(hit.canonical_attributes.genre).toEqual(['Jazz', 'Rock'])
  })

  it('only emits https media URLs', () => {
    const hit = normalizeRecordsHit({ id: 1, title: 'T', cover_image: 'http://api.discogs.com/x.jpg', source: 'discogs' })
    expect(hit.media.coverImage).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 5. Deterministic outage/empty/failure behaviour
// ---------------------------------------------------------------------------
describe('deterministic outcome behaviour', () => {
  it('returns NO_MATCH for a healthy-empty result set', () => {
    expect(googleBooksAdapter.normalizeMany([])).toEqual({ outcome: OUTCOME.NO_MATCH, hits: [] })
    expect(discogsAdapter.normalizeMany(null)).toEqual({ outcome: OUTCOME.NO_MATCH, hits: [] })
  })

  it('returns OK with normalized hits for a healthy result set', () => {
    const r = googleBooksAdapter.normalizeMany([{ id: 'v1', source: 'googleBooks', volumeInfo: { title: 'T' } }])
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].source).toBe('googleBooks')
  })

  it('drops object rows with nothing usable instead of leaking them', () => {
    const r = discogsAdapter.normalizeMany([
      { id: 1, title: 'Good', source: 'discogs' },
      { title: '', source: 'discogs' }, // empty canonical, no id -> dropped
      { source: 'discogs' }, // no id, no canonical content -> dropped
    ])
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].provider_ids.discogsId).toBe(1)
  })

  it('fails closed on a malformed (non-object) row instead of dropping it', () => {
    for (const bad of ['not-an-object', null, 42]) {
      const r = discogsAdapter.normalizeMany([{ id: 1, title: 'Good', source: 'discogs' }, bad])
      expect(r.outcome).toBe(OUTCOME.FAILED)
      expect(r.hits).toEqual([])
    }
  })

  it('a failing async method resolves to FAILED (never throws to the caller)', async () => {
    const failing = createProviderAdapter({
      name: 'test',
      catalog: 'records',
      allowedHosts: [],
      normalizer: normalizeRecordsHit,
      searchBarcode: async () => { throw new Error('provider down') },
    })
    const r = await failing.searchBarcode('x')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })

  it('an empty async method resolves to NO_MATCH', async () => {
    const empty = createProviderAdapter({
      name: 'test2',
      catalog: 'books',
      allowedHosts: [],
      normalizer: normalizeBooksHit,
      searchText: async () => [],
    })
    const r = await empty.searchText('q')
    expect(r).toEqual({ outcome: OUTCOME.NO_MATCH, hits: [] })
  })

  it('an async method returning a single raw object (detail) resolves to OK', async () => {
    const detailAdapter = createProviderAdapter({
      name: 'test3',
      catalog: 'records',
      allowedHosts: [],
      normalizer: normalizeRecordsHit,
      detail: async () => ({ id: 7, title: 'Detail', source: 'discogs' }),
    })
    const r = await detailAdapter.detail('7')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.discogsId).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// 6. Provider-specific DTOs never leak into domain entities
// ---------------------------------------------------------------------------
describe('provider DTOs never leak into domain entities', () => {
  it('normalized hits carry only provider_ids / canonical_attributes / media / source', () => {
    const samples = [
      discogsAdapter.normalize({ id: 1, title: 'T', genre: ['Jazz'], community: { rating: 4.2 }, resource_url: 'https://api.discogs.com/r/1', source: 'discogs' }),
      normalizeBooksHit({ id: 'x', source: 'googleBooks', volumeInfo: { title: 'T', searchInfo: { textSnippet: 'snippet' } }, selfLink: 'https://www.googleapis.com/books/v1/volumes/x' }),
    ]
    for (const h of samples) {
      expect(Object.keys(h).sort()).toEqual(['canonical_attributes', 'media', 'provider_ids', 'source'])
      // Provider-only keys (community, searchInfo) are never present.
      expect(h.canonical_attributes).not.toHaveProperty('community')
      expect(h.canonical_attributes).not.toHaveProperty('searchInfo')
    }
  })

  it('registered adapters all conform to the allowed-host SSRF posture', () => {
    // API hosts + real image/cover hosts so the guard does not false-FAIL on
    // legitimate cover URLs (SEC HOLD #317).
    expect(PROVIDER_ALLOWED_HOSTS.discogs).toEqual(['api.discogs.com', 'i.discogs.com'])
    expect(PROVIDER_ALLOWED_HOSTS.musicbrainz).toEqual(['musicbrainz.org', 'coverartarchive.org'])
    expect(PROVIDER_ALLOWED_HOSTS.googleBooks).toEqual(['www.googleapis.com', 'books.google.com'])
    expect(PROVIDER_ALLOWED_HOSTS.openlibrary).toEqual(['openlibrary.org', 'covers.openlibrary.org'])
  })
})

// ---------------------------------------------------------------------------
// 7. Mandatory guard on the SHIPPED adapter path (SEC HOLD #317)
// ---------------------------------------------------------------------------
// The registered adapters register a normalizer only (no fetchEnvelope). The
// guard must therefore run inside the adapter boundary — normalizeMany /
// normalize / search / detail — so schema+size+host enforcement happens on the
// path #316 actually invokes, not on an unused fetchEnvelope.
describe('mandatory guard on the registered-adapter path (SEC HOLD #317)', () => {
  it('oversized payload FAILS closed on normalizeMany (2MiB cap, not ok)', () => {
    const r = discogsAdapter.normalizeMany([
      { id: 1, title: 'x'.repeat(3 * 1024 * 1024), source: 'discogs' },
    ])
    expect(r.outcome).toBe(OUTCOME.FAILED)
    expect(r.hits).toEqual([])
  })

  it('off-allowlist cover host FAILS closed on normalizeMany (not ok)', () => {
    const r = discogsAdapter.normalizeMany([
      { id: 1, title: 'T', cover_image: 'https://evil.example.com/x.jpg', source: 'discogs' },
    ])
    expect(r.outcome).toBe(OUTCOME.FAILED)
    expect(r.hits).toEqual([])
  })

  it('host allowlist is enforced in normalize media handling (not just https)', () => {
    // Allowlisted image host passes the row guard and is emitted.
    const ok = discogsAdapter.normalize({ id: 1, title: 'T', cover_image: 'https://i.discogs.com/cover.jpg', source: 'discogs' })
    expect(ok.media.coverImage).toBe('https://i.discogs.com/cover.jpg')
    // Off-allowlist host fails closed at the row guard -> whole hit is null.
    const evil = discogsAdapter.normalize({ id: 1, title: 'T', cover_image: 'https://evil.example.com/x.jpg', source: 'discogs' })
    expect(evil).toBeNull()
    // Defense-in-depth: safeUrl also drops an off-allowlist cover even when a
    // normalizer is called directly with an allowlist (hit kept, cover dropped).
    const direct = normalizeRecordsHit(
      { id: 1, title: 'T', cover_image: 'https://evil.example.com/x.jpg', source: 'discogs' },
      ['api.discogs.com', 'i.discogs.com'],
    )
    expect(direct.media.coverImage).toBeUndefined()
  })

  it('rejects an object-valued provider id (scalar guard); keeps scalar ids', () => {
    const hit = discogsAdapter.normalize({ id: { deep: 1 }, title: 'T', source: 'discogs' })
    expect(hit.provider_ids.discogsId).toBeUndefined()
    expect(hit.provider_ids).toEqual({})
    const ok = discogsAdapter.normalize({ id: 123, title: 'T', source: 'discogs' })
    expect(ok.provider_ids.discogsId).toBe(123)
  })

  it('malformed single-hit normalize fails closed to null', () => {
    expect(discogsAdapter.normalize('not-an-object')).toBeNull()
    expect(discogsAdapter.normalize(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 8. fetchEnvelope / guardedFetch path runs payload-guard (SEC HOLD #317)
// ---------------------------------------------------------------------------
describe('guardedFetch envelope path runs payload-guard (SEC HOLD #317)', () => {
  // envelopeKeys index maps to searchBarcode(0)/searchText(1)/detail(2); this
  // adapter only exercises searchText, so the envelope key sits at index 1.
  const mk = (envelope) => createProviderAdapter({
    name: 'testEnv',
    catalog: 'books',
    allowedHosts: ['www.googleapis.com', 'books.google.com'],
    normalizer: normalizeBooksHit,
    fetchEnvelope: async () => envelope,
    envelopeKeys: [undefined, 'items'],
    searchText: () => Promise.resolve(null),
  })

  it('a healthy envelope normalizes to OK', async () => {
    const a = mk({ items: [{ id: 'v1', source: 'googleBooks', volumeInfo: { title: 'T' } }] })
    const r = await a.searchText('q')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.googleBooksId).toBe('v1')
  })

  it('an off-allowlist host in the envelope FAILS closed', async () => {
    const a = mk({ items: [{ id: 'v1', source: 'googleBooks', volumeInfo: { imageLinks: { thumbnail: 'https://evil.example.com/x.jpg' } } }] })
    const r = await a.searchText('q')
    expect(r.outcome).toBe(OUTCOME.FAILED)
    expect(r.hits).toEqual([])
  })

  it('an oversized envelope FAILS closed (size cap applied)', async () => {
    const a = mk({ items: [{ id: 'v1', source: 'googleBooks', volumeInfo: { title: 'x'.repeat(3 * 1024 * 1024) } }] })
    const r = await a.searchText('q')
    expect(r.outcome).toBe(OUTCOME.FAILED)
  })

  it('a malformed envelope FAILS closed (missing key)', async () => {
    const a = mk({ nope: [] })
    const r = await a.searchText('q')
    expect(r.outcome).toBe(OUTCOME.FAILED)
  })
})

// ---------------------------------------------------------------------------
// 9. outcomeFor + the full async method surface (Tester FAIL #317)
// ---------------------------------------------------------------------------
// The Tester gate flagged FUNCTION coverage on adapter-contract.js: outcomeFor,
// lookupByIdentifier, the detail/searchBarcode variants and the `.catch(() =>
// toOutcome(FAILED))` fail-closed paths were uncovered. These are shipped
// public contract surface on a security-relevant file, so each is pinned here.
describe('outcomeFor maps a row set to a deterministic outcome', () => {
  it('returns OK for a non-empty row set and NO_MATCH for empty/null', () => {
    expect(discogsAdapter.outcomeFor([{ id: 1 }])).toBe(OUTCOME.OK)
    expect(discogsAdapter.outcomeFor([])).toBe(OUTCOME.NO_MATCH)
    expect(discogsAdapter.outcomeFor(null)).toBe(OUTCOME.NO_MATCH)
  })
})

// The registered-adapter shape #316 uses (normalizer only, NO fetchEnvelope):
// every async method runs through the direct `.then(handle).catch(FAILED)`
// path. Pin success AND fail-closed (.catch) for each method.
describe('registered-adapter async surface (no fetchEnvelope)', () => {
  const mkDirect = (overrides = {}) => createProviderAdapter({
    name: 'direct',
    catalog: 'records',
    allowedHosts: [],
    normalizer: normalizeRecordsHit,
    searchBarcode: async () => [{ id: 1, title: 'T', source: 'discogs' }],
    searchText: async () => [{ id: 2, title: 'T2', source: 'discogs' }],
    detail: async () => ({ id: 3, title: 'T3', source: 'discogs' }),
    lookupByIdentifier: async () => [{ id: 4, title: 'T4', source: 'discogs' }],
    ...overrides,
  })

  it('searchBarcode resolves OK on a healthy hit', async () => {
    const r = await mkDirect().searchBarcode('123')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.discogsId).toBe(1)
  })

  it('searchBarcode fails closed to FAILED when the provider rejects', async () => {
    const a = mkDirect({ searchBarcode: async () => { throw new Error('down') } })
    const r = await a.searchBarcode('123')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })

  it('searchText fails closed to FAILED when the provider rejects', async () => {
    const a = mkDirect({ searchText: async () => { throw new Error('down') } })
    const r = await a.searchText('q')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })

  it('detail resolves OK on a healthy single hit', async () => {
    const r = await mkDirect().detail('3')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.discogsId).toBe(3)
  })

  it('detail fails closed to FAILED when the provider rejects', async () => {
    const a = mkDirect({ detail: async () => { throw new Error('down') } })
    const r = await a.detail('3')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })

  it('lookupByIdentifier resolves OK on a healthy hit', async () => {
    const r = await mkDirect().lookupByIdentifier('mbid-x')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.discogsId).toBe(4)
  })

  it('lookupByIdentifier fails closed to FAILED when the provider rejects', async () => {
    const a = mkDirect({ lookupByIdentifier: async () => { throw new Error('down') } })
    const r = await a.lookupByIdentifier('mbid-x')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })
})

// The fetchEnvelope variants (defense-in-depth) also carry the same
// `.catch(() => toOutcome(FAILED))` fail-closed surface; pin success + reject.
describe('fetchEnvelope async surface (defense-in-depth)', () => {
  const mkEnv = (overrides = {}) => createProviderAdapter({
    name: 'env',
    catalog: 'records',
    allowedHosts: [],
    normalizer: normalizeRecordsHit,
    fetchEnvelope: async () => ({ results: [{ id: 1, title: 'T', source: 'discogs' }] }),
    envelopeKeys: ['results', 'results', 'results'],
    searchBarcode: () => Promise.resolve(null),
    searchText: () => Promise.resolve(null),
    detail: () => Promise.resolve(null),
    ...overrides,
  })

  it('searchBarcode via fetchEnvelope resolves OK', async () => {
    const r = await mkEnv().searchBarcode('123')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.discogsId).toBe(1)
  })

  it('searchBarcode via fetchEnvelope fails closed when fetchEnvelope rejects', async () => {
    const a = mkEnv({ fetchEnvelope: async () => { throw new Error('down') } })
    const r = await a.searchBarcode('123')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })

  it('searchText via fetchEnvelope fails closed when fetchEnvelope rejects', async () => {
    const a = mkEnv({ fetchEnvelope: async () => { throw new Error('down') } })
    const r = await a.searchText('q')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })

  it('detail via fetchEnvelope resolves OK', async () => {
    const r = await mkEnv().detail('3')
    expect(r.outcome).toBe(OUTCOME.OK)
    expect(r.hits[0].provider_ids.discogsId).toBe(1)
  })

  it('detail via fetchEnvelope fails closed when fetchEnvelope rejects', async () => {
    const a = mkEnv({ fetchEnvelope: async () => { throw new Error('down') } })
    const r = await a.detail('3')
    expect(r).toEqual({ outcome: OUTCOME.FAILED, hits: [] })
  })
})
