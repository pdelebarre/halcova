// security-authz.test.js — Negative authorization tests (SEC-7.5, #342)
//
// These tests verify that the policy layer (netlify/functions/_shared/policy.js)
// correctly rejects cross-user access, privilege escalation, demo write attempts,
// and non-admin admin-route access. They are deliberately written against the
// policy.js module directly (unit scope) so they run fast in CI without a
// running Netlify server.
//
// Coverage:
//   BOLA  — a user cannot read/write another user's collection items
//   BOPLA — a crafted body with ownerId/role/plan is ignored by the field allowlist
//   Demo  — the demo identity cannot write (create/update/delete)
//   Admin — a member cannot reach admin-gated actions
//   XSS   — script payloads in item fields are rejected by validateItem

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the session-auth module so tests control which user resolves.
// The real implementation hits Netlify Blobs — we replace it entirely.
// ---------------------------------------------------------------------------
vi.mock('../../netlify/functions/_shared/session-auth', () => ({
  resolveSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

import { resolveSession, requireAdmin } from '../../netlify/functions/_shared/session-auth'
import { enforce, FORBIDDEN, UNAUTHORIZED } from '../../netlify/functions/_shared/policy'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(method = 'GET', token = 'tok-a') {
  return {
    method,
    url: 'https://example.com/api/collection?collection=records',
    headers: { get: (h) => (h.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
  }
}

const USER_A = {
  id: 'user-a',
  role: 'member',
  status: 'active',
  collections: { records: true, books: true },
  features: {},
}

const USER_B = {
  id: 'user-b',
  role: 'member',
  status: 'active',
  collections: { records: true, books: true },
  features: {},
}

const DEMO_USER = {
  id: 'demo',
  role: 'demo',
  status: 'active',
  collections: { records: true, books: true },
  features: {},
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// BOLA — Broken Object Level Authorization
// ---------------------------------------------------------------------------
describe('BOLA — cross-user collection access', () => {
  it('allows User A to read their own collection', async () => {
    resolveSession.mockResolvedValue({ user: USER_A, session: {}, token: 'tok-a' })
    const req = makeReq('GET', 'tok-a')
    const result = await enforce(req, 'collection:item:read')
    expect(result.user).toEqual(USER_A)
    expect(result.error).toBeUndefined()
  })

  it('rejects an unauthenticated request to read a collection (401)', async () => {
    resolveSession.mockResolvedValue({ error: new Response(JSON.stringify(UNAUTHORIZED), { status: 401 }) })
    const req = makeReq('GET', '')
    const result = await enforce(req, 'collection:item:read')
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(401)
  })

  // BOLA: User B presents User A's item id in the URL — but since per-user
  // stores are isolated by session user.id (never by a client-supplied ownerId),
  // the policy layer grants User B access only to THEIR OWN store. The item
  // simply won't exist in User B's store, so the function returns 403 FORBIDDEN
  // (non-enumerating). This test verifies the policy layer resolves the correct
  // principal regardless of URL params.
  it('resolves User B as principal even when URL carries User A item id', async () => {
    resolveSession.mockResolvedValue({ user: USER_B, session: {}, token: 'tok-b' })
    const req = {
      method: 'GET',
      url: 'https://example.com/api/collection?collection=records&id=item-owned-by-user-a',
      headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer tok-b' : null) },
    }
    const result = await enforce(req, 'collection:item:read')
    // The policy resolves User B, not User A — the item-id in the URL is irrelevant
    // to authorization. The function layer then looks up the item in User B's store
    // and returns 403 because it won't be there.
    expect(result.user.id).toBe('user-b')
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// BOLA — review:delete (owner: 'target' rule)
// ---------------------------------------------------------------------------
describe('BOLA — review delete: owner-of-target enforcement', () => {
  it('allows the review owner to delete their own review', async () => {
    resolveSession.mockResolvedValue({ user: USER_A, session: {}, token: 'tok-a' })
    const req = makeReq('DELETE', 'tok-a')
    const result = await enforce(req, 'review:delete', { ownsTarget: async () => true })
    expect(result.error).toBeUndefined()
  })

  it('rejects User B attempting to delete User A review (403 FORBIDDEN)', async () => {
    resolveSession.mockResolvedValue({ user: USER_B, session: {}, token: 'tok-b' })
    const req = makeReq('DELETE', 'tok-b')
    const result = await enforce(req, 'review:delete', { ownsTarget: async () => false })
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(403)
    const body = await result.error.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  it('allows admin to delete any review (allowOverride)', async () => {
    const ADMIN = { ...USER_A, id: 'owner', role: 'admin' }
    requireAdmin.mockResolvedValue({ user: ADMIN, session: {}, token: 'tok-admin' })
    resolveSession.mockResolvedValue({ user: ADMIN, session: {}, token: 'tok-admin' })
    const req = makeReq('DELETE', 'tok-admin')
    // ownsTarget returns false but admin override should pass
    const result = await enforce(req, 'review:delete', { ownsTarget: async () => false })
    // admin is in allowOverride so no ownership check is applied
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Demo identity — write denial (BOLA + demo guard)
// ---------------------------------------------------------------------------
describe('Demo identity — write operations must be denied', () => {
  const WRITE_ACTIONS = [
    'collection:item:create',
    'collection:item:update',
    'collection:item:delete',
    'lending:item:lend',
    'lending:item:return',
    'review:create',
    'feedback:create',
  ]

  WRITE_ACTIONS.forEach((action) => {
    it(`blocks demo from ${action} (403)`, async () => {
      resolveSession.mockResolvedValue({ user: DEMO_USER, session: {}, token: 'tok-demo' })
      const req = makeReq('POST', 'tok-demo')
      const result = await enforce(req, action, {
        denyCode: 'DEMO_READONLY',
        denyMessage: 'The demo collection is read-only.',
      })
      expect(result.error).toBeDefined()
      expect(result.error.status).toBe(403)
      const body = await result.error.json()
      expect(body.code).toBe('DEMO_READONLY')
    })
  })

  it('allows demo to read collection items', async () => {
    resolveSession.mockResolvedValue({ user: DEMO_USER, session: {}, token: 'tok-demo' })
    const req = makeReq('GET', 'tok-demo')
    const result = await enforce(req, 'collection:item:read')
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Admin gate — member must not reach admin actions
// ---------------------------------------------------------------------------
describe('Admin gate — members cannot invoke admin actions', () => {
  it('rejects a member calling admin:* (403)', async () => {
    requireAdmin.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Admin access required.' }), { status: 403 }),
    })
    const req = makeReq('GET', 'tok-member')
    const result = await enforce(req, 'admin:*')
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(403)
  })

  it('rejects an unauthenticated call to admin:* (401)', async () => {
    requireAdmin.mockResolvedValue({
      error: new Response(JSON.stringify(UNAUTHORIZED), { status: 401 }),
    })
    const req = makeReq('GET', '')
    const result = await enforce(req, 'admin:*')
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// BOPLA — Broken Object Property Level Authorization
// validateItem (from item-fields.js) must strip or reject forbidden fields
// such as ownerId, userId, role, plan, id supplied by a crafted request body.
// These tests call the validator directly.
// ---------------------------------------------------------------------------
describe('BOPLA — forbidden fields are stripped from item payload', () => {
  it('strips ownerId and role from a crafted POST body', async () => {
    const { pickItemFields } = await import('../../netlify/functions/_shared/item-fields')
    const crafted = {
      title: 'Legitimate Title',
      artist: 'Artist',
      ownerId: 'user-a',      // must be dropped
      role: 'admin',          // must be dropped
      plan: 'unlimited',      // must be dropped
      id: 'injected-id',      // must be dropped (server assigns id)
    }
    const picked = pickItemFields(crafted)
    expect(picked.ownerId).toBeUndefined()
    expect(picked.role).toBeUndefined()
    expect(picked.plan).toBeUndefined()
    expect(picked.id).toBeUndefined()
    expect(picked.title).toBe('Legitimate Title')
  })
})

// ---------------------------------------------------------------------------
// XSS — script payloads in item fields must be rejected by validateItem
// ---------------------------------------------------------------------------
describe('XSS — script payloads in item fields are rejected', () => {
  it('rejects a title containing a <script> tag', async () => {
    const { validateItem } = await import('../../netlify/functions/_shared/item-fields')
    const malicious = { title: '<script>alert(1)</script>' }
    const result = validateItem(malicious)
    // Either the field is rejected (error) or the script tag is sanitized away.
    // Both outcomes are acceptable; a raw script tag in the stored value is not.
    if (!result.error) {
      expect(result.item?.title).not.toMatch(/<script/i)
    } else {
      expect(result.error).toBeTruthy()
    }
  })
})
