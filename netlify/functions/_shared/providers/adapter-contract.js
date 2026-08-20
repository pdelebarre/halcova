// adapter-contract.js — FEAT-6.4 #317: the common Metadata Provider Adapter
// contract (ADR-0020 §4/§15, ADR-0013, ADR-0017).
//
// This module decouples collection-domain code from provider payloads. Every
// provider integration (Discogs, MusicBrainz, Google Books, OpenLibrary)
// exposes a UNIFORM surface through `createProviderAdapter`, and every adapter
// returns NORMALIZED DTOs (`provider_ids` map + `canonical_attributes` +
// `media` + `source`) — never raw provider JSON. Provider-specific DTOs can
// never leak into domain entities because the normalized shape is the ONLY
// shape an adapter emits (ADR-0020 §4, §15 #317).
//
// Contract guarantees (pinned by adapter-contract.test.js):
//   * search / detail / identifier lookup methods, where relevant.
//   * provider IDs remain ADDITIVE and PRESERVED in `provider_ids` (never
//     dropped, never authoritative for ownership — ADR-0020 §4/#317 control).
//   * responses are schema-validated and size-limited BEFORE normalization
//     (payload-guard.js) — a malformed/oversized/hostile payload fails closed
//     to a deterministic FAILED outcome, never reaching normalization.
//   * provider outage vs empty-result behaviour is DETERMINISTIC:
//       - OK       -> healthy non-empty normalized hits
//       - NO_MATCH -> healthy-empty (200 + zero results)
//       - FAILED   -> provider error / malformed / oversized / outage
//   * this layer is transport-agnostic and pure where possible; the existing
//     #281 retry/fallback/cache proxies (netlify/functions/discogs.js,
//     books.js) and their SSRF-safe fetch are untouched by design — this
//     contract normalizes the envelope they already emit, so lookup
//     resilience is not regressed.
//
// Provider id keys per catalog (ADR-0020 §4 provider_ids). Keys are ADDITIVE:
// a provider may set some subset; the map is preserved exactly as produced.
export const PROVIDER_ID_KEYS = Object.freeze({
  records: Object.freeze(['discogsId', 'mbid']),
  books: Object.freeze(['googleBooksId', 'openLibraryId', 'isbn']),
})

// The deterministic outcome model. An adapter NEVER throws to the caller for a
// provider failure — it returns { outcome: FAILED } so the lookup chain (which
// already distinguishes NO_MATCH from ALL_PROVIDERS_FAILED, RES-1.5 T5 #290)
// can treat it deterministically. A genuine programming/contract misuse throws
// ProviderAdapterError.
export const OUTCOME = Object.freeze({
  OK: 'ok',
  NO_MATCH: 'NO_MATCH',
  FAILED: 'FAILED',
})

export const OUTCOME_VALUES = new Set(Object.values(OUTCOME))

// Raised for adapter CONTRACT misuse (missing method, bad outcome), never for
// a provider failure. Callers catch provider failures via the FAILED outcome.
export class ProviderAdapterError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProviderAdapterError'
    this.code = code
  }
}

// A single normalized hit. This is the ONLY shape an adapter emits. There is
// deliberately NO free-form spread of provider fields here: every key is either
// in `provider_ids` (additive, preserved) or in `canonical_attributes` (the
// validated extensible metadata, ADR-0020 §4) or `media`. An adapter must not
// attach extra keys.
//
// @typedef {{
//   provider_ids: Object<string, string|number|null>,
//   canonical_attributes: Object<string, *>,
//   media: { coverImage?: string, thumb?: string, resourceUrl?: string, infoLink?: string },
//   source: string,
// }} NormalizedHit

// Normalize the set of raw hits for one provider into the provider-agnostic
// shape. `normalizer(hit)` maps ONE raw hit -> NormalizedHit (pure). Hits that
// a provider cannot normalize are dropped (a pathological row must never leak
// provider fields into the domain).
function toOutcome(outcome, hits = []) {
  if (!OUTCOME_VALUES.has(outcome)) {
    throw new ProviderAdapterError('INVALID_OUTCOME', `Unknown outcome: ${outcome}`)
  }
  const normalized = (hits || []).filter((h) => h && typeof h === 'object')
  return { outcome, hits: normalized }
}

// ---------------------------------------------------------------------------
// createProviderAdapter — the one way to build a compliant provider adapter.
//
// Every provider integration registers through here so the common contract is
// enforced once, in one place:
//   * `name`       — stable provider id ('discogs' | 'musicbrainz' |
//                    'googleBooks' | 'openlibrary') matching the registry
//                    provider mappings (collection-type-registry.js / #315).
//   * `catalog`    — 'records' | 'books' (the collection type it feeds).
//   * `allowedHosts` — the ONLY hosts this adapter may reference (SSRF
//                    posture; asserted by the adapter's contract test).
//   * `normalizer` — (rawHit) => NormalizedHit | null. Pure; validates each hit
//                    into the normalized shape. Must be provided.
//   * `searchBarcode`, `searchText`, `detail`, `lookupByIdentifier` —
//                    async methods that return a raw hit ARRAY (or null/[] for
//                    none). Each maps through `normalizer` and returns a
//                    `{ outcome, hits }` result. A provider that does not
//                    support a method simply omits it.
//   * `fetchEnvelope` — optional async (method) => raw envelope
//                    ({ results } | { items } | object). When present, the
//                    adapter auto-runs schema-validation + size-limiting via
//                    payload-guard BEFORE normalization, then normalizes.
//
// The returned adapter is frozen and exposes ONLY the contract surface, so a
// consumer can never reach provider internals.
// ---------------------------------------------------------------------------
export function createProviderAdapter({
  name,
  catalog,
  allowedHosts = [],
  normalizer,
  searchBarcode,
  searchText,
  detail,
  lookupByIdentifier,
  fetchEnvelope,
  envelopeKeys = [],
}) {
  if (!name || !catalog) throw new ProviderAdapterError('INVALID_ADAPTER', 'name and catalog are required')
  if (typeof normalizer !== 'function') {
    throw new ProviderAdapterError('INVALID_ADAPTER', `adapter ${name} requires a normalizer`)
  }
  if (!(catalog in PROVIDER_ID_KEYS)) {
    throw new ProviderAdapterError('INVALID_ADAPTER', `unknown catalog: ${catalog}`)
  }

  // Guard+normalize a single method result. `rows` is the raw hit array (or a
  // single raw object for detail). Returns { outcome, hits }. Pure (sync) — the
  // normalizer is pure, so this never needs to await.
  const handle = (rows) => {
    if (rows == null) return toOutcome(OUTCOME.NO_MATCH, [])
    const list = Array.isArray(rows) ? rows : [rows]
    if (list.length === 0) return toOutcome(OUTCOME.NO_MATCH, [])
    const hits = list.map(normalizer).filter(Boolean)
    return toOutcome(hits.length ? OUTCOME.OK : OUTCOME.NO_MATCH, hits)
  }

  // Optional: when a fetchEnvelope + envelopeKeys are provided, run the
  // payload-guard (schema-validated + size-limited) BEFORE normalization.
  // Requires the payload-guard module; imported lazily to keep this module
  // pure when a provider only offers direct rows.
  const guardedFetch = async (method, envelopeKey) => {
    const raw = await fetchEnvelope(method)
    const { guardProviderPayload } = await import('./payload-guard')
    const guarded = guardProviderPayload(raw, { envelopeKey, allowedHosts })
    if (guarded.error) {
      return toOutcome(OUTCOME.FAILED, [])
    }
    return handle(guarded.value)
  }

  const adapter = {
    name,
    catalog,
    allowedHosts: Object.freeze([...allowedHosts]),
    outcomeFor: (rows) => (rows && rows.length ? OUTCOME.OK : OUTCOME.NO_MATCH),
    // Normalize ONE raw hit (pure). Returns a NormalizedHit or null. Exposed so
    // a consumer can normalize a raw envelope hit it already holds (e.g. from
    // the #281 proxy/fallback envelope) through the same contract.
    normalize: (hit) => normalizer(hit) || null,
    // Normalize MANY raw hits into { outcome, hits }.
    normalizeMany: (rows) => handle(rows),
  }

  if (searchBarcode) adapter.searchBarcode = fetchEnvelope
    ? (_arg) => guardedFetch('searchBarcode', envelopeKeys[0]).catch(() => toOutcome(OUTCOME.FAILED, []))
    : (_arg) => searchBarcode(_arg).then(handle).catch(() => toOutcome(OUTCOME.FAILED, []))
  if (searchText) adapter.searchText = fetchEnvelope
    ? (_arg) => guardedFetch('searchText', envelopeKeys[1]).catch(() => toOutcome(OUTCOME.FAILED, []))
    : (_arg) => searchText(_arg).then(handle).catch(() => toOutcome(OUTCOME.FAILED, []))
  if (detail) adapter.detail = fetchEnvelope
    ? (_arg) => guardedFetch('detail', envelopeKeys[2]).catch(() => toOutcome(OUTCOME.FAILED, []))
    : (_arg) => detail(_arg).then(handle).catch(() => toOutcome(OUTCOME.FAILED, []))
  if (lookupByIdentifier) adapter.lookupByIdentifier = (id) => lookupByIdentifier(id).then(handle).catch(() => toOutcome(OUTCOME.FAILED, []))

  return Object.freeze(adapter)
}
