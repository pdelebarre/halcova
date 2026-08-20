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
// a body) — routed through the shared `redactString` so a secret that somehow
// reaches `err.message` is scrubbed — and the client gets a fixed, secret-free
// message. `redactString` lives in _shared/audit.js, which has no dependency
// back on this module, so there is no import cycle.

import { redactString } from './audit'

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
  // NIT M5: scrub the logged detail through the shared redactor so an access
  // code, key, bearer, long token, or email in `err.message` never reaches the
  // log verbatim. The client-facing generic 500 is unchanged.
  console.error(`[internal]${id ? ` requestId=${id}` : ''}:`, redactString(err?.message || err))
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

// ---------------------------------------------------------------------------
// XSS-in-item-fields guard (SEC-7.5, #409).
//
// `str()` used to trim + length-check only, so a payload like
// `<script>alert(1)</script>` (or an `onerror=` / `javascript:` event handler)
// was stored verbatim on the item and re-served. This is a fail-closed
// rejection at the validation boundary: a stored item field is free text, not
// markup, so there is no legitimate reason for it to contain a script tag, an
// event-handler attribute, an embedded `<iframe>/<object>/<embed>/<svg>/<style>`
// element, or a `javascript:` URI. Rejecting these outright (rather than
// sanitizing) is the safest defense-in-depth: no encoding mistake can let the
// payload slip through. Because every allowlisted item text field (title,
// notes, description, artists[].name, tracklist[].title, subtitle, series,
// genre/style array entries, …) flows through `str()` / `arrayOfStrings()`,
// this one guard covers the whole client-writable surface.
//
// Fail-closed for the whole class, not a bounded blocklist:
//   - The input is HTML-entity-decoded FIRST (`&#x73;` → `s`, `&lt;` → `<`,
//     `&amp;` → `&`), so entity-obfuscated payloads such as
//     `java&#x73;cript:alert(1)` or `<scr&#x69;pt>…</scr&#x69;pt>` collapse to
//     their literal form and are then caught by the literal checks below.
//   - ANY `<tag … on<handler>=…>` attribute is rejected across ALL tags and ALL
//     handler names (`<\w+[^>]*\son[a-z][a-z0-9]*\s*=`), so a handler that is
//     not on a curated list (onmousemove, onfocusin, onloadedmetadata,
//     onbeforeinput, onmousewheel, onreadystatechange, …) on any element
//     (<img>, <a>, <video>, <body>, <input>, …) can never bypass.
//   - The same handler bound to a KNOWN (OWASP-common) event-handler list is
//     also rejected WITHOUT a surrounding tag (token-boundary `x onerror=…`),
//     so the standalone attribute form is caught while an ordinary word that
//     merely starts with "on" ("one", "only", "ongoing") is never misflagged.
//   - Dangerous embedded/executable elements are rejected regardless of any
//     handler: <script>, <iframe>, <object>, <embed>, <svg>, <style>, <math>,
//     <form>, <link>, <meta>, <base> (opening or closing).
//   - A `javascript:` URI scheme is rejected.
const EVENT_HANDLER_NAMES =
  'error|click|load|mouseover|mouseout|mouseenter|mouseleave|mousedown|mouseup|' +
  'focus|focusin|focusout|blur|change|submit|keydown|keyup|keypress|input|select|' +
  'toggle|wheel|dblclick|contextmenu|auxclick|pointerdown|pointerup|pointerenter|' +
  'pointerleave|pointermove|pointerover|pointerout|pointercancel|gotpointercapture|' +
  'lostpointercapture|drag|dragstart|dragend|dragover|dragenter|dragleave|drop|' +
  'paste|copy|cut|touchstart|touchmove|touchend|touchcancel|scroll|resize|' +
  'timeupdate|loadedmetadata|durationchange|loadeddata|canplay|canplaythrough|' +
  'play|pause|ratechange|progress|stalled|waiting|seeking|seeked|ended|emptied|' +
  'abort|readystatechange|pageshow|pagehide|hashchange|popstate|beforeunload|' +
  'unload|online|offline|storage|message|visibilitychange|animationstart|' +
  'animationend|animationiteration|animationcancel|transitionend|transitionrun|' +
  'transitionstart|transitioncancel|mousewheel|beforeinput|pointerrawupdate'

// A `<tag … on<handler>=…>` form — ANY element, ANY handler name. This is the
// unambiguous executable XSS vector, so no curated handler list is needed here.
const DANGEROUS_ANY_HANDLER_TAG_RE = /<\w+[^>]*\son[a-z][a-z0-9]*\s*=/i
// The `on<known-handler>=` attribute WITHOUT a surrounding tag (token-boundary
// "x onerror=…"). Bounded to the known list so "one =", "only =" are never
// misflagged; the curated list above covers the common handlers.
const DANGEROUS_STANDALONE_HANDLER_RE = new RegExp(
  `(?:^|[\\s"'])(?:on(?:${EVENT_HANDLER_NAMES}))\\s*=`,
  'i',
)
// Embedded / executable elements, handler or not (opening or closing form).
const DANGEROUS_ELEMENT_RE =
  /<(?:\/)?(?:script|iframe|object|embed|svg|style|math|form|link|meta|base)\b/i
const JAVASCRIPT_URI_RE = /javascript\s*:/i

const DANGEROUS_RES = [
  DANGEROUS_ELEMENT_RE,
  DANGEROUS_ANY_HANDLER_TAG_RE,
  DANGEROUS_STANDALONE_HANDLER_RE,
  JAVASCRIPT_URI_RE,
]

// Decode common HTML character + numeric entities so obfuscated payloads
// (`&#x73;`, `&lt;`, `&amp;`, `&#60;`, …) collapse to their literal form before
// the dangerous-content checks run. Unknown/named non-entities are left intact.
function htmlDecode(str) {
  const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' }
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (m, e) => named[e.toLowerCase()] ?? m)
}

// True when `value` is dangerous as stored plain-text content. Fail-closed:
// any dangerous element, any `<tag on*=…>` form, a standalone known handler, or
// a `javascript:` URI is rejected — after entity-decoding so obfuscation can't
// bypass it.
export function isDangerousContent(value) {
  const decoded = htmlDecode(value)
  for (const re of DANGEROUS_RES) {
    if (re.test(decoded)) return true
  }
  return false
}

export function str(value, { max = STRING_MAX, required = false, trim = true, rejectHtml = true } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (typeof value !== 'string') return { error: { code: 'TYPE_ERROR', message: 'Expected a string.' } }
  const v = trim ? value.trim() : value
  if (required && v.length === 0) return { error: { code: 'REQUIRED', message: 'This field is required.' } }
  if (v.length > max) return { error: { code: 'TOO_LONG', message: `Must be at most ${max} characters.` } }
  // Fail-closed: reject dangerous HTML/script/event-handler content in stored
  // text fields (XSS defense-in-depth, SEC-7.5 #409).
  if (rejectHtml && isDangerousContent(v)) {
    return { error: { code: 'HTML_REJECTED', message: 'Content is not allowed.' } }
  }
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

export function arrayOfStrings(value, { max = 100, itemMax = 1000, required = false, rejectHtml = true } = {}) {
  if (value === undefined || value === null) {
    return required ? { error: { code: 'REQUIRED', message: 'This field is required.' } } : { value: undefined }
  }
  if (!Array.isArray(value)) return { error: { code: 'TYPE_ERROR', message: 'Expected an array.' } }
  if (value.length > max) return { error: { code: 'TOO_LONG', message: `At most ${max} items.` } }
  for (const item of value) {
    if (typeof item !== 'string' || item.length > itemMax) {
      return { error: { code: 'TYPE_ERROR', message: 'Expected an array of short strings.' } }
    }
    // Fail-closed: every array entry (genre/style/etc.) is plain text, so it
    // goes through the SAME dangerous-content guard as a scalar string — an
    // XSS payload must not bypass via the array path (SEC-7.5 #409).
    if (rejectHtml && isDangerousContent(item)) {
      return { error: { code: 'HTML_REJECTED', message: 'Content is not allowed.' } }
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
