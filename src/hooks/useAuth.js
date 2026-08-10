import { useCallback, useEffect, useState } from 'react'
import * as authApi from '../api/auth'
import { getAccessCode, getSession } from '../utils/session'

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
        if (!cancelled) setSession(user ? { user, code: getAccessCode() } : null)
      })
      .catch(() => { /* offline — keep the cached session */ })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (code) => {
    const user = await authApi.login(code)
    setSession({ user, code })
    return user
  }, [])

  const requestAccess = useCallback((payload) => authApi.requestAccess(payload), [])

  const refresh = useCallback(async () => {
    const user = await authApi.me().catch(() => null)
    setSession(user ? { user, code: getAccessCode() } : null)
  }, [])

  const logout = useCallback(() => {
    authApi.logout()
    setSession(null)
  }, [])

  return { session, ready, login, logout, refresh, requestAccess, setSession }
}
