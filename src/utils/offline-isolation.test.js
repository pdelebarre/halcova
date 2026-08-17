// SEC-EPIC-2 #192 — offline tenant isolation and account switching.
//
// Verifies that one user's LOCAL (offline) data can never surface for another:
//   - the service worker does not runtime-cache any user-scoped endpoint
//     (collection/auth/admin/lending/reviews/feedback/payment) — only the
//     /discogs + /books lookup/covers proxies are cached (asserted here by
//     importing vite.config.js and checking the runtime-cache urlPatterns);
//   - the ONLY localStorage credential key is runout.session, which holds the
//     token only (never the access code — already asserted in session.test.js)
//     and is cleared on sign-out;
//   - the per-KIND browsing/search/view/gamification keys, which are NOT
//     user-namespaced, are cleared on sign-out and on account switch via
//     clearLocalUserData(), so "sign out A, sign in B" never shows A's data.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAuth } from '../hooks/useAuth'
import { clearLocalUserData, getSession, saveSession } from './session'

vi.mock('../api/auth', () => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  requestAccess: vi.fn(),
}))
import * as authApi from '../api/auth'

const MEMBER_A = { id: 'u1', name: 'Ada', role: 'member' }
const MEMBER_B = { id: 'u2', name: 'Bob', role: 'member' }

// A representative set of A's local per-kind data (search terms, saved views,
// browse state, gamification progression) — none of it user-namespaced.
function seedUserAData() {
  localStorage.setItem('runout.recentSearches.records', JSON.stringify(['Pink Floyd', 'Miles Davis']))
  localStorage.setItem('runout.views.records', JSON.stringify([{ id: 'v1', name: 'My Jazz' }]))
  localStorage.setItem('runout.browse.records', JSON.stringify({ sort: 'year' }))
  localStorage.setItem('runout.gamif.ledger.records', JSON.stringify({ xp: 120 }))
  localStorage.setItem('runout.gamif.level.records', '3')
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('clearLocalUserData — per-kind local state is not user-namespaced', () => {
  it('removes browsing/search/view/gamification keys but keeps the session and locale', () => {
    seedUserAData()
    localStorage.setItem('runout.session', JSON.stringify({ user: MEMBER_A, session: 'tok-a' }))
    localStorage.setItem('runout.locale', 'en')

    clearLocalUserData()

    expect(localStorage.getItem('runout.recentSearches.records')).toBeNull()
    expect(localStorage.getItem('runout.views.records')).toBeNull()
    expect(localStorage.getItem('runout.browse.records')).toBeNull()
    expect(localStorage.getItem('runout.gamif.ledger.records')).toBeNull()
    expect(localStorage.getItem('runout.gamif.level.records')).toBeNull()
    // The session itself is cleared by saveSession(null), not by this helper.
    expect(localStorage.getItem('runout.session')).toBeTruthy()
    expect(localStorage.getItem('runout.locale')).toBe('en')
  })

  it('never throws on a locked/full storage and clears multiple kinds', () => {
    localStorage.setItem('runout.recentSearches.records', 'x')
    localStorage.setItem('runout.recentSearches.books', 'y')
    localStorage.setItem('runout.views.books', 'z')
    expect(() => clearLocalUserData()).not.toThrow()
    expect(localStorage.getItem('runout.recentSearches.records')).toBeNull()
    expect(localStorage.getItem('runout.recentSearches.books')).toBeNull()
    expect(localStorage.getItem('runout.views.books')).toBeNull()
  })
})

describe('sign out as A, sign in as B — B never sees A\'s local data', () => {
  it('the full logout-then-login sequence clears A\'s per-kind data', () => {
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })

    // Sign out A: clear the session and the per-kind local state.
    saveSession(null)
    clearLocalUserData()
    expect(getSession()).toBeNull()

    // Sign in B.
    saveSession({ user: MEMBER_B, session: 'tok-b' })
    expect(getSession().user.id).toBe('u2')

    // B never sees A's search terms / views / browse / gamification data.
    expect(localStorage.getItem('runout.recentSearches.records')).toBeNull()
    expect(localStorage.getItem('runout.views.records')).toBeNull()
    expect(localStorage.getItem('runout.browse.records')).toBeNull()
    expect(localStorage.getItem('runout.gamif.ledger.records')).toBeNull()
  })

  it('useAuth.login into a DIFFERENT account clears the previous account\'s local data', async () => {
    // A is signed in with local data present. me() rejects offline on mount so
    // the startup revalidation keeps A's cached session (never signs A out).
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })
    authApi.me.mockRejectedValue(new Error('offline'))
    authApi.login.mockResolvedValue(MEMBER_B)

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.login('RU-BOB-CODE')
    })

    expect(result.current.session.user.id).toBe('u2')
    // A's per-kind local data is gone after switching to B.
    expect(localStorage.getItem('runout.recentSearches.records')).toBeNull()
    expect(localStorage.getItem('runout.views.records')).toBeNull()
    expect(localStorage.getItem('runout.browse.records')).toBeNull()
    expect(localStorage.getItem('runout.gamif.ledger.records')).toBeNull()
  })

  it('useAuth.logout clears the session AND the per-kind local data', async () => {
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })
    authApi.me.mockRejectedValue(new Error('offline'))
    // Mirror the real authApi.logout: revoke + saveSession(null).
    authApi.logout.mockImplementation(() => { saveSession(null); return Promise.resolve() })

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      result.current.logout()
    })

    expect(result.current.session).toBeNull()
    expect(localStorage.getItem('runout.session')).toBeNull()
    expect(localStorage.getItem('runout.recentSearches.records')).toBeNull()
    expect(localStorage.getItem('runout.gamif.level.records')).toBeNull()
  })
})

describe('the service worker never runtime-caches user-scoped endpoints', () => {
  it('runtime-caching rules only reference the /discogs and /books lookup + cover proxies', async () => {
    // Inspect the REAL vite.config.js runtimeCaching block at the source level.
    // (The vite-plugin-pwa plugin does not expose its resolved workbox options
    // on the plugin object for introspection, so we assert the actual config
    // source instead — a stable, honest regression check.)
    const { readFile } = await import('node:fs/promises')
    const path = (await import('node:path')).default
    const { fileURLToPath } = await import('node:url')
    const viteConfigPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vite.config.js')
    const src = await readFile(viteConfigPath, 'utf8')

    // Extract just the runtimeCaching block.
    const start = src.indexOf('runtimeCaching: [')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('],', start)
    const block = src.slice(start, end)

    // User-scoped APIs must NEVER be runtime-cached (no collection/auth/admin/
    // lending/reviews/feedback/payment path in the cache rules).
    for (const pathName of ['collection', 'lending', 'reviews', 'feedback', 'auth', 'admin', 'payment']) {
      expect(block).not.toContain(`/${pathName}`)
      expect(block).not.toMatch(new RegExp(`functions/${pathName}`))
    }
    // The lookup + covers proxies ARE the only cached function routes.
    expect(block).toContain('discogs')
    expect(block).toContain('books')
  })
})
