import { beforeEach, describe, expect, it } from 'vitest'
import { getSession, getSessionToken, getUserId, saveSession } from './session'

const KEY = 'runout.session'

beforeEach(() => {
  localStorage.clear()
})

describe('session persistence — token only, never the access code (SEC-1.2, #177)', () => {
  it('persists { user, session } and reads the token back', () => {
    saveSession({ user: { id: 'u1', name: 'Ada' }, session: 'tok-abc123' })
    expect(getSession()).toEqual({ user: { id: 'u1', name: 'Ada' }, session: 'tok-abc123' })
    expect(getSessionToken()).toBe('tok-abc123')
    expect(getUserId()).toBe('u1')
  })

  it('stores NO access code in localStorage after a login-shaped save', () => {
    saveSession({ user: { id: 'u1' }, session: 'tok-abc123' })
    const raw = localStorage.getItem(KEY)
    expect(raw).toContain('tok-abc123')
    // #177: the access code / admin key / demo code must never be persisted.
    expect(raw).not.toContain('RU-')
    expect(raw).not.toContain('code')
  })

  it('returns an empty token for a legacy { user, code } session (never uses the code as a credential)', () => {
    // A session persisted before the migration holds the access code — it must
    // not be usable as a session token; the client treats it as signed-out.
    localStorage.setItem(KEY, JSON.stringify({ user: { id: 'u1' }, code: 'RU-AAAA-BBBB-CCCC' }))
    expect(getSessionToken()).toBe('')
    // And the stale credential is still present — me() will clear it on 401.
    expect(getSession()?.code).toBe('RU-AAAA-BBBB-CCCC')
  })

  it('saveSession(null) clears the session', () => {
    saveSession({ user: { id: 'u1' }, session: 'tok-abc123' })
    saveSession(null)
    expect(getSession()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('tolerates corrupt JSON', () => {
    localStorage.setItem(KEY, '{not valid json')
    expect(getSession()).toBeNull()
    expect(getSessionToken()).toBe('')
  })
})
