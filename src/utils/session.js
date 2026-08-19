// Thin wrapper around the persisted auth session so both the auth hook and
// the API clients can read the session token without threading it everywhere.
//
// SEC-EPIC-1 (#176/#177): the persisted session holds ONLY the opaque session
// token + the user's display data — NEVER the access code, the admin key, or
// any long-lived credential. The access code is an exchange credential used
// once at login and is not stored. The session token is random, expiring and
// revocable server-side (only its sha256 hash is stored there), so a
// localStorage leak exposes no credential that survives server-side
// revocation, and a signed-out / revoked session cannot be replayed.

const KEY = 'runout.session'

export function getSession() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveSession(session) {
  if (session) localStorage.setItem(KEY, JSON.stringify(session))
  else localStorage.removeItem(KEY)
}

// The session token sent as `Authorization: Bearer` on every API call.
export function getSessionToken() {
  return getSession()?.session || ''
}

export function getUserId() {
  return getSession()?.user?.id || ''
}

// --- Per-account local data isolation (SEC-EPIC-2, #192) -------------------
//
// `runout.session` is the only localStorage key namespaced by nothing — it
// holds the CURRENT account and is cleared on sign-out. But several feature
// keys are keyed by COLLECTION KIND, not by user id:
//   runout.recentSearches.<kind>   recent search terms
//   runout.views.<kind>            saved smart views (filter queries)
//   runout.browse.<kind>           browse/filter/sort state
//   runout.gamif.*                 local gameplay progression (ledger, level,
//                                  badges-seen)
//   runout.events[.enabled]        first-party opt-in analytics queue + flag
//   runout.offlineTrust            the trusted-device/offline-authorization
//                                  marker (#162, ADR-0015 Dec 4). It holds NO
//                                  credential (never the token/access code); it
//                                  must still be cleared on sign-out/account
//                                  switch so stale offline trust never survives
//                                  a change of account.
// Left in place, switching accounts would surface the previous account's
// browsing/search/view/progression state to the next user. `clearLocalUserData`
// removes exactly those per-kind keys on sign-out and on account switch so one
// user's local data can never appear for another. (runout.view.<kind> — a pure
// list/grid display preference — and runout.locale.<userId> are left intact:
// they are cosmetic and, in the locale case, already user-namespaced.)
//
// It deliberately does NOT touch runout.session (that's saveSession(null)'s
// job) and never throws — a storage failure must not dark-screen the app.
const USER_SCOPED_KEY_PREFIXES = [
  'runout.recentSearches.',
  'runout.views.',
  'runout.browse.',
  'runout.gamif.',
  // Analytics (default-off, opt-in). The queue lives at the base key
  // `runout.events` and the flag at `runout.events.enabled` — neither is
  // user-namespaced, so both must be cleared on account switch/logout.
  'runout.events.',
  'runout.events',
  // Offline trust marker — cleared with the rest of the user-scoped local
  // state (it is bound to the signed-in user, so it must not survive a
  // sign-out or account switch).
  'runout.offlineTrust',
]

export function clearLocalUserData() {
  try {
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && USER_SCOPED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        toRemove.push(key)
      }
    }
    for (const key of toRemove) {
      try { localStorage.removeItem(key) } catch { /* ignore */ }
    }
  } catch { /* never throw */ }
}
