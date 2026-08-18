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
const ACTIVATION_KEY = 'runout.events.activation'
const MAX_EVENTS = 500
const BROWSE_PREFIX = 'runout.events.browse.'

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

/** Turn tracking on ('1') or off (key removed). Never throws. */
export function setTrackingEnabled(on) {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch { /* never throw */ }
}

/** Drop secret-like keys and any non-primitive value before queueing. */
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

function markActivationOnce() {
  try {
    if (sessionStorage.getItem(ACTIVATION_KEY) === '1') return false
    sessionStorage.setItem(ACTIVATION_KEY, '1')
    return true
  } catch {
    return false
  }
}

function markBrowseOnce(kind) {
  if (!kind) return false
  try {
    const key = `${BROWSE_PREFIX}${kind}`
    if (sessionStorage.getItem(key) === '1') return false
    sessionStorage.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Queue one event when tracking is enabled. A no-op otherwise.
 * A successful owned-item add already calls `gamif_item_added`; the first such
 * event in a browser session is the activation signal.
 */
export function track(event, props = {}) {
  if (!isTrackingEnabled()) return
  if (!event || typeof event !== 'string') return

  const safeProps = sanitize(props)
  const queue = readQueue()
  queue.push({ event, ts: new Date().toISOString(), props: safeProps })

  if (event === 'gamif_item_added' && markActivationOnce()) {
    queue.push({ event: 'activation', ts: new Date().toISOString(), props: { kind: safeProps.kind, source: safeProps.source } })
  }

  writeQueue(queue)
}

/**
 * Observe CollectionView mounts without adding another application call site.
 * CollectionView exposes `.collection-view[data-kind]`. A mount is the browse
 * signal; it is counted once per kind per browser session, avoiding StrictMode
 * and remount double-counts. Disabled tracking remains a true no-op.
 */
function observeCollectionBrowse() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return

  const emitIfCollection = (node) => {
    if (!(node instanceof Element)) return
    const roots = []
    if (node.matches('.collection-view[data-kind]')) roots.push(node)
    node.querySelectorAll?.('.collection-view[data-kind]').forEach((root) => roots.push(root))
    for (const root of roots) {
      const kind = root.getAttribute('data-kind')
      if (kind && isTrackingEnabled() && markBrowseOnce(kind)) track('browse', { kind })
    }
  }

  try {
    document.querySelectorAll('.collection-view[data-kind]').forEach(emitIfCollection)
    if (!document.body) return
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) emitIfCollection(node)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  } catch { /* instrumentation must never affect application behaviour */ }
}

observeCollectionBrowse()

/** Placeholder for the future opt-in network flush. */
export function flushEvents() {
  // no-op — reserved for the opt-in flush endpoint
}

/** Drop any queued events. Safe to call whether tracking is on or off. */
export function clearEvents() {
  try { localStorage.removeItem(EVENTS_KEY) } catch { /* never throw */ }
  try {
    sessionStorage.removeItem(ACTIVATION_KEY)
    sessionStorage.removeItem(`${BROWSE_PREFIX}records`)
    sessionStorage.removeItem(`${BROWSE_PREFIX}books`)
  } catch { /* never throw */ }
}
