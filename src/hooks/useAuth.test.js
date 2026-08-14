import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth'
import { saveSession } from '../utils/session'

// Mock the auth API module so refresh() exercises the real session handling
// without any network (same pattern as useCollection.test.js).
vi.mock('../api/auth', () => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  requestAccess: vi.fn(),
}))

import * as authApi from '../api/auth'

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  role: 'member',
  collections: { records: true, books: false },
}
const SESSION = { user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAuth.refresh', () => {
  it('keeps the cached session when me() throws (offline)', async () => {
    saveSession(SESSION)
    authApi.me.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useAuth())
    // Startup revalidation also fails offline — the shell must keep working.
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.refresh()
    })

    // Offline revalidation must NOT sign the user out (S5, #53).
    expect(result.current.session).toEqual(SESSION)
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

    // The refreshed profile replaced the stale cached one; the code survived.
    expect(result.current.session.user.plan).toBe('premium')
    expect(result.current.session.code).toBe('RU-AAAA-BBBB-CCCC')
  })

  it('revalidates the cached session on mount when me() resolves a user', async () => {
    saveSession(SESSION)
    authApi.me.mockResolvedValue({ ...MEMBER, plan: 'lifetime' })

    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.ready).toBe(true))

    // The startup revalidation pulled the freshest plan into the session.
    expect(result.current.session.user.plan).toBe('lifetime')
    expect(result.current.session.code).toBe('RU-AAAA-BBBB-CCCC')
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
})
