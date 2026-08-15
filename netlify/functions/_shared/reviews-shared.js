// reviews-shared.js — validation + key-parsing shared by BOTH reviews data
// paths (the Postgres repo in repositories/reviews-repo.js and the Blobs
// fallback in reviews-blob.js). The reviews function (reviews.js) enforces the
// sourceId validator before any store write (M1) and the Blobs store uses
// parseReleaseKey so a legacy/corrupt key can never mis-split into a wrong
// release.

// Discogs release ids are numeric (the `id` field of the item shape). Bounded
// to 16 digits — far beyond any real Discogs release id — so a junk id is
// rejected without ever truncating a legitimate one.
export const RECORDS_SOURCE_ID_RE = /^\d{1,16}$/
export const SOURCE_ID_MAX_LENGTH = 64

// True when the string contains a C0, DEL or C1 control character (nothing
// printable survives). A char-code scan keeps the linter's no-control-regex
// off the source and reads identically to a control-char class.
function hasControlChars(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true
  }
  return false
}

// Why a sourceId matters: the Blobs release key is `release:<kind>:<sourceId>`
// and the index entry is `<kind>:<sourceId>`, both split on `:`. A `:` inside
// the id breaks that split (a bad key could 500 or hit the wrong release), and
// unbounded ids pollute the shared `runout-reviews` store / the unbounded
// `source_id text` column in Postgres. This validator is the single gate every
// write passes through.
//
// Returns a problem key ('empty' | 'too_long' | 'colon' | 'control' |
// 'records_format' | 'whitespace'), or null when the id is acceptable.
export function sourceIdProblem(sourceId, kind) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return 'empty'
  if (sourceId.length > SOURCE_ID_MAX_LENGTH) return 'too_long'
  if (sourceId.includes(':')) return 'colon'
  if (hasControlChars(sourceId)) return 'control'
  if (kind === 'records' && !RECORDS_SOURCE_ID_RE.test(sourceId)) return 'records_format'
  if (kind === 'books' && /\s/.test(sourceId)) return 'whitespace'
  return null
}

export function isValidSourceId(sourceId, kind) {
  return sourceIdProblem(sourceId, kind) === null
}

// The 400 payload for an invalid id ({ code: 'INVALID_SOURCE_ID', message }),
// or null when it is acceptable. The reviews.js handler maps this onto its
// Response before any store write.
export function sourceIdError(sourceId, kind) {
  const problem = sourceIdProblem(sourceId, kind)
  if (!problem) return null
  let message = 'sourceId contains invalid characters.'
  if (problem === 'records_format') message = 'Invalid Discogs release id.'
  else if (problem === 'too_long') message = `sourceId is too long (max ${SOURCE_ID_MAX_LENGTH} characters).`
  return { code: 'INVALID_SOURCE_ID', message }
}

// Split an `index:releases` entry (`<kind>:<sourceId>`) or a legacy STRING id
// index value back into { kind, sourceId }. Splits on the FIRST `:` only: kind
// is always a known collection name with no `:`, so a sourceId that somehow
// contains a `:` (legacy/corrupt pre-M1 data) can NEVER mis-split into a
// shorter, wrong release key. Returns null when there is no separator.
export function parseReleaseKey(key) {
  const s = String(key ?? '')
  const sep = s.indexOf(':')
  if (sep === -1) return null
  return { kind: s.slice(0, sep), sourceId: s.slice(sep + 1) }
}
