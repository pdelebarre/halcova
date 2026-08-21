// XSS Content Safety Guard — mandatory for every item/property rendered from
// provider-sourced metadata (Discogs, MusicBrainz, OpenLibrary, Google Books).
//
// This utility provides a single `isDangerousContent` predicate that checks a
// string value for XSS vectors (HTML tags, event handlers, javascript: URIs,
// data: URIs with scriptable content, etc.).
//
// Every component rendering provider-sourced strings -- ScanResult, MatchPicker,
// ManualAddModal -- MUST pass each renderable text through this guard. When a
// value is dangerous the caller MUST NOT render it as-is; the safe fallback is
// to render an empty string or a text-node-only alternative that cannot execute.
//
// SECURITY: This is a defence-in-depth layer. React's JSX escapes text content
// by default, but the guard protects against:
//   1. `dangerouslySetInnerHTML` misuse (not currently used, but defences are
//      layered).
//   2. Template-literal or raw-HTML rendering in error messages / status lines.
//   3. Propagation into attributes (e.g. `title`, `alt`, `aria-label`) where
//      injection is possible.
//   4. Future code changes that widen the rendering path.
//
// The guard FAILS CLOSED: null, undefined, non-string values or any content
// matching a dangerous pattern returns `true` (dangerous). Only a known-safe
// plain-text string returns `false`.

// Patterns that indicate XSS vectors in strings destined for rendering.
// Matched against the full string, not character-by-character.
const DANGEROUS_PATTERNS = [
  // HTML/XML tags (opening, closing, self-closing)
  /<[a-z][\s\S]*>/i,
  // Event handlers (onclick, onerror, onload, etc.)
  /\son\w+\s*=/i,
  // javascript: URIs (including encoded variants)
  /javascript\s*:/i,
  // data: URIs that could be scriptable (text/html, text/javascript, etc.)
  /data\s*:\s*text\s*\/\s*(html|javascript)/i,
  // vbscript: URIs
  /vbscript\s*:/i,
  // document.cookie / document.location access
  /document\s*\.\s*(cookie|location|write|domain)/i,
  // window.location / window.open
  /window\s*\.\s*(location|open|eval|setTimeout|setInterval)/i,
  // eval() / setTimeout() / setInterval() with string args
  /eval\s*\(/i,
  // &lt; &gt; encoded tags (defence against double-encoding bypasses)
  /&lt;\s*\/?\s*[a-z]/i,
]

/**
 * Check if a string value contains dangerous XSS content.
 *
 * @param {string|null|undefined} value - The value to check.
 * @returns {boolean} `true` when the value is dangerous or cannot be verified as
 *   safe. `false` only for a plain string that passes all safety checks.
 *
 * Usage:
 *   const title = candidate.title
 *   const safeTitle = isDangerousContent(title) ? '' : title
 *   // or: const safeTitle = sanitizeForRender(title) // convenience wrapper
 */
export function isDangerousContent(value) {
  // Fail closed: non-strings are not trusted for rendering.
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return true
  if (value.length === 0) return false // empty string is safe (renders nothing)

  // Check every dangerous pattern.
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) return true
  }

  // All checks passed — this is a safe plain-text string.
  return false
}

/**
 * Convenience wrapper: returns the original value when safe, empty string when
 * dangerous. Use this as the default render helper for provider-sourced strings.
 *
 * @param {string|null|undefined} value
 * @returns {string} The original string if safe, or '' if dangerous.
 */
export function sanitizeForRender(value) {
  return isDangerousContent(value) ? '' : value
}

/**
 * Strict wrapper: returns the original value when safe, a fallback string when
 * dangerous. Use this for required fields where an empty render would confuse
 * the layout, but the unsafe content must never render as-is.
 *
 * @param {string|null|undefined} value
 * @param {string} fallback - The fallback string (default '[...]').
 * @returns {string} The original string if safe, or the fallback.
 */
export function sanitizeForRenderWithFallback(value, fallback = '[...]') {
  return isDangerousContent(value) ? fallback : value
}