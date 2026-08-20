import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth'
import { saveSession, getSessionToken } from '../utils/session'
import { establishOfflineTrust, sessionFingerprint } from '../utils/offlineTrust'

// Mock the auth API module so refresh() exercises the real session handling
// without any network (same pattern as useCollection.test.js).
vi.mock('../api/auth', () => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  requestAccess: vi.fn(),
}))

import * as authApi from '../api/auth'

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  role: 'member',
  collections: { records: true, books: false },
}
const SESSION = { user: MEMBER, session: 'tok-session-abc123' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAuth.refresh', () => {
  it('keeps the cached session when me() throws (offline)', async () => {
    saveSession(SESSION)
    // #162 / ADR-0019 Dec 4: offline keep requires a device that was previously
    // authenticated ONLINE and explicitly trusted. Model a trusted device by
    // establishing the bounded offline-trust grant for this session first.
    establishOfflineTrust(MEMBER, { sessionFp: sessionFingerprint(SESSION.session) })
    authApi.me.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useAuth())
    // Startup revalidation also fails offline — the shell must keep working.
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.refresh()
    })

    // Offline revalidation must NOT sign the user out (S5, #53) while the
    // device still holds a live bounded trust grant.
    expect(result.current.session).toEqual(SESSION)
  })

  it('signs the user out on offline when the bounded trust grant is absent/expired (fail closed, #162)', async () => {
    // A cached session WITHOUT a trust grant (e.g. trust expired or this device
    // was never explicitly trusted) must NOT keep the shell offline — the
    // cached private state fails closed.
    saveSession(SESSION)
    authApi.me.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.session).toBeNull()
  })

  it('clears the session when me() resolves null (revoked/disabled)', async () => {
    saveSession(SESSION)
    authApi.me.mockResolvedValue(null)

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.refresh()
    })

    // A resolved null (401/403 → revoked/disabled) still signs the user out.
    expect(result.current.session).toBeNull()
  })

  it('keeps the cached code and updates the user when me() resolves a fresh profile (post-upgrade)', async () => {
    saveSession(SESSION)
    // The user just upgraded: the server now reports plan premium.
    authApi.me.mockResolvedValue({ ...MEMBER, plan: 'premium' })

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.refresh()
    })

    // The refreshed profile replaced the stale cached one; the token survived.
    expect(result.current.session.user.plan).toBe('premium')
    expect(result.current.session.session).toBe('tok-session-abc123')
  })

  it('revalidates the cached session on mount when me() resolves a user', async () => {
    saveSession(SESSION)
    authApi.me.mockResolvedValue({ ...MEMBER, plan: 'lifetime' })

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    // The startup revalidation pulled the freshest plan into the session.
    expect(result.current.session.user.plan).toBe('lifetime')
    expect(result.current.session.session).toBe('tok-session-abc123')
  })

  it('does NOT resurrect the session when a stale me() 200 resolves while the persisted token is STILL present after logout (TOCTOU, SEC-5.2 #376)', async () => {
    saveSession(SESSION)
    let resolveMe
    authApi.me.mockReturnValue(new Promise((resolve) => { resolveMe = resolve }))

    const { result } = renderHook(() => useAuth())
    // me() is in flight. The user signs out. CRITICAL: we model the real
    // TOCTOU race — the persisted token is STILL present because
    // authApi.logout() clears it only AFTER an awaited network call, and here
    // that network call has not completed. We must NOT call saveSession(null).
    // (This is the race the previous happy-path test did not cover.)
    act(() => {
      result.current.logout()
    })
    // The persisted token is still present; the token-only rotate-guard would
    // see old==old and pass. The session generation changed on logout instead.
    expect(result.current.session).toBeNull()
    expect(getSessionToken()).toBe('tok-session-abc123')

    // The stale in-flight me() now resolves 200 with a (cached-profile) user
    // while the persisted token is still present. The generation guard must
    // discard it — it must NOT setSession and resurrect the signed-out profile.
    await act(async () => { resolveMe({ ...MEMBER, plan: 'premium' }) })

    // Session stays null; no resurrection, no stale user profile.
    expect(result.current.session).toBeNull()
  })

  it('does NOT let a stale me() 200 resurrect the previous account over the new session (account switch, SEC-5.2 #376)', async () => {
    saveSession(SESSION)
    let resolveMe
    authApi.me.mockReturnValue(new Promise((resolve) => { resolveMe = resolve }))
    authApi.login.mockResolvedValue({ id: 'u2', name: 'Grace', role: 'member', collections: {} })

    const { result } = renderHook(() => useAuth())
    // me() for the ORIGINAL (u1) session is in flight; meanwhile the user signs
    // in to a DIFFERENT account (u2). The switch bumps the session generation,
    // so the in-flight me() for the previous account must be discarded instead
    // of clobbering the new account's session.
    await act(async () => {
      await result.current.login('code-b')
    })

    // Now the stale in-flight me() for u1 resolves 200 with u1's cached profile.
    // The generation guard must discard it — the new u2 session stays put.
    await act(async () => { resolveMe({ ...MEMBER, id: 'u1', name: 'Ada' }) })

    expect(result.current.session.user.id).toBe('u2')
    expect(result.current.session.user.name).toBe('Grace')
  })

  it('signs the user out on logout', async () => {
    saveSession(SESSION)
    authApi.me.mockResolvedValue({ ...MEMBER }) // keep the startup effect quiet

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => {
      result.current.logout()
    })

    expect(authApi.logout).toHaveBeenCalled()
    expect(result.current.session).toBeNull()
  })

  it('signs the user out of ALL devices on logoutAll (SEC-1.4)', async () => {
    saveSession(SESSION)
    authApi.me.mockResolvedValue({ ...MEMBER }) // keep the startup effect quiet

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => {
      result.current.logoutAll()
    })

    expect(authApi.logoutAll).toHaveBeenCalled()
    expect(result.current.session).toBeNull()
  })
})
