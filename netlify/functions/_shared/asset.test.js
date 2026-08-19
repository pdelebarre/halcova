// @vitest-environment node
//
// SEC-7.3 (#340) — private asset access endpoint (netlify/functions/asset.js).
// Handler-level tests over the mocked @netlify/blobs store + real session
// tokens. Focused on the security contract:
//   - BOLA: a member signing an asset id in ANOTHER member's store gets the same
//     uniform 403 FORBIDDEN whether the id exists-or-not (non-enumerating).
//   - Cross-tenant: a forged client-supplied owner/tenant/asset id can never
//     address another user's store.
//   - Demo denied signing/delete; list is owner-self.
//   - FAILS CLOSED: no ASSET_SIGN_SECRET -> signing refuses (503), never an
//     open URL.
//   - Owner DTO carries asset ids only; signed URLs come only from asset:sign.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import assetHandler from '../asset'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'
import { verifyAssetToken } from './asset-sign'

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
        return v
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({ getStore: (name) => stores[name] || (stores[name] = createStore()) }))

// Seed a member identity in the runout-identity store so resolveSession can
// resolve member sessions (the default handler path reads the user back).
function seedMember(id) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = { id, name: 'Member', email: `${id}@example.com`, code: `RU-CODE-${id}`, collections: { records: true, books: true }, role: 'member', status: 'active' }
  identity.data.set(`code:RU-CODE-${id}`, id)
  identity.data.set(`user:${id}`, user)
  const index = identity.data.get('index:users') || []
  if (!index.includes(id)) identity.data.set('index:users', [...index, id])
  return user
}

let OWNER_TOKEN = ''
let MEMBER_A_TOKEN = ''
let MEMBER_B_TOKEN = ''
let DEMO_TOKEN = ''

beforeEach(async () => {
  for (const key of Object.keys(stores)) delete stores[key]
  process.env.ASSET_SIGN_SECRET = 'test-asset-sign-secret'
  seedMember('memberA')
  seedMember('memberB')
  OWNER_TOKEN = await adminSessionToken()
  MEMBER_A_TOKEN = await sessionTokenFor({ userId: 'memberA', role: 'member' })
  MEMBER_B_TOKEN = await sessionTokenFor({ userId: 'memberB', role: 'member' })
  DEMO_TOKEN = await demoSessionToken()
})

afterEach(() => {
  delete process.env.ASSET_SIGN_SECRET
  delete process.env.ASSET_SIGN_TTL_MINUTES
})

function seedEnvelope(storeName, { assetId, ownerId, mimeType = 'image/jpeg', size = 123, createdAt = '2026-01-01T00:00:00Z' }) {
  const store = stores[storeName] || (stores[storeName] = createStore())
  store.setJSON(`asset:${assetId}`, { assetId, ownerId, mimeType, size, createdAt })
}

const A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function req(token, body) {
  return {
    method: 'POST',
    url: 'http://localhost/.netlify/functions/asset',
    headers: { get: (n) => (String(n).toLowerCase() === 'authorization' ? `Bearer ${token}` : '') },
    json: async () => body,
  }
}

describe('asset:sign — BOLA / non-enumeration / cross-tenant', () => {
  it('signs an asset the caller owns (owner-self), returning a signed URL + expiresAt + mimeType', async () => {
    seedEnvelope(`assets-memberA`, { assetId: A_ID, ownerId: 'memberA', mimeType: 'image/jpeg' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: A_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.expiresAt).toBeGreaterThan(Date.now())
    expect(body.mimeType).toBe('image/jpeg')
    // The signed URL token verifies against the same secret with the right scope.
    const v = verifyAssetToken(body.url, { secret: process.env.ASSET_SIGN_SECRET })
    expect(v.ok).toBe(true)
    expect(v.assetId).toBe(A_ID)
    expect(v.tenantId).toBe('memberA')
  })

  it('BOLA — signing an asset in another member\'s store is a uniform 403 FORBIDDEN (non-enumerating)', async () => {
    // B owns the asset; A tries to sign it.
    seedEnvelope(`assets-memberB`, { assetId: B_ID, ownerId: 'memberB' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: B_ID }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })

  it('non-enumeration — a genuinely missing asset id gets the SAME 403 body as one you do not own', async () => {
    seedEnvelope(`assets-memberB`, { assetId: B_ID, ownerId: 'memberB' })
    const notOwned = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: B_ID }))
    const missing = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: A_ID }))
    expect(notOwned.status).toBe(403)
    expect(missing.status).toBe(403)
    // Identical body — a client cannot distinguish "missing" from "not yours".
    expect(await notOwned.json()).toEqual(await missing.json())
  })

  it('cross-tenant — a forged ownerId on a stored asset is denied (ownerId !== session user.id)', async () => {
    // Attacker-controlled store content claims another owner; the check is
    // against the SESSION user id, so it is denied even within the caller's
    // own store namespace.
    seedEnvelope(`assets-memberA`, { assetId: A_ID, ownerId: 'memberB' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: A_ID }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })

  it('a member cannot mint a URL for an asset id it does not own across tenants', async () => {
    seedEnvelope(`assets-memberB`, { assetId: B_ID, ownerId: 'memberB' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: B_ID }))
    expect(res.status).toBe(403)
    // And B CAN sign their own — proving the 403 above was not a policy bug.
    const ok = await assetHandler(req(MEMBER_B_TOKEN, { action: 'sign', assetId: B_ID }))
    expect(ok.status).toBe(200)
  })

  it('fail-closed — no ASSET_SIGN_SECRET configured refuses signing (503), never an open URL', async () => {
    delete process.env.ASSET_SIGN_SECRET
    seedEnvelope(`assets-memberA`, { assetId: A_ID, ownerId: 'memberA' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: A_ID }))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('SIGNING_UNAVAILABLE')
  })

  it('denies the demo identity signing (read-only demo)', async () => {
    seedEnvelope(`assets-demo`, { assetId: A_ID, ownerId: 'demo' })
    const res = await assetHandler(req(DEMO_TOKEN, { action: 'sign', assetId: A_ID }))
    expect(res.status).toBe(403)
  })

  it('requires a valid session — unauthenticated is 401', async () => {
    const res = await assetHandler(req('', { action: 'sign', assetId: A_ID }))
    expect(res.status).toBe(401)
  })

  it('validates assetId is a UUID shape (400 on junk, no blob-key injection)', async () => {
    seedEnvelope(`assets-memberA`, { assetId: A_ID, ownerId: 'memberA' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'sign', assetId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
  })
})

describe('asset:list — owner-self only', () => {
  it('lists only the caller\'s OWN assets (never another user\'s store)', async () => {
    seedEnvelope(`assets-memberA`, { assetId: A_ID, ownerId: 'memberA' })
    seedEnvelope(`assets-memberB`, { assetId: B_ID, ownerId: 'memberB' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'list' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assets).toHaveLength(1)
    expect(body.assets[0].assetId).toBe(A_ID)
    expect(body.assets[0].mimeType).toBe('image/jpeg')
  })

  it('allows the owner to list their own store', async () => {
    seedEnvelope(`assets-owner`, { assetId: A_ID, ownerId: 'owner' })
    const res = await assetHandler(req(OWNER_TOKEN, { action: 'list' }))
    expect(res.status).toBe(200)
    expect((await res.json()).assets).toHaveLength(1)
  })
})

describe('asset:delete — owner-self only, non-enumerating', () => {
  it('deletes only from the caller\'s own store', async () => {
    seedEnvelope(`assets-memberA`, { assetId: A_ID, ownerId: 'memberA' })
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'delete', assetId: A_ID }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    // The envelope is gone.
    const list = await assetHandler(req(MEMBER_A_TOKEN, { action: 'list' }))
    expect((await list.json()).assets).toHaveLength(0)
  })

  it('denies deleting an asset in another member\'s store (same 403 as missing)', async () => {
    seedEnvelope(`assets-memberB`, { assetId: B_ID, ownerId: 'memberB' })
    const notOwned = await assetHandler(req(MEMBER_A_TOKEN, { action: 'delete', assetId: B_ID }))
    const missing = await assetHandler(req(MEMBER_A_TOKEN, { action: 'delete', assetId: A_ID }))
    expect(notOwned.status).toBe(403)
    expect(await notOwned.json()).toEqual(await missing.json())
  })

  it('denies the demo identity deleting', async () => {
    const res = await assetHandler(req(DEMO_TOKEN, { action: 'delete', assetId: A_ID }))
    expect(res.status).toBe(403)
  })
})

describe('handler plumbing', () => {
  it('rejects a non-POST method with 405', async () => {
    const res = await assetHandler({ method: 'GET', headers: { get: () => '' } })
    expect(res.status).toBe(405)
  })

  it('rejects an unknown action with 400', async () => {
    const res = await assetHandler(req(MEMBER_A_TOKEN, { action: 'explode' }))
    expect(res.status).toBe(400)
  })
})
