// payload-guard.js — FEAT-6.4 #317 / ADR-0020 §6/#317 control: validate and
// size-limit a provider response BEFORE it is normalized. Provider payloads
// are untrusted input (ADR-0010, ADR-0013, ADR-0017 §Security): a hostile or
// degenerate provider body must be rejected fail-closed to a deterministic
// FAILED outcome — never passed to a normalizer and never cached as a real
// payload.
//
// What this module owns (and why it is separate from the normalizers):
//   * SIZE cap: bound the raw provider body before it is buffered/parsed.
//   * SCHEMA shape: enforce the envelope the provider contract expects
//     ({ results } for records-search, { items } for books-search, or a plain
//     object for detail), and that array entries are objects.
//   * XSS-safe / canonical-field guard: every canonical string emitted by a
//     normalizer is validated by the existing security.js `str`/`arrayOfStrings`
//     guards (dangerous-content rejection, length caps). That validation lives
//     in the normalizers; this module owns the envelope-level guard.
//
// The existing #281 proxies already size-cap provider bodies before caching
// (discogs.js / books.js MAX_PROXY_BYTES). This guard is the adapter-layer
// enforcement so normalization cannot be reached with a malformed payload even
// when the proxy caps are bypassed (defense-in-depth, single ownership).

import { isDangerousContent } from '../security'

// A per-envelope default size cap for provider payloads (2 MiB matches the
// Discogs/MusicBrainz/OpenLibrary caps). Callers may pass their own.
export const DEFAULT_PROVIDER_BYTES = 2 * 1024 * 1024

// Stable, machine-readable failure codes for a rejected provider payload.
export const PAYLOAD_ERROR = Object.freeze({
  TOO_LARGE: 'TOO_LARGE',
  INVALID_JSON: 'INVALID_JSON',
  BAD_ENVELOPE: 'BAD_ENVELOPE',
  BAD_HOST: 'BAD_HOST',
  UNKNOWN_SCHEMA: 'UNKNOWN_SCHEMA',
})

// Only fixed, allowlisted hosts may appear as provider resource/cover URLs in a
// normalized hit. A provider returning a URL for an off-allowlist host is
// rejected (SSRF posture, ADR-0017 §Security). Each adapter passes its
// ALLOWED_HOSTS; when none is provided we accept no URL-bearing fields.
const HTTP_URL_RE = /^https?:\/\/[^/]+\//

function hostOf(url) {
  const m = HTTP_URL_RE.exec(String(url || ''))
  if (!m) return null
  const rest = m[0].slice('https://'.length)
  return rest.split(/[/:?]/)[0].toLowerCase()
}

// True when a provider URL string references only an allowlisted host (or is
// not a URL at all — a non-URL string is not a fetch target and is allowed).
export function isAllowedProviderUrl(url, allowedHosts) {
  if (typeof url !== 'string' || url === '') return true
  if (!HTTP_URL_RE.test(url)) return true
  const host = hostOf(url)
  return !!host && allowedHosts.some((h) => h === host || host.endsWith(`.${h}`))
}

// Validate the ENVELOPE shape for a provider response.
//   envelopeKey: 'results' (records search) | 'items' (books search) |
//                undefined (detail — a plain object, not an array wrapper).
// Returns { value } (the validated array of raw hit objects, or []) or
// { error: { code, message } } (fail-closed).
export function guardProviderPayload(raw, {
  envelopeKey,
  allowedHosts = [],
  maxBytes = DEFAULT_PROVIDER_BYTES,
} = {}) {
  if (raw == null) return { error: { code: PAYLOAD_ERROR.INVALID_JSON, message: 'Empty provider response.' } }

  // SIZE cap: bound the raw text before parsing (the normalization boundary).
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { error: { code: PAYLOAD_ERROR.TOO_LARGE, message: 'Provider response too large.' } }
  }

  // PARSE: a non-JSON body is a malformed payload -> FAILED.
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { error: { code: PAYLOAD_ERROR.INVALID_JSON, message: 'Provider returned invalid JSON.' } }
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: { code: PAYLOAD_ERROR.BAD_ENVELOPE, message: 'Provider payload is not an object.' } }
  }

  let rows
  if (envelopeKey) {
    // A search envelope: the expected key must be an array (empty allowed).
    if (!Array.isArray(parsed[envelopeKey])) {
      return { error: { code: PAYLOAD_ERROR.BAD_ENVELOPE, message: `Provider payload missing "${envelopeKey}" array.` } }
    }
    rows = parsed[envelopeKey]
    // Reject a hostile host in any URL-bearing field before normalization.
    for (const row of rows) {
      if (row && typeof row === 'object' && !hostCheck(row, allowedHosts)) {
        return { error: { code: PAYLOAD_ERROR.BAD_HOST, message: 'Provider returned an off-allowlist URL.' } }
      }
    }
  } else {
    // Detail: a single object (empty {} is a valid detail miss).
    if (typeof parsed !== 'object') {
      return { error: { code: PAYLOAD_ERROR.BAD_ENVELOPE, message: 'Provider detail payload is not an object.' } }
    }
    if (!hostCheck(parsed, allowedHosts)) {
      return { error: { code: PAYLOAD_ERROR.BAD_HOST, message: 'Provider returned an off-allowlist URL.' } }
    }
    rows = [parsed]
  }

  return { value: rows }
}

// Validate an already-parsed HIT ARRAY (or a single raw hit object) at the
// normalization boundary — the path the registered adapters actually run
// (normalizeMany / search / detail / lookup, ADR-0017 lookup boundary). This is
// the mandatory per-row enforcement that runs BEFORE a normalizer sees the hit:
//   * SIZE cap on the serialized rows (fail-closed, deterministic FAILED).
//   * SCHEMA: every row must be a non-array object (a malformed row -> FAILED,
//     never dropped-and-normalized).
//   * HOST: any URL-bearing string in a row must reference an allowlisted host
//     (SSRF posture, ADR-0017 §Security).
// Returns { value: [rows] } or { error: { code, message } }.
export function guardProviderRows(rows, {
  allowedHosts = [],
  maxBytes = DEFAULT_PROVIDER_BYTES,
} = {}) {
  if (rows == null) return { error: { code: PAYLOAD_ERROR.INVALID_JSON, message: 'Empty provider response.' } }

  const list = Array.isArray(rows) ? rows : [rows]

  // SIZE cap: bound the serialized rows before any normalization.
  if (Buffer.byteLength(JSON.stringify(list), 'utf8') > maxBytes) {
    return { error: { code: PAYLOAD_ERROR.TOO_LARGE, message: 'Provider response too large.' } }
  }

  // SCHEMA + HOST per row (fail-closed on the first violation).
  for (const row of list) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { error: { code: PAYLOAD_ERROR.BAD_ENVELOPE, message: 'Provider hit is not an object.' } }
    }
    if (!hostCheck(row, allowedHosts)) {
      return { error: { code: PAYLOAD_ERROR.BAD_HOST, message: 'Provider returned an off-allowlist URL.' } }
    }
  }

  return { value: list }
}

// Reject a provider row/object that references a non-allowlisted URL anywhere
// in its string leaf values (recursive, bounded by depth). Defense-in-depth for
// the SSRF posture: a provider returning a cover/resource URL for a host that
// is not in the adapter's fixed allowlist is treated as hostile.
const MAX_DEPTH = 6

function hostCheck(node, allowedHosts, depth = 0) {
  if (depth > MAX_DEPTH) return true // stop descending — not a URL target
  if (typeof node === 'string') return isAllowedProviderUrl(node, allowedHosts)
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) {
      if (!hostCheck(v, allowedHosts, depth + 1)) return false
    }
  }
  return true
}

// Re-exported so a normalizer can run the same dangerous-content guard on a
// canonical string (XSS-safe rendering, SEC-7.5 #409 / ADR-0020 #317 control).
export function isSafeCanonicalString(value) {
  if (typeof value !== 'string') return false
  return !isDangerousContent(value)
}
