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

## Commands

```bash
npm run db:migrate                                   # apply pending migrations
DATABASE_URL=postgres://user:pass@host:5432/runout npm run db:migrate
```

## DEPLOY-TIME OWNER STEPS (not verifiable in the dev/test sandbox)

There is **no live Postgres** in the sandbox, so these must be run by the site
owner against the real managed database:

1. **Provision the database** (e.g. a managed Postgres on your cloud provider).
2. **Run the migration**: `DATABASE_URL=… npm run db:migrate` — creates
   `schema_migrations`, `users`, `requests`, `items`, `lookup_cache` + indexes.
3. **Backfill (Part B, next delegation)**: copy the owner's legacy stores
   (`runout-collection` / `runout-library`) and each member's
   `collection-<userId>-<kind>` store into `items`, and `runout-identity` into
   `users`/`requests`, **before** serving reads from Postgres. Backfill is
   non-destructive — legacy Blob stores are never renamed or deleted, so the
   migration is fully reversible.
4. **Enable read-through**: set `DATABASE_URL` in the Netlify environment
   (functions env). Reads are then served DB-first and fall back to Blobs on
   miss/error. Until backfill runs on a store, that store's reads keep coming
   from Blobs (an empty DB result falls back) — but a store that is only
   *partially* backfilled would serve partial data, so backfill first.
5. **Verify with `netlify dev` + a real `DATABASE_URL`**: sign in (admin key +
   member code), add/update/delete items in both collections, confirm the plan
   cap (SQL count) and per-member isolation, then confirm the same with the
   variable unset (Blobs-only) to prove the fallback.
6. **Deploy with `netlify deploy --build`** (never drag-and-drop `dist`).

### What stays on Blobs (documented decision)

- `runout-rate-limits` (rate limiting), the `cache:list` list-cache, cover
  caching (`cover:…`), and `discogs-cache` / `books-cache` — ephemeral hot-path
  caches, not persistence. `lookup_cache` in Postgres is implemented + tested
  and ready for Part B to flip `discogs.js`/`books.js` over.
- The demo space (`collection-demo-*`) is a read-only, curated dataset and
  stays in Blobs (self-seeded) even when Postgres is configured.
