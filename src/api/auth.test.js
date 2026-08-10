import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as auth from './auth'
import { getSession, saveSession } from '../utils/session'

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

const MEMBER = { id: 'u1', name: 'Ada', role: 'member', collections: { records: true, books: false } }

describe('auth API', () => {
  beforeEach(() => {
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

  it('logs in with a code and persists the session', async () => {
    global.fetch.mockResolvedValue(res(200, { user: MEMBER }))
    const user = await auth.login('RU-AAAA-BBBB-CCCC')
    expect(user).toEqual(MEMBER)
    expect(getSession()).toEqual({ user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' })
    const [, init] = global.fetch.mock.calls[0]
    // Logging in is pre-auth — the code travels in the body, not as a header.
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('stores the canonical code returned by the server', async () => {
    // The server returns the exact code to store (admin key / uppercase member
    // code) so a code typed in lowercase still authenticates later calls.
    global.fetch.mockResolvedValue(res(200, { user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' }))
    await auth.login('ru-aaaa-bbbb-cccc')
    expect(getSession()).toEqual({ user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' })
  })

  it('surfaces the server error when a code is rejected', async () => {
    global.fetch.mockResolvedValue(res(401, { error: "That access code isn't recognized." }))
    await expect(auth.login('RU-NOPE')).rejects.toThrow("That access code isn't recognized.")
  })

  it('me() returns the user and refreshes the cached session', async () => {
    saveSession({ user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' })
    global.fetch.mockResolvedValue(res(200, { user: { ...MEMBER, name: 'Ada Lovelace' } }))
    const user = await auth.me()
    expect(user.name).toBe('Ada Lovelace')
    expect(getSession().user.name).toBe('Ada Lovelace')
  })

  it('me() signs out when the code is no longer valid (401)', async () => {
    saveSession({ user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' })
    global.fetch.mockResolvedValue(res(401, { error: 'Not signed in.' }))
    expect(await auth.me()).toBeNull()
    expect(getSession()).toBeNull()
  })

  it('me() keeps the cached session when the network fails', async () => {
    saveSession({ user: MEMBER, code: 'RU-AAAA-BBBB-CCCC' })
    global.fetch.mockResolvedValue(res(500, { error: 'offline' }))
    await expect(auth.me()).rejects.toThrow('offline')
    expect(getSession()).not.toBeNull()
  })

  it('adminList sends the admin key as Bearer', async () => {
    saveSession({ user: { id: 'owner', role: 'admin' }, code: 'super-secret-admin' })
    global.fetch.mockResolvedValue(res(200, { requests: [], users: [] }))
    const data = await auth.adminList()
    expect(data).toEqual({ requests: [], users: [] })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/admin')
    expect(init.headers.Authorization).toBe('Bearer super-secret-admin')
  })

  it('adminApprove approves a request and returns the generated code', async () => {
    saveSession({ user: { id: 'owner', role: 'admin' }, code: 'super-secret-admin' })
    global.fetch.mockResolvedValue(res(201, { user: MEMBER, code: 'RU-1111-2222-3333' }))
    const out = await auth.adminApprove({ requestId: 'req-1', collections: { records: true, books: false } })
    expect(out.code).toBe('RU-1111-2222-3333')
    const [, init] = global.fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      action: 'approve',
      requestId: 'req-1',
      collections: { records: true, books: false },
    })
  })
})
