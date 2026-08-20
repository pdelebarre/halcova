// adapters.js — FEAT-6.4 #317: register the four catalogue providers behind the
// common adapter contract (createProviderAdapter). This is the provider registry
// the collection-domain code (and the #315 registry's provider mappings) can
// reference by NAME: 'discogs' | 'musicbrainz' | 'googleBooks' | 'openlibrary'.
//
// Each adapter NORMALIZES raw provider hits into the provider-agnostic
// NormalizedHit (provider_ids / canonical_attributes / media / source) — see
// normalize.js. Provider-specific DTOs never leak past this layer (ADR-0020
// §4, §15 #317).
//
// These adapters are PURE normalizers over a raw hit array: the actual outbound
// fetching, retry/fallback/cache and SSRF-safe transport stays in the existing
// #281 proxies (netlify/functions/discogs.js, books.js) and the fallback
// adapters (musicbrainz.js, openlibrary.js), which emit the envelope hits this
// layer normalizes. Lookup resilience is therefore not regressed by design.
//
// The allowed-host sets mirror each provider's SSRF posture so a normalized hit
// can be checked against them (payload-guard).

import { createProviderAdapter } from './adapter-contract'
import { normalizeRecordsHit, normalizeBooksHit } from './normalize'

// Fixed, allowlisted host sets (asserted by each provider's contract test).
// Cover hosts are URL-emitted by the proxy re-fetch; the connect hosts are the
// API hosts only.
export const PROVIDER_ALLOWED_HOSTS = Object.freeze({
  discogs: Object.freeze(['api.discogs.com']),
  musicbrainz: Object.freeze(['musicbrainz.org', 'coverartarchive.org']),
  googleBooks: Object.freeze(['www.googleapis.com']),
  openlibrary: Object.freeze(['openlibrary.org', 'covers.openlibrary.org']),
})

// Records adapters. A raw Discogs result row and a MusicBrainz fallback row
// (already mapped into the Discogs envelope by the fallback adapter) both
// normalize via normalizeRecordsHit.
export const discogsAdapter = createProviderAdapter({
  name: 'discogs',
  catalog: 'records',
  allowedHosts: PROVIDER_ALLOWED_HOSTS.discogs,
  normalizer: normalizeRecordsHit,
})

export const musicbrainzAdapter = createProviderAdapter({
  name: 'musicbrainz',
  catalog: 'records',
  allowedHosts: PROVIDER_ALLOWED_HOSTS.musicbrainz,
  normalizer: normalizeRecordsHit,
})

// Books adapters. A raw Google volume and an OpenLibrary fallback volume
// (mapped into the Google envelope by the fallback adapter) both normalize via
// normalizeBooksHit.
export const googleBooksAdapter = createProviderAdapter({
  name: 'googleBooks',
  catalog: 'books',
  allowedHosts: PROVIDER_ALLOWED_HOSTS.googleBooks,
  normalizer: normalizeBooksHit,
})

export const openlibraryAdapter = createProviderAdapter({
  name: 'openlibrary',
  catalog: 'books',
  allowedHosts: PROVIDER_ALLOWED_HOSTS.openlibrary,
  normalizer: normalizeBooksHit,
})

// The provider registry: a stable, frozen map keyed by provider name so the
// collection domain and the #315 provider mappings can resolve an adapter by
// name without hardcoding. Unsupported names return undefined (caller maps to
// UNKNOWN_PROVIDER).
export const PROVIDER_ADAPTERS = Object.freeze({
  discogs: discogsAdapter,
  musicbrainz: musicbrainzAdapter,
  googleBooks: googleBooksAdapter,
  openlibrary: openlibraryAdapter,
})

export function getProviderAdapter(name) {
  return PROVIDER_ADAPTERS[name]
}

// Resolve the ordered adapter list for a catalog (records | books) in
// ADR-0017 order (primary -> fallback), matching the #315 registry's
// provider_mappings role field.
export const CATALOG_ADAPTERS = Object.freeze({
  records: Object.freeze([discogsAdapter, musicbrainzAdapter]),
  books: Object.freeze([googleBooksAdapter, openlibraryAdapter]),
})

export function adaptersForCatalog(catalog) {
  return CATALOG_ADAPTERS[catalog] || []
}
