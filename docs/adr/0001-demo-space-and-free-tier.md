# ADR-0001: Free demo space + free tier for collections

- **Status:** Accepted (pending review) — part of epic "Demo space + Free tier"
- **Date:** 2026-08-12
- **Branch:** `feat/demo-and-free-tier`
- **Authors:** Whole Stack Architect

## Context

Runout (repo `pdelebarre/hokan`) is a React 19 + Vite 8 PWA on Netlify
Functions + Netlify Blobs. Access is passwordless: the owner signs in with
`RUNOUT_ADMIN_KEY` (constant identity `owner` in
`netlify/functions/_shared/auth.js`), members are approved by the admin and
sign in with `RU-XXXX-XXXX-XXXX` access codes. Every function authorizes via
`authorize()` (`netlify/functions/_shared/collection-store.js`), and each
member gets an isolated `collection-<userId>-<kind>` blob store (`storeNameFor`
in `netlify/functions/_shared/users.js`).

Per-account entitlements already exist and are the pattern we extend:
- `collections: { records, books }` — the per-collection plan, 403-enforced in
  `collection.js`.
- `features: { lending }` — a per-account capability flag, admin-gated,
  feature-gated in `lending.js`.

Two requirements drive this decision:

1. A **free demo space** — a limited, fixed set of items visitors can explore
   (scan, search, browse) but **cannot add, delete, or edit**.
2. A **free tier** for registered members limiting them to **10 added items
   per collection**.

## Decision

### 1. Demo space = a third special-cased identity, not a user record

- Add a **public demo code** — `RUNOUT_DEMO_CODE` env, dev default
  `RUNOUT-DEMO-0000`. It is deliberately **not secret**: it powers the
  "Try the free demo" button and ships in the client bundle.
- `authorize()` (server) and `profileForCode` (auth function) resolve the demo
  code to a **constant profile**
  `{ id: 'demo', role: 'demo', name: 'Demo', collections: { records: true,
  books: true }, features: {}, status: 'active' }` — the same special-case
  pattern as the `owner` constant. **No user record, no admin approval, no
  identity-store schema change.**
- Demo items live in the normal per-user stores `collection-demo-records` /
  `collection-demo-books` (via the existing `storeNameFor('demo', kind)`
  mapping — no store-name change needed), **seeded once** with a curated fixed
  set. Because the space is read-only, all demo visitors share it; no
  per-visitor isolation is required.
- **Read-only is enforced server-side**: `collection.js` rejects `POST`/`PUT`/
  `DELETE` for `role === 'demo'` with
  `403 { error, code: 'DEMO_READONLY' }`. `GET` and the Discogs / Google Books
  proxies keep working so scanning and searching are fully demoable.

### 2. Free tier = a `plan` field with config-driven limits

- Add `user.plan: 'free' | 'unlimited'` (default `'free'` for new members; the
  owner is implicitly unlimited). Limits live in a `PLAN_LIMITS` map
  (`{ free: 10, unlimited: null }`) so future tiers are a config change, not a
  code change.
- **Enforced server-side in `collection.js` POST only** (adding): count the
  store index and return `403 { error, code: 'PLAN_LIMIT' }` when
  `index.length >= PLAN_LIMITS[user.plan]`. Edits (`PUT`) and deletes
  (`DELETE`) are never limited. Existing items over the cap are preserved —
  the cap only blocks new adds.
- **Upgrade is an admin action** (no billing infrastructure in scope): the
  admin panel flips a member's plan, mirroring the existing
  `features.lending` switch.

### Cross-cutting

- The collection API client (`src/api/collection.js`) must surface server
  `code`s on thrown errors (as the lookup clients already do) so the UI can
  branch on `PLAN_LIMIT` / `DEMO_READONLY`.

## Alternatives considered

- **Demo as a seeded member user record** — rejected: it would appear in the
  admin member list, be deletable, and require identity-store migration. The
  `owner`-style constant is cheaper and cannot be deleted.
- **Per-visitor demo stores** — rejected: demo is read-only, so there are no
  writes to isolate; one shared store is simpler and cheaper.
- **Client-side-only limits** — rejected: not authoritative; a modified client
  could bypass the cap.
- **Transactional cap counting (real DB)** — rejected: Netlify Blobs has no
  transactions; the small concurrent-POST race is acceptable at this scale and
  is mitigated by re-reading the index immediately before `writeIndex`.

## Consequences

**Positive**

- Additive: no identity-store schema migration, no blob-store renames; the
  owner's legacy stores (`runout-collection` / `runout-library`) are untouched.
- Demo reuses the existing auth model and item shape — the shared
  `CollectionView` flow renders demo items unchanged.
- The free tier is a pure server-side gate plus UX; reversible.

**Negative / trade-offs**

- Concurrent POSTs can race past the 10-item cap by a couple of items (no
  transactions in Blobs).
- Demo visitors burn the shared Discogs quota; acceptable for a demo, revisit
  throttling if public traction grows.
- The demo code is public by design — safe only because the demo store is
  read-only.
- Existing members will hit the cap retroactively; **decision needed**:
  grandfather current members to `unlimited` (recommended at private-test
  scale) or start everyone on `free`.

## What must be preserved

- Owner legacy stores and the owner's unlimited access.
- The Bearer access-code auth model; demo rides it as a constant identity.
- Item shape + duplicate detection (`findRelated`) so demo items render like
  any others.
- PWA/offline behavior (no `vite.config.js` / service-worker changes).
- Secret rules: the admin key and member codes are never logged or leaked;
  `publicUser` on every profile path (the demo code is intentionally public,
  nothing else is).
