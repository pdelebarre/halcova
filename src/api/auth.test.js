import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as auth from './auth'
import { getSession, saveSession } from '../utils/session'

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

const MEMBER = { id: 'u1', name: 'Ada', role: 'member', collections: { records: true, books: false } }
const ADMIN_TOKEN = 'tok-admin-session-abc123'
const MEMBER_TOKEN = 'tok-member-session-xyz789'

describe('auth API', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = vi.fn()
  })

  it('creates a pending access request', async () => {
    global.fetch.mockResolvedValue(res(201, { ok: true }))
    await auth.requestAccess({ name: 'Ada', email: 'ada@example.com' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/auth')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ action: 'request', name: 'Ada', email: 'ada@example.com' })
  })

  it('logs in with a code and persists ONLY the opaque session token — never the code (SEC-1.2)', async () => {
    global.fetch.mockResolvedValue(res(200, { user: MEMBER, session: MEMBER_TOKEN }))
    const user = await auth.login('RU-AAAA-BBBB-CCCC')
    expect(user).toEqual(MEMBER)
    expect(getSession()).toEqual({ user: MEMBER, session: MEMBER_TOKEN })
    // #177: the access code must never land in localStorage.runout.session.
    expect(localStorage.getItem('runout.session')).not.toContain('RU-')
    expect(localStorage.getItem('runout.session')).not.toContain('AAAA')
    const [, init] = global.fetch.mock.calls[0]
    // Logging in is pre-auth — the code travels in the body, not as a header.
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('does not fall back to persisting a code when the server omits a session', async () => {
    // A misbehaving/old server returning `code` instead of `session` must not
    // be persisted as a credential — the code is only an exchange credential.
    global.fetch.mockResolvedValue(res(200, { user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' }))
    await auth.login('ru-aaaa-bbbb-cccc')
    expect(getSession()).toEqual({ user: MEMBER, session: undefined })
    expect(localStorage.getItem('runout.session')).not.toContain('RU-')
  })

  it('surfaces the server error when a code is rejected', async () => {
    global.fetch.mockResolvedValue(res(401, { error: "That access code isn't recognized." }))
    await expect(auth.login('RU-NOPE')).rejects.toThrow("That access code isn't recognized.")
  })

  it('me() returns the user and refreshes the cached session', async () => {
    saveSession({ user: MEMBER, session: MEMBER_TOKEN })
    global.fetch.mockResolvedValue(res(200, { user: { ...MEMBER, name: 'Ada Lovelace' }, session: MEMBER_TOKEN }))
    const user = await auth.me()
    expect(user.name).toBe('Ada Lovelace')
    expect(getSession().user.name).toBe('Ada Lovelace')
    expect(getSession().session).toBe(MEMBER_TOKEN)
  })

  it('me() signs out when the session token is no longer valid (401)', async () => {
    saveSession({ user: MEMBER, session: MEMBER_TOKEN })
    global.fetch.mockResolvedValue(res(401, { error: 'Not signed in.' }))
    expect(await auth.me()).toBeNull()
    expect(getSession()).toBeNull()
  })

  it('me() keeps the cached session when the network fails', async () => {
    saveSession({ user: MEMBER, session: MEMBER_TOKEN })
    global.fetch.mockResolvedValue(res(500, { error: 'offline' }))
    await expect(auth.me()).rejects.toThrow('offline')
    expect(getSession()).not.toBeNull()
  })

  it('logout() revokes the session server-side then clears local storage (SEC-1.9)', async () => {
    saveSession({ user: MEMBER, session: MEMBER_TOKEN })
    global.fetch.mockResolvedValue(res(200, { ok: true }))
    await auth.logout()
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/auth')
    expect(JSON.parse(init.body)).toEqual({ action: 'logout' })
    expect(init.headers.Authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
    expect(getSession()).toBeNull()
  })

  it('logout() clears local storage even when the revocation call fails (offline)', async () => {
    saveSession({ user: MEMBER, session: MEMBER_TOKEN })
    global.fetch.mockRejectedValue(new Error('offline'))
    await auth.logout()
    expect(getSession()).toBeNull()
  })

  it('adminList sends the owner admin session as Bearer', async () => {
    saveSession({ user: { id: 'owner', role: 'admin' }, session: ADMIN_TOKEN })
    global.fetch.mockResolvedValue(res(200, { requests: [], users: [] }))
    const data = await auth.adminList()
    expect(data).toEqual({ requests: [], users: [] })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/admin')
    expect(init.headers.Authorization).toBe(`Bearer ${ADMIN_TOKEN}`)
  })

  it('adminApprove approves a request and returns the generated code (not persisted)', async () => {
    saveSession({ user: { id: 'owner', role: 'admin' }, session: ADMIN_TOKEN })
    global.fetch.mockResolvedValue(res(201, { user: MEMBER, code: 'RU-1111-2222-3333' }))
    const out = await auth.adminApprove({ requestId: 'req-1', collections: { records: true, books: false } })
    expect(out.code).toBe('RU-1111-2222-3333')
    // The returned code is shown once in the UI but never stored as a session.
    expect(localStorage.getItem('runout.session')).not.toContain('RU-1111')
    const [, init] = global.fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      action: 'approve',
      requestId: 'req-1',
      collections: { records: true, books: false },
    })
  })

  it('adminRotate mints a new code for a member and sends the admin session as Bearer', async () => {
    saveSession({ user: { id: 'owner', role: 'admin' }, session: ADMIN_TOKEN })
    global.fetch.mockResolvedValue(res(200, { user: MEMBER, code: 'RU-7777-6666-5555' }))
    const out = await auth.adminRotate({ userId: 'u1' })
    expect(out.code).toBe('RU-7777-6666-5555')
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/admin')
    expect(init.headers.Authorization).toBe(`Bearer ${ADMIN_TOKEN}`)
    expect(JSON.parse(init.body)).toEqual({ action: 'rotate', userId: 'u1' })
  })
})
