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
import * as visibility from './visibility'

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
    expect(POLICY['auth:deleteAccount']).toEqual({ owner: 'self', deny: ['demo'] })
    // admin + seed
    expect(POLICY['admin:*']).toEqual({ requires: 'admin' })
    expect(POLICY['seed-demo:seed']).toEqual({ requires: 'admin' })
    // collection items (owner is self, demo denied writes)
    expect(POLICY['collection:item:write']).toBeUndefined() // grouped read/write below
    expect(POLICY['collection:item:read'].owner).toBe('self')
    expect(POLICY['collection:item:create'].deny).toContain('demo')
    // lending (owner self; demo AND admin cannot lend — admin has no items to lend)
    expect(POLICY['lending:item:lend'].deny).toContain('demo')
    // private assets (SEC-7.3 #340): list is owner-self; sign/delete deny demo
    expect(POLICY['asset:list'].owner).toBe('self')
    expect(POLICY['asset:sign'].owner).toBe('self')
    expect(POLICY['asset:sign'].deny).toContain('demo')
    expect(POLICY['asset:delete'].owner).toBe('self')
    expect(POLICY['asset:delete'].deny).toContain('demo')
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

  it('denies the demo identity asset signing and deletion (read-only demo, no private assets)', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(demo))
    const sign = await enforce({}, 'asset:sign')
    expect(sign.error.status).toBe(403)
    expect((await sign.error.json()).code).toBe('FORBIDDEN')
    const del = await enforce({}, 'asset:delete')
    expect(del.error.status).toBe(403)
    expect((await del.error.json()).code).toBe('FORBIDDEN')
  })

  it('allows a member to sign/list/delete their own assets (owner self), rejects unauthenticated with 401', async () => {
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(okResolved(member))
    for (const action of ['asset:sign', 'asset:list', 'asset:delete']) {
      const r = await enforce({}, action)
      expect(r.user.id).toBe('u1')
    }
    mocks.sessionAuth.resolveSession = vi.fn().mockResolvedValue(errResolved(401))
    const unauth = await enforce({}, 'asset:sign')
    expect(unauth.error.status).toBe(401)
    expect((await unauth.error.json()).code).toBe('NOT_SIGNED_IN')
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

  // -------------------------------------------------------------------------
  // SEC-7.2 (#339) — explicit per-role DTO allowlists (filter/visibility).
  // These pin the classification matrix at the property level: a non-owner can
  // never see C3–C8 on an item, a non-author never sees a review's authorId,
  // and the author-facing feedback DTO never carries adminNote.
  // -------------------------------------------------------------------------

  it('N3 — a non-owner item DTO strips the full C3–C8 set (price/serial/notes/receipts/contact/location/adminNote + borrower.contact in lending AND lendingHistory)', () => {
    const rich = {
      id: 'i1', title: 'T', year: 2000, label: 'L', genre: ['Rock'],
      // C1 metadata — retained:
      style: ['Alt'], country: 'US', formatType: 'LP', coverImage: 'img', barcode: 'B',
      discogsId: 1, googleBooksId: 'GB', artists: [{ id: 1, name: 'A' }], tracklist: [{ position: 'A1', title: 'T1' }],
      released: '2000', authorsList: [{ name: 'W' }], subtitle: 'Sub', series: 'S', mainCategory: 'M',
      snippet: 'snip', catno: 'CAT-1', formatRaw: 'LP', isbn: 'ISBN', pageCount: 100, description: 'desc',
      // C2 ownership-adjacent (retained for #338 parity):
      dateAdded: '2026-01-01', wishlist: true,
      // C3–C8 — must ALL be stripped:
      price: 20, serial: 'S1', notes: 'private', receipts: [], contact: 'c', location: 'loc',
      adminNote: 'mod',
      lending: { borrower: { name: 'B', contact: '555' }, lentOn: '2026-01-01' },
      lendingHistory: [{ borrower: { name: 'Prev', contact: '000' }, lentOn: '2025-01-01', returnedOn: '2025-06-01' }],
    }
    const out = filterFor(member, 'item', rich, { own: false })
    // C1 metadata retained.
    expect(out.title).toBe('T')
    expect(out.label).toBe('L')
    expect(out.artists).toEqual([{ id: 1, name: 'A' }])
    expect(out.pageCount).toBe(100)
    // C3–C7 stripped.
    expect(out.price).toBeUndefined()
    expect(out.serial).toBeUndefined()
    expect(out.notes).toBeUndefined()
    expect(out.receipts).toBeUndefined()
    expect(out.contact).toBeUndefined()
    expect(out.location).toBeUndefined()
    expect(out.adminNote).toBeUndefined()
    // C8 — borrower.contact stripped in both lending and lendingHistory.
    expect(out.lending.borrower.name).toBe('B')
    expect(out.lending.borrower.contact).toBeUndefined()
    expect(out.lendingHistory[0].borrower.name).toBe('Prev')
    expect(out.lendingHistory[0].borrower.contact).toBeUndefined()
  })

  it('N3b (SEC-7.3 #340) — private asset refs (assets/receipts/attachments/photoRefs) never leak through the non-owner item DTO', () => {
    const rich = {
      id: 'i1', title: 'T', year: 2000, label: 'L',
      // C6/private-assets refs — must ALL be stripped:
      assets: [{ assetId: 'a-1', mimeType: 'image/jpeg' }],
      receipts: [{ assetId: 'a-2' }],
      attachments: [{ assetId: 'a-3' }],
      photoRefs: ['a-4'],
    }
    const out = filterFor(member, 'item', rich, { own: false })
    expect(out.assets).toBeUndefined()
    expect(out.receipts).toBeUndefined()
    expect(out.attachments).toBeUndefined()
    expect(out.photoRefs).toBeUndefined()
    // Non-owner neither sees asset ids nor signed URLs.
    expect(Object.keys(out)).not.toContain('assetIds')
    expect(Object.keys(out)).not.toContain('signedUrl')
    // Public metadata retained.
    expect(out.id).toBe('i1')
    expect(out.title).toBe('T')
    // The OWNER DTO keeps the asset refs (ids, never signed URLs).
    const owned = filterFor(member, 'item', rich, { own: true })
    expect(owned.assets).toEqual([{ assetId: 'a-1', mimeType: 'image/jpeg' }])
  })

  it('N4 — a non-author review DTO drops authorId (author keeps it)', () => {
    const review = { id: 'r1', authorId: 'bob', rating: 5, body: 'hi' }
    const theirs = filterFor(member, 'review', review, { own: false })
    expect(theirs.authorId).toBeUndefined()
    expect(theirs.rating).toBe(5)
    const mine = filterFor(member, 'review', review, { own: true })
    expect(mine.authorId).toBe('bob')
  })

  it('N7 — the feedback allowlist separates author vs admin views (adminNote never reaches the author)', () => {
    const entry = { id: 'f1', message: 'hi', authorId: 'u1', status: 'open', adminNote: 'internal note', createdAt: '2026-01-01' }
    // Author-facing view: adminNote stripped, everything else kept.
    const author = filterFor(member, 'feedback', entry)
    expect(author.adminNote).toBeUndefined()
    expect(author.message).toBe('hi')
    expect(author.status).toBe('open')
    // Admin view: adminNote retained.
    const adminView = filterFor(admin, 'feedback', entry, { admin: true })
    expect(adminView.adminNote).toBe('internal note')
  })

  it('N9 — a user DTO (publicUser) never contains credentials (code/code_hash/Stripe ids)', () => {
    const user = {
      id: 'u1', name: 'A', email: 'a@x.com', code: 'RU-XXXX', code_hash: 'h',
      stripeCustomerId: 'cus_x', stripeSubscriptionId: 'sub_x', stripeCheckoutSessionId: 'cs_x',
    }
    const out = filterFor(member, 'user', user)
    expect(out.code).toBeUndefined()
    expect(out.code_hash).toBeUndefined()
    expect(out.stripeCustomerId).toBeUndefined()
    expect(out.stripeSubscriptionId).toBeUndefined()
    expect(out.stripeCheckoutSessionId).toBeUndefined()
    // Public identity fields survive.
    expect(out.name).toBe('A')
    expect(out.email).toBe('a@x.com')
  })
})

describe('visibility.js — visibility-state model + allowlist registry (SEC-7.2 #339)', () => {
  const { VISIBILITY, resolveVisibility, ITEM_PUBLIC_FIELDS, ITEM_PRIVATE_FIELDS, PRIVATE_ASSET_FIELDS, REVIEW_PUBLIC_FIELDS, isOwnerRole } = visibility

  it('registers the SEC-7.3 #340 private-assets class and never admits it to the public item allowlist', () => {
    expect(PRIVATE_ASSET_FIELDS).toContain('assets')
    expect(PRIVATE_ASSET_FIELDS).toContain('receipts')
    expect(PRIVATE_ASSET_FIELDS).toContain('attachments')
    expect(PRIVATE_ASSET_FIELDS).toContain('photoRefs')
    // C6/private-assets refs must never appear in the PUBLIC item allowlist.
    const publicSet = new Set(ITEM_PUBLIC_FIELDS)
    for (const f of PRIVATE_ASSET_FIELDS) {
      expect(publicSet.has(f)).toBe(false)
    }
  })
  it('reserved visibility values (FOLLOWERS/GROUP) and unknowns fail closed to PRIVATE', () => {
    expect(resolveVisibility(VISIBILITY.PUBLIC)).toBe(VISIBILITY.PUBLIC)
    expect(resolveVisibility(VISIBILITY.OWNER)).toBe(VISIBILITY.OWNER)
    expect(resolveVisibility(VISIBILITY.PRIVATE)).toBe(VISIBILITY.PRIVATE)
    // Reserved / unknown values can never widen exposure.
    expect(resolveVisibility(VISIBILITY.FOLLOWERS)).toBe(VISIBILITY.PRIVATE)
    expect(resolveVisibility(VISIBILITY.GROUP)).toBe(VISIBILITY.PRIVATE)
    expect(resolveVisibility('hacker-value')).toBe(VISIBILITY.PRIVATE)
  })

  it('the public item allowlist covers exactly C1 catalog metadata + id', () => {
    const publicSet = new Set(ITEM_PUBLIC_FIELDS)
    for (const f of ['id', 'title', 'year', 'label', 'genre', 'style', 'country', 'formatType', 'coverImage', 'barcode', 'discogsId', 'googleBooksId', 'artists', 'tracklist', 'released', 'authorsList', 'subtitle', 'series', 'mainCategory', 'snippet', 'catno', 'formatRaw', 'isbn', 'pageCount', 'description']) {
      expect(publicSet.has(f)).toBe(true)
    }
    // Private classes are NOT in the public allowlist.
    for (const f of ITEM_PRIVATE_FIELDS) {
      expect(publicSet.has(f)).toBe(false)
    }
  })

  it('review public allowlist carries C9 fields, never authorId/status', () => {
    expect(REVIEW_PUBLIC_FIELDS).toContain('rating')
    expect(REVIEW_PUBLIC_FIELDS).toContain('body')
    expect(REVIEW_PUBLIC_FIELDS).toContain('authorName')
    expect(REVIEW_PUBLIC_FIELDS).not.toContain('authorId')
    expect(REVIEW_PUBLIC_FIELDS).not.toContain('status')
  })

  it('admin/owner are the bypass roles; member/demo are not', () => {
    expect(isOwnerRole('admin')).toBe(true)
    expect(isOwnerRole('owner')).toBe(true)
    expect(isOwnerRole('member')).toBe(false)
    expect(isOwnerRole('demo')).toBe(false)
  })
})
