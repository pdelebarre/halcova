import { useCallback, useEffect, useState } from 'react'
import * as authApi from '../api/auth'
import { getSession, getSessionToken, clearLocalUserData } from '../utils/session'

// Owns the signed-in session. Persists to localStorage (runout.session) so
// the PWA remembers you between visits, and revalidates the code against the
// server on startup — a disabled/revoked account is signed out, while an
// offline launch keeps the cached session so the shell still works.
export function useAuth() {
  const [session, setSession] = useState(() => getSession())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!getSession()) {
      setReady(true)
      return
    }
    authApi.me()
      .then((user) => {
        if (!cancelled) setSession(user ? { user, session: getSessionToken() } : null)
      })
      .catch(() => { /* offline — keep the cached session */ })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (code) => {
    // SEC-EPIC-2 (#192): switching accounts must never surface the previous
    // account's local browsing/search/view/gamification state to the next
    // user. Capture the previous user id BEFORE the exchange overwrites it.
    const previousId = getSession()?.user?.id
    const user = await authApi.login(code)
    if (previousId && previousId !== user.id) clearLocalUserData()
    setSession({ user, session: getSessionToken() })
    return user
  }, [])

  const requestAccess = useCallback((payload) => authApi.requestAccess(payload), [])

  const refresh = useCallback(async () => {
    try {
      const user = await authApi.me()
      setSession(user ? { user, session: getSessionToken() } : null)
    } catch {
      // Offline / server error — keep the cached session so the shell still
      // works. Only a resolved `null` from me() (revoked/disabled, 401/403)
      // signs the user out (S5, #53).
    }
  }, [])

  const logout = useCallback(() => {
    authApi.logout()
    setSession(null)
    clearLocalUserData()
  }, [])

  // SEC-1.4 (#179): revoke EVERY session for this user (all devices, current
  // one included) server-side, then clear the local session.
  const logoutAll = useCallback(() => {
    authApi.logoutAll()
    setSession(null)
    clearLocalUserData()
  }, [])

  return { session, ready, login, logout, logoutAll, refresh, requestAccess, setSession }
}
