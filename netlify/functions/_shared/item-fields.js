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
//
// (FEAT-EPIC-5, #276) Phase A enrichment fields (marketing/gamification
// requirements.md §5bis.1): records carry artists[]/masterId/tracklist/
// released; books carry authorsList[]/subtitle/series/mainCategory/snippet.
// The allowlist is shared across kinds — the normalizers fill per kind and the
// same validation below applies to both.
export const ITEM_FIELD_ALLOWLIST = new Set([
  'title', 'year', 'label', 'genre', 'style', 'country', 'formatType',
  'coverImage', 'barcode', 'discogsId', 'googleBooksId', 'dateAdded',
  'notes', 'wishlist', 'pageCount', 'description', 'catno', 'formatRaw', 'isbn',
  // Phase A enrichment (§5bis.1) — records
  'artists', 'masterId', 'tracklist', 'released',
  // Phase A enrichment (§5bis.1) — books
  'authorsList', 'subtitle', 'series', 'mainCategory', 'snippet',
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
      if (Object.hasOwn(body, key)) out[key] = body[key]
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
import { arrayOfStrings, boolean, check, intInRange, rejectUnknown, str } from './security'

// genre / style are arrays of genre strings in the item shape (e.g.
// ['Rock', 'Jazz']), but a legacy single string is also accepted.
function strOrArray(value, { max = 1000, itemMax = 500 } = {}) {
  if (value === undefined || value === null) return { value: undefined }
  if (typeof value === 'string') return str(value, { max })
  if (Array.isArray(value)) return arrayOfStrings(value, { max: 100, itemMax })
  return { error: { code: 'TYPE_ERROR', message: 'Expected a string or an array of strings.' } }
}

// ---------------------------------------------------------------------------
// (FEAT-EPIC-5, #276) Phase A enrichment — structured array + scalar fields
// (marketing/gamification/requirements.md §5bis.1).
//
// Persisting content-bearing enrichment on the item widens the client-writable
// surface, so each new field is validated with the SAME discipline as the rest
// of the allowlist: arrays are length-capped, every entry is type-checked
// against a FIXED sub-shape, and unknown/extra sub-keys are REJECTED (not
// dropped) — unlike the flexible top-level item, these sub-shapes are a strict
// contract from the normalizers, so a hostile nested object (a deep object
// where a string is expected, a forged key inside an artist entry) can never
// smuggle junk into the stored item.
//   records: artists[] (≤8, {id,name,anv?,role?}), masterId (number|null),
//            tracklist (≤40, {position,title,duration?}), released (date str)
//   books:   authorsList[] (≤8, {name,id?}), subtitle, series, mainCategory,
//            snippet (≤400 chars)
// Exported caps so the negative tests pin the exact limits.
// ---------------------------------------------------------------------------
export const ARTISTS_MAX = 8
export const TRACKLIST_MAX = 40
export const AUTHORS_MAX = 8
export const SNIPPET_MAX = 400

const ARTIST_KEYS = new Set(['id', 'name', 'anv', 'role'])
const TRACK_KEYS = new Set(['position', 'title', 'duration'])
const AUTHOR_KEYS = new Set(['name', 'id'])
const RELEASED_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/

// A fixed-shape array entry: a plain object (not an array, not null) whose
// keys are exactly the allowed sub-shape — anything else is rejected. This is
// the deep-object guard for the new arrays (a nested hostile object where a
// scalar is expected is caught by the per-key type checks below).
function entryObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: { code: 'TYPE_ERROR', message: 'Expected an object.' } }
  }
  const unknown = rejectUnknown(value, keys)
  if (unknown) return { error: unknown }
  return { value }
}

// One Discogs artist: { id, name, anv?, role? }. id + name required.
function artistEntry(value) {
  const o = entryObject(value, ARTIST_KEYS)
  if (o.error) return o
  const violation = check(
    intInRange(value.id, { required: true, min: 1, max: 9000000000 }),
    str(value.name, { required: true, max: 300 }),
    str(value.anv, { max: 300 }),
    str(value.role, { max: 200 }),
  )
  if (violation) return { error: violation }
  return { value: {
    id: value.id,
    name: value.name.trim(),
    ...(value.anv != null ? { anv: value.anv.trim() } : {}),
    ...(value.role != null ? { role: value.role.trim() } : {}),
  } }
}

// One Discogs track: { position, title, duration? }. position + title required.
function trackEntry(value) {
  const o = entryObject(value, TRACK_KEYS)
  if (o.error) return o
  const violation = check(
    str(value.position, { required: true, max: 20 }),
    str(value.title, { required: true, max: 500 }),
    str(value.duration, { max: 20 }),
  )
  if (violation) return { error: violation }
  return { value: {
    position: value.position.trim(),
    title: value.title.trim(),
    ...(value.duration != null ? { duration: value.duration.trim() } : {}),
  } }
}

// One Google Books author: { name, id? }. name required, id optional.
function authorEntry(value) {
  const o = entryObject(value, AUTHOR_KEYS)
  if (o.error) return o
  const violation = check(
    str(value.name, { required: true, max: 300 }),
    str(value.id, { max: 200 }),
  )
  if (violation) return { error: violation }
  return { value: {
    name: value.name.trim(),
    ...(value.id != null ? { id: value.id.trim() } : {}),
  } }
}

// Length-cap + per-entry type check for the structured arrays. Returns the
// cleaned (trimmed, sub-key-scoped) array so storage never sees the raw body.
function arrayOfEntries(value, entry, { max }) {
  if (value === undefined || value === null) return { value: undefined }
  if (!Array.isArray(value)) return { error: { code: 'TYPE_ERROR', message: 'Expected an array.' } }
  if (value.length > max) return { error: { code: 'TOO_LONG', message: `At most ${max} items.` } }
  const out = []
  for (const item of value) {
    const r = entry(item)
    if (r.error) return { error: r.error }
    out.push(r.value)
  }
  return { value: out }
}

// Discogs release date: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' (00 placeholders
// allowed). Empty/absent is fine; anything else is rejected as garbage.
function released(value) {
  const s = str(value, { max: 40 })
  if (s.error) return { error: s.error }
  if (s.value === undefined || s.value === '') return { value: undefined }
  if (!RELEASED_RE.test(s.value)) {
    return { error: { code: 'TYPE_ERROR', message: 'Expected a date like YYYY-MM-DD.' } }
  }
  return { value: s.value }
}

export function validateItem(body, { partial = false } = {}) {
  // (FEAT-EPIC-5, #276) Phase A enrichment validators — captured up front so
  // their cleaned values (not the raw body arrays) are what's stored below.
  const artists = arrayOfEntries(body?.artists, artistEntry, { max: ARTISTS_MAX })
  const tracklist = arrayOfEntries(body?.tracklist, trackEntry, { max: TRACKLIST_MAX })
  const authorsList = arrayOfEntries(body?.authorsList, authorEntry, { max: AUTHORS_MAX })
  const releasedDate = released(body?.released)
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
    // Phase A enrichment (§5bis.1, FEAT-EPIC-5 #276) — structured arrays are
    // capped + per-entry type-checked; scalars are strings (numbers for
    // masterId). Malformed input is rejected 400, never stored.
    artists,
    intInRange(body?.masterId, { min: 1, max: 9000000000 }),
    tracklist,
    releasedDate,
    authorsList,
    str(body?.subtitle, { max: 500 }),
    str(body?.series, { max: 500 }),
    str(body?.mainCategory, { max: 500 }),
    str(body?.snippet, { max: SNIPPET_MAX }),
  )
  if (violation) return { error: violation }
  // Rebuild with trimmed string values; pass through numbers/booleans/arrays.
  const picked = pickItemFields(body)
  const item = { ...picked }
  for (const key of Object.keys(item)) {
    if (typeof item[key] === 'string') item[key] = item[key].trim()
  }
  // (FEAT-EPIC-5, #276) Store the cleaned (trimmed, sub-key-scoped) structured
  // values, not the raw body arrays — the allowlist only guarantees they reach
  // the item; these writes guarantee the exact validated shape is what's kept.
  if (artists.value !== undefined) item.artists = artists.value
  if (tracklist.value !== undefined) item.tracklist = tracklist.value
  if (authorsList.value !== undefined) item.authorsList = authorsList.value
  if (releasedDate.value !== undefined) item.released = releasedDate.value
  return { item }
}
