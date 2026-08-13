# ADR-0002: Scaling architecture — phased evolution, hosting stays on Netlify

- **Status:** Accepted (pending review) — part of epics #37, #38, #39
- **Date:** 2026-08-13
- **Branch:** `docs/scaling-architecture`
- **Authors:** Whole Stack Architect

## Context

Runout/Halcova must scale from ~100 users to 1,000, then 10k, 100k, and 1M.
The current stack is a React 19 + Vite 8 PWA on Netlify Functions + Netlify
Blobs: `collection` CRUD, `auth`/`admin` (access codes), and `discogs`/`books`
lookup proxies, all auth-gated with `Bearer <code>`.

Code-level findings that bound current scale (read from `netlify/functions/*`):

1. **Auth is O(n) over all users.** `authorize()` → `findUserByCode()` →
   `listUsers()` reads the entire `runout-identity` store on every
   authenticated request. At 10k users this is ~10k Blob reads per request.
2. **Collection reads fetch the whole store.** `GET /collection` reads the
   `index` then `Promise.all`-fetches every `item:<id>` blob.
3. **Plan-limit check scans all items.** `POST` reads every item to count
   owned (non-wishlist) items on every add.
4. **Index writes have no transactions.** Netlify Blobs has none; the
   read-modify-write `index` races under concurrent writes (ADR-0001).
5. **Admin list loads everything.** `admin.js GET` lists all users + requests.
6. **Covers are hotlinked** to Discogs / Google Books hosts.

Everything else — the catalog abstraction, per-user store isolation, the
lookup proxy caches (`discogs-cache` / `books-cache`), and the PWA — is sound
and must be preserved.

## Decision

### 1. Keep hosting on Netlify

The frontend (SPA + PWA + CDN + domain/SSL) stays on Netlify at every scale.
Netlify Functions also stay through the mid-scale; only the **data layer**
(and, at ~1M, optionally the API compute) moves off Netlify. Netlify is never
the reason to migrate — Netlify Blobs is.

### 2. Evolve in three incremental, reversible phases

**Phase 0 — hot-path fixes, no infra change (now → ~10k users)**
See epic #39. Replace the O(n) auth scan with a `code:<normalized>` → `userId`
index key; paginate `GET /collection`; denormalize the owned count so `POST`
stops scanning all items; cache `GET /collection` per user; add a client error
boundary; re-host covers through the proxy + CacheFirst; add rate limiting.

**Phase 1 — move persistence to PostgreSQL (→ ~100k users)**
See epic #38. Keep the Netlify Functions and the exact API contract; replace
Blobs with managed PostgreSQL behind the same routes.

Data model:

```
users        (id, name, email, code_hash, role, status, plan, features jsonb, created_at)
             UNIQUE INDEX on code_hash
requests     (id, name, email, status, created_at, ...)
items        (id uuid, owner_id, kind, title, year, label, genre[], barcode,
              discogs_id, google_books_id, cover_image, data jsonb, date_added, wishlist)
             INDEX (owner_id, kind, date_added)
             INDEX (owner_id, discogs_id)   -- duplicate detection
             INDEX (owner_id, barcode)        -- instant local match
lookup_cache (provider, key, data jsonb, expires_at)  -- replaces discogs-cache/books-cache
```

Access codes: keep the `RU-XXXX-XXXX-XXXX` format and Bearer model, but store
`sha256(code)` with a unique index; the admin "re-reveal a lost code" feature
becomes "rotate a new code". Backfill the owner's legacy stores
(`runout-collection` / `runout-library`) and every member's
`collection-<userId>-<kind>` store into `items` in read-through mode
(read DB, fall back to Blobs) so nothing orphans and every step is reversible.

**Phase 2 — dedicated API service (→ ~1M users)**
See epic #37. Introduce a Spring Boot service (App Service / Container Apps /
AKS) exposing the same endpoints (`/collection`, `/auth`, `/admin`, `/discogs`,
`/books`) with the same contract; the SPA is unchanged via a reverse proxy.
Add Redis (auth-code cache, collection cache, rate limiting), HikariCP pooling
with read replicas, a queue/backoff worker for the provider proxies, and a CDN
in front of the SPA + covers.

## Alternatives considered

- **Big-bang rewrite to Spring Boot now** — rejected: a forklift rewrite risks
  the owner's data and the PWA/offline behavior; serverless + Postgres carries
  the app past 100k before a dedicated service earns its operational cost.
- **Stay on Netlify Blobs indefinitely** — rejected: the `index` + `item:<id>`
  pattern and the identity-store full scans hit Blobs throughput limits well
  before 100k users.
- **Leave Netlify entirely** — rejected: the frontend is a static asset Netlify
  serves well; only the data layer and (later) the API compute need to move.

## Consequences

**Positive**

- Phase 0 is additive and reversible with no data migration; it alone removes
  the worst O(n) pattern (auth full scan) and is the highest-leverage change.
- Phase 1 keeps `src/api/*`, the item shape, and the auth model identical — the
  client and PWA do not move.
- Every phase has a rollback path (read-through fallback, reverse proxy).

**Negative / trade-offs**

- Hashing codes loses plaintext re-reveal; compensated by code rotation.
- Caching `GET /collection` adds invalidation complexity (mitigated by
  write-through invalidation alongside the existing optimistic UI).
- Spring Boot adds operational overhead (pooling, deployments, replicas) that
  is only justified past ~100k users.

## What must be preserved

- Owner's legacy stores and the owner's unlimited access — backfill, never rename.
- Per-user isolation (`collection-<userId>-<kind>` → `items.owner_id`), plan
  enforcement still returning 403.
- The access-code auth model (no passwords) and the Bearer contract.
- The API contract: routes, `{ error }` bodies, HTTP codes, item shape.
- PWA/offline behavior: precached shell + scanner `.wasm`, NetworkFirst for
  lookups, CacheFirst for covers, instant local duplicate match.
- Secret rules: `RUNOUT_ADMIN_KEY` and the Discogs token stay server-side and
  are never logged or shipped to the client.
