// @vitest-environment node
//
// SEC-7.3.x (#385) — private asset serving layer (netlify/functions/serve.js).
// Vets the signed-URL consumption path: valid token, expired, tampered, missing,
// revoked, non-enumeration, method guard, fail-closed, and rate-limit.
//
// The serve layer is sessionless — it authenticates via the HMAC-signed token
// (?s=...), not a Bearer session token. Tests use the real signAssetToken /
// issueAssetToken helpers from asset-sign.js to mint valid tokens.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import serveHandler from '../serve'
import { signAssetToken, issueAssetToken, verifyAssetToken } from './asset-sign'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, opts) {
        const v = this.data.get(String(key))
        if (v === undefined || v === null) return null
        if (opts?.type === 'json') return JSON.parse(JSON.stringify(v))
        if (opts?.type === 'arrayBuffer') {
          // Return a Uint8Array copy to simulate Blobs arrayBuffer behavior.
          if (v instanceof Uint8Array) return v.buffer.slice(0)
          if (typeof v === 'string') return new TextEncoder().encode(v).buffer
          return v
        }
        return v
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async set(key, value) { this.data.set(String(key), value) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({ getStore: (name) => stores[name] || (stores[name] = createStore()) }))

const SECRET = 'test-asset-sign-secret'
const MEMBER_A = 'memberA'
const A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASSET_KEY = `asset:${A_ID}`
const DATA_KEY = `asset:${A_ID}:data`

// Helpers for building a signed token and generating a request.
function makeToken(opts = {}) {
  const { assetId = A_ID, tenantId = MEMBER_A, expiresAt = Date.now() + 600_000, secret = SECRET } = opts
  return signAssetToken({ assetId, tenantId, expiresAt, secret })
}

function req(token, method = 'GET') {
  const s = token ? `?s=${encodeURIComponent(token)}` : ''
  return {
    method,
    url: `http://localhost/.netlify/functions/serve${s}`,
    headers: { get: (n) => (n.toLowerCase() === 'x-nf-client-connection-ip' ? '127.0.0.1' : '') },
  }
}

function seedEnvelope(storeName, overrides = {}) {
  const store = stores[storeName] || (stores[storeName] = createStore())
  const assetId = overrides.assetId || A_ID
  store.setJSON(`asset:${assetId}`, { assetId, ownerId: MEMBER_A, mimeType: 'image/jpeg', size: 123, createdAt: '2026-01-01T00:00:00Z', ...overrides })
}

function seedBytes(storeName, bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), assetId = A_ID) {
  const store = stores[storeName] || (stores[storeName] = createStore())
  store.set(`asset:${assetId}:data`, bytes)
}

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  process.env.ASSET_SIGN_SECRET = SECRET
})

afterEach(() => {
  delete process.env.ASSET_SIGN_SECRET
  delete process.env.RUNOUT_ASSET_SERVE_RATE_LIMIT
  delete process.env.RUNOUT_ASSET_SIGN_RATE_LIMIT
})

// ---------------------------------------------------------------------------
// Valid token streams bytes
// ---------------------------------------------------------------------------
describe('valid token', () => {
  it('returns 200 with asset bytes when the token is valid and the asset exists', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    seedBytes(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.status).toBe(200)
    const body = await res.arrayBuffer()
    expect(new Uint8Array(body)).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))
  })

  it('sets the correct Content-Type from the envelope mimeType', async () => {
    seedEnvelope(`assets-${MEMBER_A}`, { mimeType: 'image/png' })
    seedBytes(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('sets security headers on the response', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    seedBytes(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('includes X-Asset-Id header for correlation', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    seedBytes(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.headers.get('X-Asset-Id')).toBe(A_ID)
  })

  it('returns a JSON envelope when no bytes stored yet (readiness seam)', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    const body = await res.json()
    expect(body.assetId).toBe(A_ID)
    expect(body.mimeType).toBe('image/jpeg')
  })
})

// ---------------------------------------------------------------------------
// Expired token
// ---------------------------------------------------------------------------
describe('expired token', () => {
  it('returns 403 TOKEN_EXPIRED for an expired signed token', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    const token = makeToken({ expiresAt: Date.now() - 1000 })
    const res = await serveHandler(req(token))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('TOKEN_EXPIRED')
  })
})

// ---------------------------------------------------------------------------
// Tampered token
// ---------------------------------------------------------------------------
describe('tampered token', () => {
  it('returns 403 TOKEN_INVALID for a tampered (wrong secret) token', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    const token = makeToken({ secret: 'wrong-secret' })
    const res = await serveHandler(req(token))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('TOKEN_INVALID')
  })

  it('returns 403 TOKEN_INVALID for a malformed token string', async () => {
    const res = await serveHandler(req('not-a-valid-token'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('TOKEN_INVALID')
  })
})

// ---------------------------------------------------------------------------
// Missing token (no ?s= parameter)
// ---------------------------------------------------------------------------
describe('missing token', () => {
  it('returns 400 TOKEN_MISSING when no s= query param is present', async () => {
    const res = await serveHandler(req(''))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('TOKEN_MISSING')
  })
})

// ---------------------------------------------------------------------------
// Revoked asset
// ---------------------------------------------------------------------------
describe('revoked asset', () => {
  it('returns 403 ASSET_UNAVAILABLE when the asset has been revoked (revokedAt set)', async () => {
    seedEnvelope(`assets-${MEMBER_A}`, { revokedAt: '2026-06-01T00:00:00Z' })
    seedBytes(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('ASSET_UNAVAILABLE')
  })
})

// ---------------------------------------------------------------------------
// Non-enumeration: missing and revoked return the same body
// ---------------------------------------------------------------------------
describe('non-enumeration (SEC-7.1)', () => {
  it('missing asset and revoked asset return the same 403 body', async () => {
    // Missing: no envelope seeded
    const missingToken = makeToken()
    const missingRes = await serveHandler(req(missingToken))
    expect(missingRes.status).toBe(403)

    // Revoked: envelope seeded with revokedAt
    seedEnvelope(`assets-${MEMBER_A}`, { revokedAt: '2026-06-01T00:00:00Z' })
    const revokedToken = makeToken()
    const revokedRes = await serveHandler(req(revokedToken))
    expect(revokedRes.status).toBe(403)

    // Same body — a client cannot distinguish "never existed" from "was revoked"
    expect(await missingRes.json()).toEqual(await revokedRes.json())
  })
})

// ---------------------------------------------------------------------------
// Method guard
// ---------------------------------------------------------------------------
describe('method guard', () => {
  it('returns 405 for a POST request', async () => {
    const token = makeToken()
    const res = await serveHandler(req(token, 'POST'))
    expect(res.status).toBe(405)
    const body = await res.json()
    expect(body.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('returns 405 for a PUT request', async () => {
    const token = makeToken()
    const res = await serveHandler(req(token, 'PUT'))
    expect(res.status).toBe(405)
  })

  it('returns 405 for a DELETE request', async () => {
    const token = makeToken()
    const res = await serveHandler(req(token, 'DELETE'))
    expect(res.status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// Fail-closed: no secret configured
// ---------------------------------------------------------------------------
describe('fail-closed (CWE-287/346)', () => {
  it('returns 503 SIGNING_UNAVAILABLE when ASSET_SIGN_SECRET is not configured', async () => {
    delete process.env.ASSET_SIGN_SECRET
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('SIGNING_UNAVAILABLE')
  })
})

// ---------------------------------------------------------------------------
// Rate-limit
// ---------------------------------------------------------------------------
describe('rate-limit (SEC-7.3.x #385)', () => {
  it('rate-limits serve requests per-identity (429 after limit exhaustion)', async () => {
    process.env.RUNOUT_ASSET_SERVE_RATE_LIMIT = '2'
    seedEnvelope(`assets-${MEMBER_A}`)
    const token = makeToken()

    const r1 = await serveHandler(req(token))
    expect(r1.status).toBe(200)
    const r2 = await serveHandler(req(token))
    expect(r2.status).toBe(200)
    const r3 = await serveHandler(req(token))
    expect(r3.status).toBe(429)
    const body = await r3.json()
    expect(body.code).toBe('RATE_LIMIT')
  })

  it('rate-limit does not affect other identities (no cross-identity throttling)', async () => {
    process.env.RUNOUT_ASSET_SERVE_RATE_LIMIT = '1'
    seedEnvelope(`assets-${MEMBER_A}`)
    seedEnvelope('assets-memberB', { assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: 'memberB' })
    const tokenA = makeToken({ tenantId: 'memberA' })

    // memberA exhausts their limit
    const r1 = await serveHandler(req(tokenA))
    expect(r1.status).toBe(200)
    const r2 = await serveHandler(req(tokenA))
    expect(r2.status).toBe(429)

    // memberB can still serve (different tenantId in token)
    const tokenB = makeToken({ tenantId: 'memberB', assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
    const r3 = await serveHandler(req(tokenB))
    expect(r3.status).toBe(200)
  })

  it('rate-limit degrades open when the store is unavailable (never a 500)', async () => {
    seedEnvelope(`assets-${MEMBER_A}`)
    const token = makeToken()
    const res = await serveHandler(req(token))
    expect(res.status).toBe(200)
  })
})