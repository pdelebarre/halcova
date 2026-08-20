import { useCallback, useEffect, useState } from 'react'
import * as authApi from '../api/auth'
import { getSession, getSessionToken, clearLocalUserData } from '../utils/session'
import {
  establishOfflineTrust,
  offlineAccessAllowed,
  revalidateOfflineTrust,
  revokeOfflineTrust,
  sessionFingerprintAsync,
} from '../utils/offlineTrust'
import { clearAllMirror } from '../utils/offlineMirror'
import { clearAllOutbox } from '../utils/outbox'

// Owns the signed-in session. Persists to localStorage (runout.session) so
// the PWA remembers you between visits, and revalidates the code against the
// server on startup — a disabled/revoked account is signed out, while an
// offline launch keeps a TRUSTED cached session so the shell still works.
//
// #162 / ADR-0019 Dec 4: offline access is limited to a device that was
// previously authenticated ONLINE and explicitly trusted (see
// src/utils/offlineTrust.js). The trust record never contains the session
// token or access code; it has a bounded expiry and is extended ONLY on a
// successful online revalidation (`me()` success). A stale or expired trust
// record fails closed — the shell cannot extend offline access indefinitely.

// SEC-5.2 (#376) session-generation counter (TOCTOU close). `authApi.logout()`
// clears the persisted token only AFTER an awaited network call, so during that
// window `getSessionToken()` still returns the OLD token. If an in-flight
// `me()` resolves 200 in that window, a guard that only compares
// `getSessionToken() !== tokenAtStart` would see old==old and resurrect a
// signed-out cached profile. We therefore bump a monotonic generation counter
// synchronously on logout / logout-all / account-switch, capture it when a
// revalidation STARTS, and discard the resolve if the generation changed by the
// time it commits — even when the persisted token is still present.
let sessionGeneration = 0
function bumpSessionGeneration() { sessionGeneration += 1 }

export function useAuth() {
  const [session, setSession] = useState(() => getSession())
  const [ready, setReady] = useState(false)

  // Apply the result of a successful online `me()` revalidation: extend the
  // bounded offline trust for the (resolved, server-authenticated) user. If
  // me() resolves `null` (revoked / disabled / expired — 401/403), the trust
  // record is revoked and the session is cleared.
  //
  // SEC-5.2 (#376) rotate-guard (defense-in-depth): an in-flight `me()` success
  // that resolves AFTER a sign-out / token rotation must not resurrect a stale
  // session (previously `setSession({ user, session: '' })` briefly remounted
  // the shell with the user's own cached profile). We capture the session
  // generation and token at the START of the revalidation, compute the SHA-256
  // session fingerprint from the token, and only commit if BOTH the token is
  // unchanged AND the generation is unchanged. Otherwise the result is
  // discarded and the (already-cleared) session fails closed.
  //
  // The generation check is what closes the logout TOCTOU: `authApi.logout()`
  // clears the persisted token only after an awaited network call, so during
  // that window `getSessionToken()` still returns the old token and a token-only
  // guard (old==old) would pass. The generation is bumped synchronously on
  // sign-out, so an in-flight `me()` that started before the sign-out always
  // commits against a changed generation and is discarded.
  const applyMeUser = useCallback(async (user, genAtStart, tokenAtStart) => {
    if (!user) {
      revokeOfflineTrust({ reason: 'session_invalid' })
      setSession(null)
      return
    }
    // The session generation was captured when this revalidation STARTED. If
    // it changed (a sign-out / switch happened while me() was in flight), the
    // stale 200 must not resurrect the signed-out profile.
    if (sessionGeneration !== genAtStart) return
    if (!tokenAtStart) return
    const sessionFp = await sessionFingerprintAsync(tokenAtStart)
    if (getSessionToken() !== tokenAtStart || sessionGeneration !== genAtStart) return
    // Only extend trust that ALREADY exists for this user (an online
    // revalidation reinforces an established grant; it never mints trust for
    // an identity that wasn't authenticated through a full login first).
    revalidateOfflineTrust(user, { sessionFp })
    setSession({ user, session: tokenAtStart })
  }, [])

  useEffect(() => {
    let cancelled = false
    const genAtStart = sessionGeneration
    const tokenAtStart = getSessionToken()
    if (!getSession()) {
      setReady(true)
      return
    }
    authApi.me()
      .then((user) => {
        if (!cancelled) applyMeUser(user, genAtStart, tokenAtStart)
      })
      .catch(async () => {
        // Offline — keep the cached session ONLY if this device still holds a
        // live, bounded offline-trust grant for the cached user (fail-closed:
        // expired/absent trust means we do NOT render cached private state).
        //
        // Guard: only fail closed when the session token AND generation are
        // UNCHANGED since this me() started. If the user logged in /
        // re-established meanwhile (token rotated), the in-flight offline
        // result must not clobber the fresh session.
        if (cancelled || sessionGeneration !== genAtStart || getSessionToken() !== tokenAtStart) return
        if (!(await offlineAccessAllowed(getSession()?.user, { token: tokenAtStart }))) {
          if (!cancelled) {
            revokeOfflineTrust({ reason: 'trust_expired' })
            setSession(null)
          }
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
      // Account switch: bump the generation so any in-flight revalidation from
      // the PREVIOUS session cannot resurrect the old account's profile.
      bumpSessionGeneration()
      clearLocalUserData() // also clears runout.offlineTrust (see session.js)
      revokeOfflineTrust({ reason: 'account_switch' })
      // ADR-0019 Dec 5: clear the previous account's offline mirror so no
      // user's private collection data survives an account switch.
      clearAllMirror()
      // M2 #292: clear the previous account's outbox so its queued mutations
      // can never be pushed by (or surfaced to) the next account.
      clearAllOutbox()
    }
    // The login exchange is a SUCCESSFUL ONLINE authentication — mint (or
    // refresh) the bounded offline trust for the newly authenticated user.
    const sessionFp = await sessionFingerprintAsync(getSessionToken())
    establishOfflineTrust(user, { sessionFp })
    setSession({ user, session: getSessionToken() })
    return user
  }, [])

  const requestAccess = useCallback((payload) => authApi.requestAccess(payload), [])

  const refresh = useCallback(async () => {
    const genAtStart = sessionGeneration
    const tokenAtStart = getSessionToken()
    try {
      const user = await authApi.me()
      applyMeUser(user, genAtStart, tokenAtStart)
    } catch {
      // Offline / server error — keep the cached session only if a live trust
      // grant still exists; otherwise fail closed (S5, #53 + #162).
      if (sessionGeneration !== genAtStart || getSessionToken() !== tokenAtStart) return
      if (!(await offlineAccessAllowed(getSession()?.user, { token: tokenAtStart }))) {
        revokeOfflineTrust({ reason: 'trust_expired' })
        setSession(null)
      }
    }
  }, [applyMeUser])

  const logout = useCallback(() => {
    // Synchronously invalidate the current session generation BEFORE/independent
    // of the fire-and-forget network revoke, so an in-flight `me()` that started
    // earlier cannot resurrect the signed-out session once it resolves 200 —
    // even while the persisted token is still present (authApi.logout() clears
    // it only after its awaited network call).
    bumpSessionGeneration()
    authApi.logout()
    revokeOfflineTrust({ reason: 'sign_out' })
    setSession(null)
    clearLocalUserData()
    // ADR-0019 Dec 5: on sign-out, clear the offline mirror so the signed-out
    // account's private collection data does not remain on this device.
    clearAllMirror()
    // M2 #292: clear the outbox so the signed-out account's queued mutations
    // do not remain on this device.
    clearAllOutbox()
  }, [])

  // SEC-1.4 (#179): revoke EVERY session for this user (all devices, current
  // one included) server-side, then clear the local session + trust.
  const logoutAll = useCallback(() => {
    bumpSessionGeneration()
    authApi.logoutAll()
    revokeOfflineTrust({ reason: 'sign_out_all' })
    setSession(null)
    clearLocalUserData()
    // ADR-0019 Dec 5: logout-all clears every user's local private data.
    clearAllMirror()
    // M2 #292: logout-all clears every user's queued outbox mutations.
    clearAllOutbox()
  }, [])

  // Read-only: is this device currently trusted to keep the offline shell and
  // cached session for the signed-in user within the bounded window?
  const isOfflineTrusted = useCallback(
    async () => offlineAccessAllowed(getSession()?.user, { token: getSessionToken() }),
    [],
  )

  return { session, ready, login, logout, logoutAll, refresh, requestAccess, setSession, isOfflineTrusted }
}
