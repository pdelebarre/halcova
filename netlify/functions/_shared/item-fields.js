// item-fields.js — server-side field allowlist for collection item writes
// (SEC-EPIC-2, #188: eliminate mass assignment). The collection API's
// POST/PUT used to `{ ...body }` — a client could smuggle ANY key onto the
// stored item. Since scoping is by the resolved session's user id, a smuggled
// `ownerId`/`userId` could NOT redirect the row to another store (the store
// and repo are keyed on the session user, never the body), but arbitrary
// spreading still lets a client write junk fields and makes the stored object
// non-hermetic. This module narrows every write to an explicit allowlist of
// item fields and DROPS protected identity/privilege fields (ownerId, userId,
// role, plan, features, collections, status, id, …) so a crafted body can
// never change ownership or escalate privileges.
//
// Both persistence backends consume it:
//   - netlify/functions/collection.js   (the Blobs path)
//   - netlify/functions/_shared/collection-postgres.js (the Postgres path)
//
// The same invariants hold regardless of backend: the server-assigned `id`
// and the session-derived user always win over anything a client sends.

// The item object's client-writable surface (mirrors the shared item shape:
// title, year, label, genre, coverImage, barcode, discogsId/googleBooksId,
// dateAdded, wishlist, plus kind-specific extras like catno/formatRaw/isbn/
// pageCount/description). `lending`/`lendingHistory` are deliberately NOT
// client-writable here — they are managed by the lending function, not by
// collection POST/PUT. `dateAdded` is allowed because a client may carry the
// lookup timestamp; the server still falls back to now() when absent.
export const ITEM_FIELD_ALLOWLIST = new Set([
  'title', 'year', 'label', 'genre', 'style', 'country', 'formatType',
  'coverImage', 'barcode', 'discogsId', 'googleBooksId', 'dateAdded',
  'notes', 'wishlist', 'pageCount', 'description', 'catno', 'formatRaw', 'isbn',
])

// Identity / privilege fields that a client must NEVER be able to write on a
// collection item. Present in a body, they are silently dropped (the stored
// object is built from the allowlist + server-assigned id). Exported for the
// negative tests (SEC-EPIC-2, #186/#188).
export const ITEM_PROTECTED_FIELDS = new Set([
  'ownerId', 'userId', 'role', 'plan', 'features', 'collections', 'status',
  'id', 'code', 'codeHash', 'adminNote', 'email', 'name',
])

// Return only the allowlisted fields from a (possibly malicious) body. Junk
// and protected fields never reach the stored item. Safe for any input —
// non-objects yield an empty object.
export function pickItemFields(body) {
  const out = {}
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of ITEM_FIELD_ALLOWLIST) {
      if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key]
    }
  }
  return out
}
