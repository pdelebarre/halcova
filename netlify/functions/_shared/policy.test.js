// @vitest-environment node
//
// SEC-7.1 (#338) — centralized authorization policy layer. Unit tests for
// _shared/policy.js (the predicate table + non-enumerating responder) and
// _shared/filter.js (property-level DTO filtering). The end-to-end negative
// cases (cross-tenant read/write rejection) live in tenant-isolation.test.js;
// here we pin the policy-table semantics directly.

import { describe, expect, it, vi } from 'vitest'
import { enforce, FORBIDDEN, forbidden, POLICY, unauthorized } from './policy'
import { filterFor, filterMany } from './filter'

// Build the session-auth resolution mocks for enforce().
const mocks = vi.hoisted(() => ({
  sessionAuth: {},
}))
vi.mock('./session-auth', () => ({
  resolveSession: (...a) => mocks.sessionAuth.resolveSession(...a),
  requireAdmin: (...a) => mocks.sessionAuth.requireAdmin(...a),
}))

const member = { id: 'u1', role: 'member', name: 'A', collections: { records: true, books: true }, status: 'active' }
const admin = { id: 'owner', role: 'admin', name: 'Admin', collections: { records: true, books: true }, status: 'active' }
const demo = { id: 'demo', role: 'demo', name: 'Demo', collections: { records: true, books: true }, status: 'active' }

function okResolved(u) {
  return { user: u, session: { id: 's' }, token: 't' }
}
function errResolved(status) {
  return { error: new Response(JSON.stringify({ error: 'x', code: 'SESSION_INVALID' }), { status }) }
}

describe('POLICY predicate table (SEC-7.1)', () => {
  it('inventories the expected protected actions', () => {
    // auth identity
    expect(POLICY['auth:logout']).toEqual({ owner: 'self' })
    expect(POLICY['auth:logoutAll']).toEqual({ owner: 'self' })
    // admin + seed
    expect(POLICY['admin:*']).toEqual({ requires: 'admin' })
    expect(POLICY['seed-demo:seed']).toEqual({ requires: 'admin' })
    // collection items (owner is self, demo denied writes)
    expect(POLICY['collection:item:write']).toBeUndefined() // grouped read/write below
    expect(POLICY['collection:item:read'].owner).toBe('self')
    expect(POLICY['collection:item:create'].deny).toContain('demo')
    // lending (owner self; demo AND admin cannot lend — admin has no items to lend)
    expect(POLICY['lending:item:lend'].deny).toContain('demo')
    // reviews: delete is owner-or-admin
    expect(POLICY['review:delete'].owner).toBe('target')
    expect(POLICY['review:delete'].allowOverride).toContain('admin')
    // feedback + lookups
    expect(POLICY['feedback:moderate'].requires).toBe('admin')
    expect(POLICY['lookup:read'].owner).toBeUndefined()
  })

  it('enforces requires:admin for admin actions', async () => {
    mocks.sessionAuth.requireAdmin = vi.fn().mockResolvedValue(errResolved(403))
    const r = await enforce({}, 'admin:*')
    expect(r.error.status).toBe(403)
    mocks.sessionAuth.requireAdmin = vi.fn().mockResolvedValue(okResolved(admin))
    const ok = await enforce({}, 'admin:*')
    expect(ok.user.role).toBe('admin')
  })

  it('rejects a member for an admin requirement (401/403 non-enumerating)', async () => {
    mocks.sessionAuth.requireAdmin = vi.fn().mockResolvedValue(errResolved(403))
    const r = await enforce({}, 'admin:*')
    // A member probing the admin surface gets the stable FORBIDDEN shape.
    expect(r.error.status).toBe(403)
    expect((await r.error.json()).code).toBe('FORBIDDEN')
  })

  it('rejects an unauthenticated request with 401 for a session action', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(errResolved(401))
    const r = await enforce({}, 'collection:item:read')
    expect(r.error.status).toBe(401)
    expect((await r.error.json()).code).toBe('NOT_SIGNED_IN')
  })

  it('denies a demo identity writes on the collection (DEMO_READONLY shape)', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(demo))
    const r = await enforce({}, 'collection:item:create', { denyCode: 'DEMO_READONLY', denyMessage: 'The demo collection is read-only.' })
    expect(r.error.status).toBe(403)
    expect((await r.error.json()).code).toBe('DEMO_READONLY')
  })

  it('allows a demo identity to read (no deny on read)', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(demo))
    const r = await enforce({}, 'collection:item:read')
    expect(r.user.role).toBe('demo')
  })

  it('owner:target: a non-owner is denied whether or not the target exists (non-enumerating)', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(member))
    // Target exists but isn't theirs.
    const r1 = await enforce({}, 'review:delete', { ownsTarget: async () => false })
    expect(r1.error.status).toBe(403)
    expect((await r1.error.json()).code).toBe('FORBIDDEN')
    // Target genuinely missing — identical response (no enumeration).
    const r2 = await enforce({}, 'review:delete', { ownsTarget: async () => false })
    expect(r2.error.status).toBe(403)
    expect((await r2.error.json()).code).toBe('FORBIDDEN')
  })

  it('owner:target: allows the owner, and allows admin via allowOverride', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(member))
    const r = await enforce({}, 'review:delete', { ownsTarget: async () => true })
    expect(r.user.role).toBe('member')
    // Admin override: ownsTarget is false but admin may still pass.
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(admin))
    const radmin = await enforce({}, 'review:delete', { ownsTarget: async () => false })
    expect(radmin.user.role).toBe('admin')
  })

  it('the principal is always derived from the session, never a body field', async () => {
    // A request body claiming role:admin is ignored — role comes from the session.
    const req = { json: async () => ({ role: 'admin', userId: 'victim' }) }
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(member))
    const r = await enforce(req, 'collection:item:create')
    expect(r.user.role).toBe('member')
  })
})

describe('non-enumerating 401/403 responder', () => {
  it('forbidden() is a stable 403 { error, code: FORBIDDEN }', async () => {
    const res = forbidden()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual(FORBIDDEN)
  })
  it('unauthorized() is a stable 401 { error, code: NOT_SIGNED_IN }', async () => {
    const res = unauthorized()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('NOT_SIGNED_IN')
  })
})

describe('filter.js — property-level DTO filtering (SEC-7.1)', () => {
  const item = {
    id: 'i1',
    title: 'T',
    price: 20,
    serial: 'S1',
    notes: 'private note',
    adminNote: 'mod note',
    lending: { borrower: { name: 'B', contact: '555' }, lentOn: '2026-01-01' },
  }

  it('strips private item fields from a non-owner DTO', () => {
    const out = filterFor(member, 'item', item, { own: false })
    expect(out.price).toBeUndefined()
    expect(out.serial).toBeUndefined()
    expect(out.notes).toBeUndefined()
    expect(out.adminNote).toBeUndefined()
    expect(out.lending.borrower.contact).toBeUndefined()
    // Public fields kept.
    expect(out.id).toBe('i1')
    expect(out.title).toBe('T')
    expect(out.lending.borrower.name).toBe('B')
  })

  it('keeps private item fields for the owner DTO', () => {
    const out = filterFor(member, 'item', item, { own: true })
    expect(out.price).toBe(20)
    expect(out.notes).toBe('private note')
  })

  it('generalizes the reviews authorId strip (non-owner)', () => {
    const review = { id: 'r1', authorId: 'bob', rating: 5, body: 'hi' }
    const out = filterFor(member, 'review', review, { own: false })
    expect(out.authorId).toBeUndefined()
    expect(out.rating).toBe(5)
    // Owner keeps authorId (so the client can dedupe "mine").
    const mine = filterFor(member, 'review', review, { own: true })
    expect(mine.authorId).toBe('bob')
  })

  it('filterMany applies the ownership predicate per item', () => {
    const mine = { id: 'r1', authorId: 'u1', rating: 5 }
    const theirs = { id: 'r2', authorId: 'u2', rating: 4 }
    const out = filterMany(member, 'review', [mine, theirs], { owns: (o) => o.authorId === 'u1' })
    expect(out[0].authorId).toBe('u1') // mine kept
    expect(out[1].authorId).toBeUndefined() // theirs stripped
  })

  it('user resource equals publicUser (secret fields stripped)', () => {
    const user = { id: 'u1', name: 'A', code: 'RU-XXXX', code_hash: 'h', plan: 'free', features: {} }
    const out = filterFor(member, 'user', user)
    expect(out.code).toBeUndefined()
    expect(out.code_hash).toBeUndefined()
    expect(out.plan).toBe('free')
  })
})
