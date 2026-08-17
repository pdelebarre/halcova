// security.js — shared, dependency-free web-security + input-validation helpers
// for the Runout functions (SEC-EPIC-3, #193).
//
// What this module owns (and why it is shared — one place, used by every
// public endpoint so the guarantees can't drift):
//   - SEC-3.4 (#197): the security headers applied to every JSON response.
//   - SEC-3.7 (#200): the safe-error wrapper — an unexpected error surfaces as
//     a generic `{ error, code: 'INTERNAL' }` 500, never a stack/DB/provider
//     message, with the real detail only in the server log.
//   - SEC-3.2 (#195): a byte-cap on request JSON bodies (413 when exceeded).
//   - SEC-3.1 (#194): reusable validators (string, integer-in-range, enum,
//     array-of-strings, unknown-key rejection) that return a `{ error }` shape
//     the shared `badRequest` turns into a clean 400 `{ error, code }`.
//
// Security rules: NEVER log/return access codes, session tokens, the admin
// key, or any Stripe/DB secret. `safeError` logs only the error message (never
// a body) and the client gets a fixed, secret-free message.

// ---------------------------------------------------------------------------
// SEC-3.4 (#197) — security headers on every JSON response.
//
// The JSON responder is what every function returns, so putting the headers
// here gives them to every endpoint at once. A JSON API never returns HTML, so
// the strictest CSP (`default-src 'none'`) is safe and blocks any reflected
// content from being interpreted. The SPA's own CSP (which allows its scripts/
// styles + cover/lookup hosts) lives in netlify.toml for the static assets.
// ---------------------------------------------------------------------------
export function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  }
}

// The canonical JSON responder for the functions. Adds the security headers
// and lets callers override/extend via the `headers` argument.
export const json = (statusCode, body, headers = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...securityHeaders(), ...headers },
})

// Turn a validator violation (SEC-3.1) into a clean 400 `{ error, code }`.
export function badRequest(violation) {
  return json(400, { error: violation.message, code: violation.code })
}

// ---------------------------------------------------------------------------
// SEC-3.7 (#200) — safe error responses.
//
// The default export of every function ends in a try/catch. Instead of
// `json(500, { error: err.message })` (which can leak a Postgres/SQL/provider
// message or an internal detail), callers use `safeError(err, req)` so the
// client gets a fixed generic message and the real detail goes to the log.
// ---------------------------------------------------------------------------

// A sane request id for correlation. Accepts an externally supplied id only if
// it matches a safe charset (an attacker can't smuggle a header injection via
// an echo).
export function requestId(req) {
  const h = req?.headers?.get?.('x-request-id')
  if (typeof h === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(h)) return h
  return null
}

// Log the operational detail (never the body / never a secret) and return a
// generic 500. The real error goes to logs only.
export function safeError(err, req) {
  const id = requestId(req)
  console.error(`[internal]${id ? ` requestId=${id}` : ''}:`, err?.message || err)
  const headers = id ? { 'X-Request-Id': id } : {}
  return json(500, { error: 'Something went wrong. Please try again.', code: 'INTERNAL' }, headers)
}

// ---------------------------------------------------------------------------
// SEC-3.2 (#195) — request body size cap.
//
// Reject an oversized JSON body with 413 BEFORE parsing or processing it. The
// default cap (64 KB) is generous for this app's payloads but stops a runaway
// client from buffering/bloating a function. Endpoints pass their own cap when
// they expect more (e.g. a feedback message + metadata) or less (a small
// action object).
// ---------------------------------------------------------------------------
export const MAX_BODY_BYTES = 64 * 1024

// Read + validate a JSON request body. Returns { value } on success, or
// { error: <Response> } with 413 (too large) / 400 (invalid JSON). `null`/`{}`
// parse to their JSON values; callers validate the shape.
//
// The real Netlify Request exposes `.text()` (used to apply the byte cap).
// Some test doubles only implement `.json()` — for those we fall back so the
// cap is skipped but parsing/validation still runs (the cap is enforced on the
// real path, which always has `.text()`).
export async function readJsonBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  if (typeof req.text === 'function') {
    const raw = await req.text()
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      return { error: json(413, { error: 'Request body too large.', code: 'PAYLOAD_TOO_LARGE' }) }
    }
    try {
      return { value: JSON.parse(raw) ?? {} }
    } catch {
      return { error: json(400, { error: 'Invalid JSON body.', code: 'INVALID_JSON' }) }
    }
  }
  // Test/legacy mock without `.text()`.
  try {
    return { value: (await req.json()) ?? {} }
  } catch {
    return { error: json(400, { error: 'Invalid JSON body.', code: 'INVALID_JSON' }) }
  }
}

// ---------------------------------------------------------------------------
// SEC-3.1 (#194) — reusable validators.
//
// Each returns { value } on success or { error: { code, message } } on the
// first violation, so they compose. `check(...)` short-circuits on the first
// error. Unknown/protected properties are rejected with UNKNOWN_FIELD (a
// mass-assignment guard on top of the field allowlists).
// ---------------------------------------------------------------------------

const STRING_MAX = 5000

export function str(value, { max = STRING_MAX, required = false, trim = true } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (typeof value !== 'string') return { error: { code: 'TYPE_ERROR', message: 'Expected a string.' } }
  const v = trim ? value.trim() : value
  if (required && v.length === 0) return { error: { code: 'REQUIRED', message: 'This field is required.' } }
  if (v.length > max) return { error: { code: 'TOO_LONG', message: `Must be at most ${max} characters.` } }
  return { value: v }
}

export function intInRange(value, { min, max, required = false } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (!Number.isInteger(value)) return { error: { code: 'TYPE_ERROR', message: 'Expected an integer.' } }
  if (value < min || value > max) return { error: { code: 'OUT_OF_RANGE', message: `Must be between ${min} and ${max}.` } }
  return { value }
}

export function boolean(value, { required = false } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (typeof value !== 'boolean') return { error: { code: 'TYPE_ERROR', message: 'Expected a boolean.' } }
  return { value }
}

export function inEnum(value, allowed, { required = false } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (!allowed.has(value)) return { error: { code: 'INVALID_ENUM', message: 'Unknown value.' } }
  return { value }
}

export function arrayOfStrings(value, { max = 100, itemMax = 1000, required = false } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (!Array.isArray(value)) return { error: { code: 'TYPE_ERROR', message: 'Expected an array.' } }
  if (value.length > max) return { error: { code: 'TOO_LONG', message: `At most ${max} items.` } }
  for (const item of value) {
    if (typeof item !== 'string' || item.length > itemMax) {
      return { error: { code: 'TYPE_ERROR', message: 'Expected an array of short strings.' } }
    }
  }
  return { value }
}

// Reject properties outside an explicit allowlist (mass-assignment guard).
export function rejectUnknown(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return { code: 'UNKNOWN_FIELD', message: `Unknown field: ${key}` }
    }
  }
  return null
}

// Run validators in order; returns the first violation or null.
export function check(...results) {
  for (const r of results) {
    if (r && r.error) return r.error
  }
  return null
}
