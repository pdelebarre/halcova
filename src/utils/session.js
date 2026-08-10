// Thin wrapper around the persisted auth session so both the auth hook and
// the API clients can read the access code without threading it everywhere.

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

// The access code sent as `Authorization: Bearer` on every API call.
export function getAccessCode() {
  return getSession()?.code || ''
}

export function getUserId() {
  return getSession()?.user?.id || ''
}
