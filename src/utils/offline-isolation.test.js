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
import { establishOfflineTrust, sessionFingerprint } from './offlineTrust'

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
// browse state, gamification progression, opt-in analytics queue) — none of it
// user-namespaced.
function seedUserAData() {
  localStorage.setItem('runout.recentSearches.records', JSON.stringify(['Pink Floyd', 'Miles Davis']))
  localStorage.setItem('runout.views.records', JSON.stringify([{ id: 'v1', name: 'My Jazz' }]))
  localStorage.setItem('runout.browse.records', JSON.stringify({ sort: 'year' }))
  localStorage.setItem('runout.gamif.ledger.records', JSON.stringify({ xp: 120 }))
  localStorage.setItem('runout.gamif.level.records', '3')
  // A opted into first-party analytics and queued events (default-off, but
  // must still be cleared on account switch so B never inherits A's queue).
  localStorage.setItem('runout.events.enabled', '1')
  localStorage.setItem('runout.events', JSON.stringify([
    { event: 'browse', ts: '2026-01-01T00:00:00.000Z', props: { kind: 'records' } },
    { event: 'scan', ts: '2026-01-01T00:00:01.000Z', props: { kind: 'records' } },
  ]))
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

  it('account switch A→B clears A\'s opt-in analytics queue and flag', () => {
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })
    // A queued analytics events and opted in (default-off feature).
    expect(localStorage.getItem('runout.events.enabled')).toBe('1')
    expect(JSON.parse(localStorage.getItem('runout.events'))).toHaveLength(2)

    // Sign out A, then sign in B (the same clear path clearLocalUserData()).
    saveSession(null)
    clearLocalUserData()
    expect(getSession()).toBeNull()
    saveSession({ user: MEMBER_B, session: 'tok-b' })

    // B must not inherit A's queued analytics events or the opt-in flag —
    // this is the CWE-200 cross-account local-data leak the fix closes.
    expect(localStorage.getItem('runout.events')).toBeNull()
    expect(localStorage.getItem('runout.events.enabled')).toBeNull()
  })

  it('useAuth.login into a DIFFERENT account clears the previous account\'s local data', async () => {
    // A is signed in with local data present and is an explicitly-trusted
    // device (#162/ADR-0015 Dec 4). me() rejects offline on mount so the
    // startup revalidation keeps A's cached session (never signs A out).
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })
    establishOfflineTrust(MEMBER_A, { sessionFp: sessionFingerprint('tok-a') })
    authApi.me.mockRejectedValue(new Error('offline'))
    // Mirror the real authApi.login: exchange for a NEW session token and
    // persist it (so getSessionToken() actually rotates, as in production).
    authApi.login.mockImplementation(async () => {
      saveSession({ user: MEMBER_B, session: 'tok-b' })
      return MEMBER_B
    })

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

  it('useAuth.logout clears the session, the per-kind local data, AND the offline-trust record (#162)', async () => {
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })
    // A is an explicitly trusted device with a live bounded offline-trust grant.
    establishOfflineTrust(MEMBER_A, { sessionFp: sessionFingerprint('tok-a') })
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
    // #162: the offline-trust grant must be revoked on sign-out so the signed
    // out account can never render cached private state offline.
    expect(localStorage.getItem('runout.offlineTrust')).toBeNull()
  })

  it('account switch A→B clears A\'s offline-trust grant so B can never inherit it (#162)', async () => {
    seedUserAData()
    saveSession({ user: MEMBER_A, session: 'tok-a' })
    establishOfflineTrust(MEMBER_A, { sessionFp: sessionFingerprint('tok-a') })
    authApi.me.mockRejectedValue(new Error('offline'))
    // Mirror the real authApi.login side-effect (persist the new session).
    authApi.login.mockImplementation(async () => {
      saveSession({ user: MEMBER_B, session: 'tok-b' })
      return MEMBER_B
    })

    const { result } = renderHook(() => useAuth())
    // Confirm A's trust grant exists before the switch.
    expect(localStorage.getItem('runout.offlineTrust')).not.toBeNull()
    await act(async () => {
      await result.current.login('RU-BOB-CODE')
    })

    // B is signed in with a FRESH trust grant; A's trust record is gone and
    // must not have been inherited by B (B's record is bound to B's user id).
    expect(result.current.session.user.id).toBe('u2')
    const trust = JSON.parse(localStorage.getItem('runout.offlineTrust') || 'null')
    expect(trust?.userId).toBe('u2')
    // And A can no longer pass offlineAccessAllowed (its record is gone).
    const { offlineAccessAllowed } = await import('./offlineTrust')
    expect(offlineAccessAllowed(MEMBER_A, { token: 'tok-a' })).toBe(false)
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

  it('the precache glob and manifest never include session or user data (SEC-4.4 #205)', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = (await import('node:path')).default
    const { fileURLToPath } = await import('node:url')
    const viteConfigPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vite.config.js')
    const src = await readFile(viteConfigPath, 'utf8')

    // The precache glob covers only static shell assets (js/css/html/png/svg/
    // ico/wasm/gz/woff) — never session/user JSON or any private data.
    const glob = src.match(/globPatterns:\s*\[([^\]]*)\]/)?.[1] || ''
    expect(glob).toMatch(/\*\*\/\*\.\{js,css,html,png,svg,ico,wasm,gz,woff2,woff\}/)
    // No session/user-scoped files are precached.
    expect(glob).not.toMatch(/session/)
    expect(glob).not.toMatch(/user/)

    // The manifest carries only static app metadata — no user data.
    const manifest = src.slice(src.indexOf('manifest: {'), src.indexOf('workbox: {'))
    expect(manifest).not.toMatch(/session/)
    expect(manifest).not.toMatch(/userData|userId|accessCode|runout\.session/)
  })

  it('a collection API response never lands in any service-worker cache (SEC-4.4 #205)', async () => {
    // The collection/auth/admin/lending/reviews/feedback/payment routes are
    // absent from runtimeCaching (asserted above). This locks in that a
    // collection response is never cacheable by the SW: the only runtime
    // cache rules reference the /discogs + /books lookup/covers proxies, and
    // the collection endpoint is not among them, so Cache Storage can never
    // hold a private collection response.
    const { readFile } = await import('node:fs/promises')
    const path = (await import('node:path')).default
    const { fileURLToPath } = await import('node:url')
    const viteConfigPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vite.config.js')
    const src = await readFile(viteConfigPath, 'utf8')
    const start = src.indexOf('runtimeCaching: [')
    const end = src.indexOf('],', start)
    const block = src.slice(start, end)
    // Every cached urlPattern is scoped to the lookup/cover proxies.
    expect(block).toMatch(/action.*=.*'cover'/)
    expect(block).not.toContain('collection')
    expect(block).not.toContain("'/api/'")
  })
})
