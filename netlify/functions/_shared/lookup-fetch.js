// lookup-fetch.js — shared outbound fetch + retry helper used by BOTH lookup
// proxies (discogs.js and books.js). T1 (RES-1.1, #284).
//
// Why a shared helper: before this, books.js had its own `fetchGoogleWithRetry`
// (transient 429/5xx retry) while discogs.js did a single no-retry fetch, so
// the two providers could drift. This is the single place that owns the retry
// policy, the per-attempt + overall deadlines, Retry-After honoring, and the
// SSRF-safe `redirect:'manual'`.
//
// Contract (deliberately preserved from both callers):
//   - On a success or a NON-retryable HTTP status (2xx/3xx/4xx) it returns the
//     raw fetch `Response` and does NOT retry — the caller maps error codes by
//     `res.status` (e.g. Discogs 401 -> BAD_TOKEN, 429 -> PROVIDER_RATE_LIMIT).
//   - On a retryable HTTP status (429/5xx) that persists across all retries it
//     returns the LAST raw `Response` — the caller still maps by `res.status`,
//     so today's error codes are preserved exactly.
//   - On a persistent NETWORK failure, or when the overall deadline or a
//     per-attempt timeout aborts the request, it THROWS. The caller catches and
//     maps to its existing 502 HTTP_ERROR path.
//   - Never follows redirects (SSRF control) — `redirect:'manual'` is always
//     set and cannot be overridden.
//
// Deadlines (fit inside the Netlify function timeout, default 10s):
//   - Overall deadline defaults to 8s (< the 8.5s platform cap). When it
//     expires the current in-flight attempt is aborted immediately.
//   - Each attempt has its own 3s timeout.
//
// No new dependencies — this uses only the built-in fetch + AbortController.

export const LOOKUP_DEADLINE_MS = 8000 // overall deadline < 8.5s platform cap
export const ATTEMPT_TIMEOUT_MS = 3000 // per-attempt timeout
export const RETRY_AFTER_MAX_MS = 3000 // Retry-After honored, bounded
export const BASE_DELAY_MS = 500 // full-jitter exponential base

// Distinct error used when the OVERALL deadline is hit (mid-attempt abort).
// The caller's catch path treats this like any network failure (HTTP_ERROR).
export class LookupTimeoutError extends Error {
  constructor(message = 'Lookup deadline exceeded') {
    super(message)
    this.name = 'LookupTimeoutError'
    this.code = 'LOOKUP_TIMEOUT'
  }
}

// Retry only 429 and 5xx. Everything else (2xx/3xx/4xx) is final and returned
// as-is — a 4xx is never a transient upstream condition worth spending retry
// budget on, and a 3xx must never be followed (SSRF).
export function isRetryableStatus(status) {
  return status === 429 || status >= 500
}

// Best-effort parse of a Retry-After header. Returns the delay in seconds
// (> 0 finite number) or null when absent / malformed / meaningless.
export function parseRetryAfter(header) {
  if (header == null) return null
  const n = Number(header)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

// Full-jitter exponential backoff: delay in [0, base * 2^attempt). Returns a
// number of ms. `attempt` is zero-based (the first retry backoff uses attempt 1
// so the window is [0, base*2)).
export function fullJitterDelay(attempt, baseDelayMs = BASE_DELAY_MS) {
  const cap = baseDelayMs * 2 ** attempt
  if (cap <= 0) return 0
  return Math.floor(Math.random() * cap)
}

// Options:
//   headers, method = 'GET', body, retries = 2 (3 attempts total),
//   deadlineMs, attemptTimeoutMs, retryAfterMaxMs, baseDelayMs.
export async function lookupFetch(url, options = {}) {
  const {
    headers = {},
    method = 'GET',
    body,
    retries = 2,
    deadlineMs = LOOKUP_DEADLINE_MS,
    attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
    retryAfterMaxMs = RETRY_AFTER_MAX_MS,
    baseDelayMs = BASE_DELAY_MS,
  } = options

  const overall = new AbortController()
  let deadlineReached = false
  const overallTimer = setTimeout(() => {
    deadlineReached = true
    overall.abort()
  }, deadlineMs)

  // Release the deadline timer on every exit path so a warm instance doesn't
  // accumulate dangling timers.
  const clearAll = () => clearTimeout(overallTimer)

  let lastResponse = null
  let lastError = null

  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // Per-attempt controller linked to the overall controller: an overall
      // deadline abort propagates to the in-flight attempt (AbortSignal.any
      // semantics) and also cancels the attempt's own timeout.
      const attemptController = new AbortController()
      const onAbort = () => attemptController.abort()
      overall.signal.addEventListener('abort', onAbort)

      let attemptTimer
      if (attemptTimeoutMs > 0) {
        attemptTimer = setTimeout(() => attemptController.abort(), attemptTimeoutMs)
      }

      let res
      try {
        res = await fetch(url, {
          method,
          headers,
          body,
          // SSRF control — sacred. Never follow a redirect. A hostile upstream
          // 3xx surfaces as the raw response and is rejected by the caller.
          redirect: 'manual',
          signal: attemptController.signal,
        })
      } catch (err) {
        // Abort due to the OVERALL deadline -> distinct timeout error.
        if (deadlineReached) {
          lastError = new LookupTimeoutError()
          break
        }
        lastError = err
        // Network failure (or per-attempt timeout). Retry if budget remains,
        // otherwise fall through and throw below.
        if (attempt < retries) {
          await sleepBounded(attempt, deadlineMs, Date.now(), overall, retryAfterMaxMs, baseDelayMs)
        }
        continue
      } finally {
        clearTimeout(attemptTimer)
        overall.signal.removeEventListener('abort', onAbort)
      }

      lastResponse = res
      lastError = null
      // Success OR a non-retryable status is final — return it, no retry. This
      // preserves the "no retry on 4xx/3xx/2xx" rule.
      if (res.ok || !isRetryableStatus(res.status)) {
        return res
      }

      // Retryable (429/5xx) and budget remains -> back off then retry. Only a
      // 429 honors the upstream Retry-After (bounded); 5xx uses full-jitter.
      if (attempt < retries) {
        const retryAfterSec = res.status === 429
          ? parseRetryAfter(res.headers?.get?.('retry-after'))
          : null
        await sleepBounded(attempt, deadlineMs, Date.now(), overall, retryAfterMaxMs, baseDelayMs, retryAfterSec)
      }
    }

    // Exhausted retries.
    if (deadlineReached) throw new LookupTimeoutError()
    if (lastError) throw lastError
    // Persistent retryable HTTP status -> return the LAST raw response so the
    // caller maps error codes by res.status (today's contract).
    return lastResponse
  } finally {
    clearAll()
  }
}

// Sleep for the next backoff interval, honoring a bounded Retry-After when the
// status was 429, using full-jitter otherwise, and capped so we never sleep
// past the overall deadline. `attempt` is the zero-based index that failed.
function sleepBounded(attempt, deadlineMs, startedAt, overall, retryAfterMaxMs, baseDelayMs, retryAfterSec) {
  let delayMs
  if (retryAfterSec != null) {
    // 429 -> honor the upstream Retry-After, but NEVER wait longer than the
    // bounded cap (retryAfterMaxMs) so one hostile header can't stall us.
    delayMs = Math.min(retryAfterSec * 1000, retryAfterMaxMs)
  } else {
    delayMs = fullJitterDelay(attempt + 1, baseDelayMs)
  }
  // Cap by the remaining overall budget so the total stays <= deadlineMs.
  const remaining = deadlineMs - (Date.now() - startedAt)
  delayMs = Math.min(delayMs, Math.max(0, remaining))
  if (delayMs <= 0) return
  // Listen for the overall abort so we wake early instead of sleeping through
  // a deadline.
  return new Promise((resolve) => {
    const timer = setTimeout(done, delayMs)
    const onAbort = () => done()
    function done() {
      clearTimeout(timer)
      overall.signal.removeEventListener('abort', onAbort)
      resolve()
    }
    overall.signal.addEventListener('abort', onAbort)
  })
}
