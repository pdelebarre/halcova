// Client-side STABLE item uuid generation (M2, #289; ADR-0019 Dec 7/8; the
// M2 data gate requirement #2).
//
// WHY STABLE / MIGRATION-PROOF IDENTITIES
// ----------------------------------------
// M1 assigns `id` server-side on add; there is no client identity that can tie
// an offline-created record to its later server record. #289 establishes the
// local identity mechanism that #292 (outbox) builds on: every item in the
// offline mirror must carry a STABLE client uuid so that the outbox op, the
// mirror record and the eventual server record can be reconciled to one
// another. Nothing here depends on the network or on a client-chosen scope —
// these are pure, deterministic identity rules.
//
// The identity scheme is deliberately migration-stable: the `server:` and
// `local:` prefixes are fixed contract strings. Changing the prefix scheme
// (or the fallback algorithm) would orphan already-mirrored records, so this
// file is a contract, not an implementation detail. #292 builds its op-id on
// the SAME uuid so op, mirror and server records share one identity.
//
// Note on "client-chosen scope" (ADR-0019 Dec 6): these uuids are record
// identities, NOT ownership scopes. Ownership scope is always derived from the
// server-authenticated session (see offlineMirror.mirrorScope) — never chosen
// by the client.

// ---------------------------------------------------------------------------
// Browser-safe uuid v4. Prefers `crypto.randomUUID()` (PWA/browser); falls back
// to a cryptographically-strong CSPRNG from the WebCrypto `getRandomValues`
// API, then to Math.random only as a last resort. Deterministic-shape v4.
// ---------------------------------------------------------------------------
function randomUuid() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40 // version 4
    b[8] = (b[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // Last-resort fallback (non-WebCrypto env): still a valid v4 shape.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// A NEW local item identity, minted when an item is created offline (or is a
// client-side add that will reconcile to a server id later via #292). Stable,
// globally-unique on this device, prefixed `local:` so it can never collide
// with a server-derived id and is instantly recognizable as an unsynced record.
export function newLocalItemUuid() {
  return `local:${randomUuid()}`
}

// The deterministic mirror identity for an item that ALREADY has a server id.
// Deriving the mirror key FROM the server id (instead of minting a fresh
// random one) makes re-sync idempotent — the same server item always maps to
// the same mirror record, so re-saving the mirror never duplicates a record.
export function serverItemUuid(serverId) {
  if (serverId === undefined || serverId === null) return ''
  return `server:${String(serverId)}`
}

// True when an item identity is a server-derived key (i.e. its serverId is
// known). Local identities (`local:...`) have no serverId yet and are the
// records #292 will push + reconcile.
export function hasServerIdentity(uuid) {
  return typeof uuid === 'string' && uuid.startsWith('server:')
}
