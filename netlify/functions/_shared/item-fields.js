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

// ---------------------------------------------------------------------------
// SEC-3.1 (#194) — schema validation for collection item writes.
//
// `pickItemFields` narrows the write surface (mass-assignment defense); this
// adds TYPE + LENGTH validation on the allowlisted fields so a crafted body
// (a number where a string is expected, a multi-MB `notes`, an out-of-range
// `year`) is rejected with a clean 400 `{ error, code }` instead of being
// stored and re-served. Unknown/protected properties are still DROPPED by the
// allowlist (documented decision — the item shape is intentionally flexible
// and the client sends full item objects, so rejecting unknown keys would
// break writes; the allowlist guarantees they never reach storage).
//
// Returns { error: { code, message } } on the first violation, or { item }
// with the validated (trimmed) values. Both persistence backends call it right
// after pickItemFields so the checks can't drift.
// ---------------------------------------------------------------------------
import { arrayOfStrings, boolean, check, intInRange, str } from './security'

// genre / style are arrays of genre strings in the item shape (e.g.
// ['Rock', 'Jazz']), but a legacy single string is also accepted.
function strOrArray(value, { max = 1000, itemMax = 500 } = {}) {
  if (value === undefined || value === null) return { value: undefined }
  if (typeof value === 'string') return str(value, { max })
  if (Array.isArray(value)) return arrayOfStrings(value, { max: 100, itemMax })
  return { error: { code: 'TYPE_ERROR', message: 'Expected a string or an array of strings.' } }
}

export function validateItem(body, { partial = false } = {}) {
  const violation = check(
    // title is required on a full write, optional on a partial (PUT) patch.
    str(body?.title, { required: !partial, max: 1000 }),
    // year is an optional 4-digit-ish year.
    intInRange(body?.year, { min: 1000, max: 2100 }),
    intInRange(body?.discogsId, { min: 1, max: 9000000000 }),
    intInRange(body?.pageCount, { min: 0, max: 1000000 }),
    boolean(body?.wishlist),
    strOrArray(body?.genre),
    strOrArray(body?.style),
    str(body?.label, { max: 500 }),
    str(body?.country, { max: 200 }),
    str(body?.formatType, { max: 500 }),
    str(body?.formatRaw, { max: 2000 }),
    str(body?.coverImage, { max: 2000 }),
    str(body?.barcode, { max: 64 }),
    str(body?.googleBooksId, { max: 200 }),
    str(body?.isbn, { max: 32 }),
    str(body?.dateAdded, { max: 40 }),
    str(body?.notes, { max: 5000 }),
    str(body?.description, { max: 5000 }),
    str(body?.catno, { max: 200 }),
  )
  if (violation) return { error: violation }
  // Rebuild with trimmed string values; pass through numbers/booleans/arrays.
  const picked = pickItemFields(body)
  const item = { ...picked }
  for (const key of Object.keys(item)) {
    if (typeof item[key] === 'string') item[key] = item[key].trim()
  }
  return { item }
}
