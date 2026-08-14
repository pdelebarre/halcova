// First-party, DEFAULT-OFF instrumentation — Phase 0 §4, Front End Architect
// decision (docs/gamification-phase0.md). Mirrors session.js: thin, try/catch-
// guarded, never throws — a tracking failure must never dark-screen the app
// (there is no error boundary).
//
// - No third-party SDK, no external endpoint.
// - Off unless the user opts in: setTrackingEnabled(true) writes '1' to
//   localStorage.runout.events.enabled. Default OFF.
// - Events queue in localStorage.runout.events, capped at MAX_EVENTS (oldest
//   dropped) until a future opt-in flush endpoint exists.
// - sanitize() drops secret-like keys (access codes, the admin key, tokens,
//   barcodes, ISBNs, pins, ciphers, credentials) and nested objects before
//   anything is queued — nothing secret ever leaves the client.

const EVENTS_KEY = 'runout.events'
const ENABLED_KEY = 'runout.events.enabled'
const MAX_EVENTS = 500

/** Secret-like key pattern — any matching prop key is dropped before queueing. */
const SECRET_KEY = /code|token|key|secret|barcode|isbn|pin|cipher|pass|session|credential|auth|jwt/i

/** True when the user has opted in ('1' in localStorage.runout.events.enabled). */
export function isTrackingEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Turn tracking on ('1') or off (key removed). Never throws.
 */
export function setTrackingEnabled(on) {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch { /* never throw */ }
}

/**
 * Drop secret-like keys and any non-primitive value. Non-objects yield an
 * empty payload, so props can never smuggle in codes or nested structures.
 */
function sanitize(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const out = {}
  for (const [k, v] of Object.entries(props)) {
    if (SECRET_KEY.test(k)) continue
    if (v !== null && typeof v === 'object') continue
    out[k] = v
  }
  return out
}

function readQueue() {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue) {
  try {
    const capped = Array.isArray(queue) ? queue.slice(-MAX_EVENTS) : []
    localStorage.setItem(EVENTS_KEY, JSON.stringify(capped))
  } catch { /* never throw (e.g. storage full) */ }
}

/**
 * Queue one event when tracking is enabled. A no-op otherwise — including for
 * a missing/non-string event name. Props are sanitized before queueing.
 */
export function track(event, props = {}) {
  if (!isTrackingEnabled()) return
  if (!event || typeof event !== 'string') return
  const entry = { event, ts: new Date().toISOString(), props: sanitize(props) }
  const queue = readQueue()
  queue.push(entry)
  writeQueue(queue)
}

/**
 * Placeholder for the future opt-in network flush (no endpoint exists yet —
 * Phase 0 §4). Until one is wired it does nothing; clearEvents() is how the
 * queue is emptied today.
 */
export function flushEvents() {
  // no-op — reserved for the opt-in flush endpoint
}

/** Drop any queued events. Safe to call whether tracking is on or off. */
export function clearEvents() {
  try {
    localStorage.removeItem(EVENTS_KEY)
  } catch { /* never throw */ }
}
