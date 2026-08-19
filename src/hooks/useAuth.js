import { useCallback, useEffect, useState } from 'react'
import * as authApi from '../api/auth'
import { getSession, getSessionToken, clearLocalUserData } from '../utils/session'
import {
  establishOfflineTrust,
  offlineAccessAllowed,
  revalidateOfflineTrust,
  revokeOfflineTrust,
  sessionFingerprint,
} from '../utils/offlineTrust'

// Owns the signed-in session. Persists to localStorage (runout.session) so
// the PWA remembers you between visits, and revalidates the code against the
// server on startup — a disabled/revoked account is signed out, while an
// offline launch keeps a TRUSTED cached session so the shell still works.
//
// #162 / ADR-0015 Dec 4: offline access is limited to a device that was
// previously authenticated ONLINE and explicitly trusted (see
// src/utils/offlineTrust.js). The trust record never contains the session
// token or access code; it has a bounded expiry and is extended ONLY on a
// successful online revalidation (`me()` success). A stale or expired trust
// record fails closed — the shell cannot extend offline access indefinitely.
export function useAuth() {
  const [session, setSession] = useState(() => getSession())
  const [ready, setReady] = useState(false)

  // Apply the result of a successful online `me()` revalidation: extend the
  // bounded offline trust for the (resolved, server-authenticated) user. If
  // me() resolves `null` (revoked / disabled / expired — 401/403), the trust
  // record is revoked and the session is cleared.
  const applyMeUser = useCallback((user) => {
    if (user) {
      // Only extend trust that ALREADY exists for this user (an online
      // revalidation reinforces an established grant; it never mints trust for
      // an identity that wasn't authenticated through a full login first).
      revalidateOfflineTrust(user, { sessionFp: sessionFingerprint(getSessionToken()) })
      setSession({ user, session: getSessionToken() })
    } else {
      revokeOfflineTrust({ reason: 'session_invalid' })
      setSession(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tokenAtStart = getSessionToken()
    if (!getSession()) {
      setReady(true)
      return
    }
    authApi.me()
      .then((user) => {
        if (!cancelled) applyMeUser(user)
      })
      .catch(() => {
        // Offline — keep the cached session ONLY if this device still holds a
        // live, bounded offline-trust grant for the cached user (fail-closed:
        // expired/absent trust means we do NOT render cached private state).
        //
        // Guard: only fail closed when the session token is UNCHANGED since
        // this me() started. If the user logged in / re-established meanwhile
        // (token rotated), the in-flight offline result must not clobber the
        // fresh session.
        if (!cancelled && getSessionToken() === tokenAtStart &&
            !offlineAccessAllowed(getSession()?.user, { token: tokenAtStart })) {
          revokeOfflineTrust({ reason: 'trust_expired' })
          setSession(null)
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => { cancelled = true }
  }, [applyMeUser])

  const login = useCallback(async (code) => {
    // SEC-EPIC-2 (#192): switching accounts must never surface the previous
    // account's local browsing/search/view/gamification state to the next
    // user. Capture the previous user id BEFORE the exchange overwrites it.
    const previousId = getSession()?.user?.id
    const user = await authApi.login(code)
    if (previousId && previousId !== user.id) {
      clearLocalUserData() // also clears runout.offlineTrust (see session.js)
      revokeOfflineTrust({ reason: 'account_switch' })
    }
    // The login exchange is a SUCCESSFUL ONLINE authentication — mint (or
    // refresh) the bounded offline trust for the newly authenticated user.
    establishOfflineTrust(user, { sessionFp: sessionFingerprint(getSessionToken()) })
    setSession({ user, session: getSessionToken() })
    return user
  }, [])

  const requestAccess = useCallback((payload) => authApi.requestAccess(payload), [])

  const refresh = useCallback(async () => {
    try {
      const user = await authApi.me()
      applyMeUser(user)
    } catch {
      // Offline / server error — keep the cached session only if a live trust
      // grant still exists; otherwise fail closed (S5, #53 + #162).
      if (!offlineAccessAllowed(getSession()?.user, { token: getSessionToken() })) {
        revokeOfflineTrust({ reason: 'trust_expired' })
        setSession(null)
      }
    }
  }, [applyMeUser])

  const logout = useCallback(() => {
    authApi.logout()
    revokeOfflineTrust({ reason: 'sign_out' })
    setSession(null)
    clearLocalUserData()
  }, [])

  // SEC-1.4 (#179): revoke EVERY session for this user (all devices, current
  // one included) server-side, then clear the local session + trust.
  const logoutAll = useCallback(() => {
    authApi.logoutAll()
    revokeOfflineTrust({ reason: 'sign_out_all' })
    setSession(null)
    clearLocalUserData()
  }, [])

  // Read-only: is this device currently trusted to keep the offline shell and
  // cached session for the signed-in user within the bounded window?
  const isOfflineTrusted = useCallback(
    () => offlineAccessAllowed(getSession()?.user, { token: getSessionToken() }),
    [],
  )

  return { session, ready, login, logout, logoutAll, refresh, requestAccess, setSession, isOfflineTrusted }
}
