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
