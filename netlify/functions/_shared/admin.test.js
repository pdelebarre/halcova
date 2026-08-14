// @vitest-environment node
//
// Admin-function tests (netlify/functions/admin.js) for Part B: access-code
// hashing + rotation. The identity `_shared/users` facade is mocked as an
// in-memory map; `_shared/auth` is real (so generateAccessCode / publicUser are
// the real ones). Covers:
//   - GET never emits `code` or `code_hash` for any user (publicUser strips both)
//   - POST `rotate` mints a NEW code, persists it via saveUser, returns it once
//     in the response ({ user, code } — same shape as approve), and the old
//     semantics (re-reveal from plaintext) are gone
//   - approve still returns { user, code } with the code only top-level

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { KNOWN_FEATURES, sanitizeFeatures } from '../admin'
import { ADMIN_KEY } from './auth'

const usersMock = vi.hoisted(() => ({
  listUsers: vi.fn(async () => []),
  listRequests: vi.fn(async () => []),
  getUser: vi.fn(async () => null),
  saveUser: vi.fn(async (u) => u),
  saveRequest: vi.fn(async (r) => r),
  getRequest: vi.fn(async () => null),
  removeUserRecord: vi.fn(async () => true),
  removeRequest: vi.fn(async () => true),
  deleteUserCollections: vi.fn(async () => {}),
}))

vi.mock('./users', () => usersMock)

const MEMBER = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  code: 'RU-AAAA-BBBB-CCCC',
  collections: { records: true, books: true },
  features: {},
  plan: 'free',
  role: 'member',
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
}

const CODE_RE = /^RU-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/

function req(method, body) {
  return {
    method,
    url: 'http://localhost/.netlify/functions/admin',
    headers: { get: (k) => (String(k).toLowerCase() === 'authorization' ? `Bearer ${ADMIN_KEY}` : null) },
    json: async () => body,
  }
}

async function post(body) {
  return handler(req('POST', body))
}

beforeEach(() => {
  for (const fn of Object.values(usersMock)) fn.mockClear()
  usersMock.listUsers.mockResolvedValue([])
  usersMock.listRequests.mockResolvedValue([])
  usersMock.getUser.mockResolvedValue(null)
  usersMock.saveUser.mockImplementation(async (u) => u)
  usersMock.getRequest.mockResolvedValue(null)
})

describe('GET /admin — the member list never leaks codes or hashes', () => {
  it('strips code AND code_hash from every listed user (Part B)', async () => {
    usersMock.listUsers.mockResolvedValue([MEMBER, { ...MEMBER, id: 'u2', code: 'RU-BBBB-CCCC-DDDD', code_hash: 'deadbeef' }])
    const res = await handler(req('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    for (const u of body.users) {
      expect(u).not.toHaveProperty('code')
      expect(u).not.toHaveProperty('code_hash')
    }
    expect(body.users[0]).toMatchObject({ id: 'u1', name: 'Ada' })
  })
})

describe('POST rotate — a lost code is rotated, not re-revealed', () => {
  it('mints a new RU-… code, persists it, and returns it exactly once in { user, code }', async () => {
    usersMock.getUser.mockResolvedValue(MEMBER)
    const res = await post({ action: 'rotate', userId: 'u1' })
    expect(res.status).toBe(200)
    const body = await res.json()

    // The new code is a real RU-… code, different from the old one.
    expect(body.code).toMatch(CODE_RE)
    expect(body.code).not.toBe(MEMBER.code)
    // The code appears ONLY at the top level — never on the user object.
    expect(body.user).toMatchObject({ id: 'u1', name: 'Ada' })
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('code_hash')

    // saveUser persisted the new plaintext code (the Postgres path hashes it;
    // the Blobs mirror keeps it for read-through) — the member record changed.
    expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
    const saved = usersMock.saveUser.mock.calls[0][0]
    expect(saved.code).toBe(body.code)
    expect(saved.code).not.toBe(MEMBER.code)
  })

  it('rejects when the user is missing, unknown, or the owner', async () => {
    expect((await post({ action: 'rotate' })).status).toBe(400)
    expect((await post({ action: 'rotate', userId: 'nope' })).status).toBe(404)
    expect((await post({ action: 'rotate', userId: 'owner' })).status).toBe(400)
    expect(usersMock.saveUser).not.toHaveBeenCalled()
  })
})

describe('POST approve — still returns the generated code once (shape preserved)', () => {
  it('approves a pending request and returns { user, code } with the code top-level only', async () => {
    const request = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T09:00:00.000Z' }
    usersMock.getRequest.mockResolvedValue(request)
    const res = await post({ action: 'approve', requestId: 'r1', collections: { records: true, books: false } })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.code).toMatch(CODE_RE)
    expect(body.user).not.toHaveProperty('code')
    expect(body.user).not.toHaveProperty('code_hash')
    expect(body.user.collections).toEqual({ records: true, books: false })
    // The approved member was persisted with the generated code (hash stored
    // by the Postgres repo; the Blobs mirror keeps plaintext for read-through).
    expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
    expect(usersMock.saveUser.mock.calls[0][0].code).toBe(body.code)
  })
})

describe('auth guard & unknown actions', () => {
  it('401s without the admin key and 400s on an unknown action', async () => {
    const res = await handler({ ...req('POST', { action: 'nope' }), headers: { get: () => null } })
    expect(res.status).toBe(401)
    expect((await post({ action: 'nope' })).status).toBe(400)
  })
})

describe('per-account feature flags (lending + games)', () => {
  it('KNOWN_FEATURES contains both the lending and games flags', () => {
    expect(KNOWN_FEATURES).toEqual(['lending', 'games'])
  })

  it('sanitizeFeatures always returns the full known map, coerced to booleans', () => {
    expect(sanitizeFeatures({ games: true })).toEqual({ lending: false, games: true })
    expect(sanitizeFeatures({ lending: true, games: true })).toEqual({ lending: true, games: true })
    expect(sanitizeFeatures({})).toEqual({ lending: false, games: false })
    expect(sanitizeFeatures(undefined)).toEqual({ lending: false, games: false })
    // Unknown keys are dropped; truthy values coerce to true — a client can
    // never smuggle an arbitrary feature payload onto a user record.
    expect(sanitizeFeatures({ games: 'yes', lending: 1, evil: { x: 1 } })).toEqual({ lending: true, games: true })
  })

  it('approve persists a sanitized full features map (a games grant survives)', async () => {
    const request = { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-01T09:00:00.000Z' }
    usersMock.getRequest.mockResolvedValue(request)
    const res = await post({
      action: 'approve',
      requestId: 'r1',
      collections: { records: true, books: false },
      features: { games: true },
    })
    expect(res.status).toBe(201)
    expect(usersMock.saveUser).toHaveBeenCalledTimes(1)
    expect(usersMock.saveUser.mock.calls[0][0].features).toEqual({ lending: false, games: true })
  })
})
