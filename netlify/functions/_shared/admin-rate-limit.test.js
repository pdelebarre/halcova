// @vitest-environment node
//
// SEC-3.6 (#199) — admin actions are rate-limited per IP. Drives the real
// admin handler with a low RUNOUT_ADMIN_RATE_LIMIT and asserts the (limit+1)-th
// POST returns 429 with Retry-After. The env is set BEFORE the module is
// imported so the module-load constant picks it up.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Set the low limit BEFORE admin.js is imported (vi.hoisted runs at the top,
// ahead of static imports) so the module-load ADMIN_LIMIT constant picks it up.
vi.hoisted(() => { process.env.RUNOUT_ADMIN_RATE_LIMIT = '3' })

import handler from '../admin'
import { adminSessionToken } from './session-test-helpers'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, { type } = {}) {
        const value = this.data.get(String(key))
        if (value === undefined) return null
        return type === 'json' ? JSON.parse(JSON.stringify(value)) : value
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({
  getStore: (name) => {
    if (!stores[name]) stores[name] = createStore()
    return stores[name]
  },
}))

vi.mock('./users', () => ({
  listUsers: vi.fn(async () => []),
  listRequests: vi.fn(async () => []),
  getUser: vi.fn(async () => null),
  saveUser: vi.fn(async (u) => u),
  saveRequest: vi.fn(async (r) => r),
  getRequest: vi.fn(async () => null),
  removeUserRecord: vi.fn(async () => true),
  deleteUserCollections: vi.fn(async () => {}),
}))

let ADMIN_TOKEN = ''

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  ADMIN_TOKEN = await adminSessionToken()
})

describe('SEC-3.6 (#199) — admin actions are rate-limited per IP', () => {
  it('hitting the admin limit returns 429 with Retry-After', async () => {
    // Same source IP for every request (IP_COUNTER fixed at 1).
    const ip = '203.0.113.1'
    const mk = () => ({
      method: 'POST',
      url: 'http://localhost/.netlify/functions/admin',
      headers: {
        get: (k) => {
          const key = String(k).toLowerCase()
          if (key === 'authorization') return `Bearer ${ADMIN_TOKEN}`
          if (key === 'x-nf-client-connection-ip') return ip
          return null
        },
      },
      json: async () => ({ action: 'approve' }),
    })

    // Limit is 3: the first three are allowed (400 MISSING_ID), the 4th is 429.
    for (let i = 0; i < 3; i += 1) {
      const res = await handler(mk())
      expect(res.status).toBe(400)
    }
    const limited = await handler(mk())
    expect(limited.status).toBe(429)
    const body = await limited.json()
    expect(body.code).toBe('RATE_LIMIT')
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})
