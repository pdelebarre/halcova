# Runout Phase 1 — PostgreSQL data layer (ADR-0002, epic #38)

This directory holds the PostgreSQL schema for Scaling Phase 1: moving
persistence from Netlify Blobs to managed PostgreSQL behind the **same** Netlify
Functions and API contract. `src/api/*` and the client are untouched.

## Layout

- `migrations/` — ordered SQL migrations (`001_init.sql`, …). Applied in
  filename order by `scripts/db-migrate.mjs`, which records each applied file
  in a `schema_migrations` table (idempotent, each migration in its own
  transaction).
- `../netlify/functions/_shared/postgres.js` — lazy `pg.Pool` from
  `DATABASE_URL` (default `postgres://localhost:5432/runout`), `query`,
  `connect`, `isPostgresConfigured()`.
- `../netlify/functions/_shared/repository.js` — the Blobs↔Postgres seam:
  `getRepository()` returns the Blobs-backed impl when `DATABASE_URL` is unset
  (today's behavior) or the Postgres impl when it is set (read DB first, fall
  back to Blobs on miss/error).
- `../netlify/functions/_shared/repositories/` — the repositories:
  `users-repo.js`, `items-repo.js`, `lookup-cache-repo.js`,
  `blob-users.js` (the legacy identity impl), `blob-repository.js`,
  `postgres-repository.js`.
- `../netlify/functions/_shared/collection-postgres.js` — the Postgres
  collection handler (transactional writes + SQL plan-limit count).
- `../netlify/functions/_shared/backfill.js` + `scripts/backfill.mjs` — the
  Blobs → Postgres backfill (idempotent, reversible, per-store, dry-run).
- `../netlify/functions/_shared/lookup-cache.js` — DB-first read-through cache
  seam for `discogs.js` / `books.js`.

## Commands

```bash
npm run db:migrate                                   # apply pending migrations
DATABASE_URL=postgres://user:pass@host:5432/runout npm run db:migrate
```

## Access-code hashing & rotation (Part B)

- Postgres stores **only** `code_hash = sha256(normalize(code))` (migration
  `002_hash_codes.sql` drops the interim plaintext `code` column). The Blobs
  path keeps plaintext during read-through — that is the documented long-tail
  trade-off: Blobs is the legacy mirror, Postgres is the secure system of
  record.
- The admin "re-reveal a lost code" is now **rotate**: `POST { action:
  'rotate', userId }` mints a NEW code, stores its hash, and returns the new
  plaintext exactly once (the old code is dead). The admin GET list never
  returns `code` or `code_hash`.
- The client change this implies (replace the per-member "show code" button
  with a "rotate code" action) is a **Front End Developer follow-up** — see the
  Part B report. Server-side hashing + rotation are done.

## Backfill (Part B) — DEPLOY-TIME OWNER STEP

There is **no live Postgres** in the sandbox, so the backfill must be run by
the site owner against the real managed database **before** serving reads from
Postgres. It is non-destructive and reversible:

```bash
node scripts/backfill.mjs --dry-run                  # counts only, no writes
node scripts/backfill.mjs                            # everything
node scripts/backfill.mjs --store runout-collection  # one store at a time
```

What it copies (legacy Blob store → Postgres table, all **upserts**):

| Blob store | Table | Idempotency key |
| --- | --- | --- |
| `runout-identity` (`user:*`, `index:users`) | `users` | `users.id` |
| `runout-identity` (`request:*`, `index:requests`) | `requests` | `requests.id` |
| `runout-collection` / `runout-library` (owner) | `items` (`owner_id='owner'`) | `items.id` (uuid PK) |
| `collection-<userId>-<kind>` (members) | `items` (`owner_id=<userId>`) | `items.id` (uuid PK) |
| `discogs-cache` / `books-cache` | `lookup_cache` | `(provider, key)` |

Properties:

- **Idempotent** — re-running refreshes rows, never duplicates.
- **Reversible** — it only ADDS to Postgres; legacy Blob stores are never
  renamed or deleted. **Rollback = unset `DATABASE_URL`** and reads go back to
  Blobs (still the complete store).
- **Per-store** — backfill one store at a time for a staged cutover.
- **Dry-run** — `--dry-run` reports counts without writing.
- **Hashing** — user codes are written as `code_hash`, never plaintext. A
  member whose plaintext code lives only in Blobs is hashed from that same
  plaintext during backfill, so nobody is locked out mid-cutover.
- Lookup-cache TTLs are preserved exactly (barcode/isbn/release/detail 30d,
  text `q` 1d); stale entries are skipped.

## Cutover & rollback procedure

1. **Provision** a managed Postgres and set `DATABASE_URL` in the deploy env
   (functions env) to the **read-through** URL.
2. **Migrate**: `DATABASE_URL=… npm run db:migrate` (idempotent; applies
   001 + 002).
3. **Backfill** every store (above), ideally one collection kind at a time.
   Until a store is backfilled its reads fall back to Blobs; a *partially*
   backfilled store would serve partial data, so finish a store before serving
   it.
4. **Verify** with `netlify dev` + a real `DATABASE_URL`: sign in (admin key +
   member code), add/update/delete in both collections, confirm the plan cap
   and per-member isolation; then unset `DATABASE_URL` and confirm the Blobs
   fallback still works (proves reversibility).
5. **Flip the lookup caches**: with `DATABASE_URL` set, `discogs.js`/`books.js`
   already read `lookup_cache` first and fall back to Blobs — no extra step.
6. **Deploy with `netlify deploy --build`** (never drag-and-drop `dist`).

### Fail-closed auth writes + auth-prefers-Postgres reads (M1) & backfill-aware plan limit (M2)

Security hardening that changes the transition-window behavior — read before
you cut over:

- **Auth-relevant user writes fail closed.** Rotate, disable/enable, delete
  (and approve — user creation) are **both-or-neither** across Postgres and the
  Blobs mirror: the Postgres write is snapshotted, then mirrored; if the mirror
  fails the pre-write Postgres row is restored (a compensating write, so it
  works everywhere) and the admin call returns a **5xx** (the change is NOT
  applied). A Postgres failure also throws (auth writes never degrade to a
  Blobs-only write). A revocation/disable can never be half-applied, and the
  legacy Blob store can never keep a stale plaintext code / active status that
  outlives the Postgres record. Non-auth writes (requests, items) stay
  best-effort / reversible. **Cutover consequence:** keep the `runout-identity`
  Blob store writable during the transition — admin actions (rotate / disable /
  delete / approve) fail with a 5xx if that mirror is unavailable, rather than
  silently proceeding.
- **Auth reads prefer Postgres.** With `DATABASE_URL` set, `findUserByCode`
  treats a Postgres **record-miss as authoritative** (a code Postgres doesn't
  have is revoked/unknown) and falls back to the Blobs mirror **only on a true
  DB unavailability** — so a stale mirror can never re-validate a rotated,
  disabled or deleted member. **Cutover consequence:** a member whose identity
  has NOT been backfilled to Postgres cannot sign in, so backfill
  `runout-identity` (step 3) *before* flipping auth reads on. An outage still
  resolves members through the mirror, so nobody is locked out.
- **The free-tier plan limit is backfill-aware.** Until a member's
  `collection-<id>-<kind>` store has any row in Postgres (0 rows = not
  backfilled), the SQL owned count reads 0 and would never bite — so the cap is
  computed against the Blobs owned-count until the store is backfilled. Once
  the store has rows, the SQL count governs (the transaction still checks it).

### What stays on Blobs (documented decision)

- `runout-rate-limits` (rate limiting) and the `cache:list` list-cache —
  ephemeral hot-path caches, not persistence.
- **Cover caching** (`cover:…` in `discogs-cache`/`books-cache`) — a binary
  image cache, fine at this scale; it stays Blobs-only.
- The **legacy provider caches** (`discogs-cache`/`books-cache`) remain as the
  read-through fallback + rollback mirror: with `DATABASE_URL` set,
  `discogs.js`/`books.js` read `lookup_cache` (Postgres) first and write through
  to both (see `_shared/lookup-cache.js`).
- The demo space (`collection-demo-*`) is a read-only, curated dataset and
  stays in Blobs (self-seeded) even when Postgres is configured.
