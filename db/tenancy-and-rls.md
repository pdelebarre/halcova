# Tenancy, RLS & Migrations Hardening (ARCH-6.1, #165 — M3 prerequisite)

This document is the authoritative record for the #165 hardening tasks: the
**tenant-owned table isolation inventory**, **binding Row-Level Security**,
**migration tooling / repeatable init**, **backup / restore / retention**, and
the **shared → dedicated schema** path. It is enforced by
`netlify/functions/_shared/rls-migration.test.js` (content/negative checks) and
by `db/migrations` running on every pg-mem-backed repo test (idempotency).

The tenancy model is **app-layer primary, DB-layer defense-in-depth**: every
repository method scopes reads/writes by the resolved session's `user.id`; the
RLS policies below make a cross-tenant DB access impossible at the DB layer too.

## 1. Isolation inventory (no tenant-owned table omitted)

A table is **tenant-owned** when any row is scoped to a tenant/member and must
never leak to another tenant at the DB layer. Each such table must have an RLS
policy (or be a documented admin-only/SECURITY-DEFINER path).

| Table | Tenant key | RLS policy (file) | Binding (FORCE) | Admin cross-tenant path |
| --- | --- | --- | --- | --- |
| `items` | `owner_id` | `items_tenant_all` (008) | 011 | `admin_delete_items_for_owner`, `admin_counts_by_kind` (011) |
| `reviews` | `author_id` (write); public read | `reviews_public_select` + `reviews_tenant_write` (008) | 011 | `admin_review_set_status`, `admin_reviews_all` (011) |
| `feedback` | `author_id` | `feedback_tenant_write` (011) | 011 | `admin_feedback_list/triage/delete` (011) |
| `lookup_queue` | `user_id` | `lookup_queue_tenant_all` (009) | 011 | service/service-identity (owner bypass) |
| `collections` | `owner_id` | `collections_tenant_all` (010) | 010/011 | service identity (registry-adjacent) |
| `collection_items` | via `Collection.owner_id` | `collection_items_tenant_all` (010) | 010/011 | service identity |
| `sessions` | `user_id` (bootstrap) | not RLS-scoped — owner/SECURITY DEFINER token lookup | — | owner role |
| `users` | self (identity registry) | not RLS-scoped — owner/SECURITY DEFINER | — | owner role |

`sessions` and `users` are deliberately NOT under per-tenant RLS: session/identity
bootstrap must resolve a token hash to a user **before** any tenant context
exists (the auth chicken-and-egg), so those reads run under the owner role / a
SECURITY DEFINER lookup, not under a per-tenant policy (see `011_binding_rls.sql`).

**Assertion:** `rls-migration.test.js` pins the inventory — it asserts each of
the six tenant-scoped tables above is covered by an RLS `ENABLE` + policy, and
that `collection_items` uses the Collection-subquery predicate (not a bare
`owner_id`).

## 2. Binding RLS (Security-Auditor blocking condition #1)

`db/rls/011_binding_rls.sql` activates the policies that 008_rls.sql documented
as the follow-up hardening:

- **Least-privilege role** `app_rls` — a `NOLOGIN` role that does **not** own any
  table; the operator grants `LOGIN` + a managed password and points the app's
  `DATABASE_URL` at it. `app_rls` is granted table-level DML only.
- **`FORCE ROW LEVEL SECURITY`** on every tenant-scoped table — the owner role
  can no longer bypass the policies.
- **Per-request tenant**: the app sets `app.tenant_id` to the resolved
  session's `user.id`. The repo wiring uses
  `set_config('app.tenant_id', $1, true)` (the `SET LOCAL`-equivalent) in
  `_shared/tenant-rls.js`, opt-in per transaction.
- **Admin cross-tenant flows** run through `SECURITY DEFINER` functions in
  011 (`admin_feedback_*`, `admin_delete_items_for_owner`,
  `admin_counts_by_kind`, `admin_review_set_status`, `admin_reviews_all`), each
  owned by the table owner and `GRANT EXECUTE`d to `app_rls`. The app never
  grants `app_rls` blanket cross-tenant DML.
- **Admin escalation backstop (HOLD A + HOLD 3)**: `app_rls` is the *single* DB
  role for both admin and non-admin sessions, so `GRANT EXECUTE` is not itself
  an admin gate. Every `SECURITY DEFINER` admin function therefore calls
  `assert_admin_session(session_token_hash)` first and **raises (fails closed,
  no DML)** unless the presenting session token resolves to an admin session.
  The admin marker is **NOT a forgeable GUC**: the original `app.admin_session`
  parameter could be set by any `app_rls` session via `set_config`. Instead the
  gate **derives admin authority inside the function** from the resolved session
  token — the app passes the bearer token's sha256 hash and the function
  re-resolves `sessions.role` under owner privileges (role `'admin'` + user
  `'owner'`). Raw tokens are opaque and only their hash is stored, so a
  non-admin can only present its own member token (fails closed). A
  missing/buggy `requireAdmin` on a future route can no longer reach these
  functions; the DB layer refuses the call. This is the DB-level control and
  does **not** rely on app-layer `requireAdmin` alone.
- **`sessions` is SELECT-only for `app_rls` (HOLD 2)**: `sessions.role` is the
  admin-authority source, so `app_rls` has **no** `INSERT`/`UPDATE`/`DELETE` on
  `sessions` — a non-admin cannot self-promote or read/revoke others' sessions
  at cutover. Session writes (create/renew/revoke/delete) run through the owner
  role / a SECURITY DEFINER path that `app_rls` cannot reach.

**Cutover ordering (safe, non-breaking):** provision `app_rls` + point
`DATABASE_URL` at it → deploy the SET LOCAL wiring (this PR) → apply 011
(FORCE RLS). Applying FORCE while still connecting as the owner **and** without
the wiring would hide every tenant row (fails closed) — that is intended once
the cutover completes. There is no live Postgres in the sandbox; the deploy
owner performs this against the managed DB.

**Wiring the admin + tenant context into the running app (cutover step, not in
#165):** the request/pool-level plumbing of `app.tenant_id` for *every* repo
call, and routing the admin handlers (`countsByKind`, `deleteAllForOwner`,
feedback/review admin) through the `SECURITY DEFINER` functions passing the
resolved session token hash (`_shared/tenant-rls.js` `sessionTokenHash`), is the
**cutover step** that activates binding RLS in production. It is deliberately
**not** part of #165 (which ships the schema, policies, role, admin gate and
enforcement tests); the gate and tests here make the surface safe to ship
un-wired. `sessionTokenHash` and `withTenantTransaction` provide the primitives
the cutover wires in.

**REQUIRED OWNER (BYPASSRLS):** `SECURITY DEFINER` alone does **not** bypass
`FORCE RLS` — that requires the function owner to be superuser or to hold the
`BYPASSRLS` attribute. This migration is applied by the schema-provisioning
owner/superuser; if provisioning with a non-superuser owner, run
`ALTER ROLE <owner> BYPASSRLS;` after schema provision so the admin functions
keep working under FORCE RLS.

## 3. Real-Postgres enforcement tests (HOLD B)

`netlify/functions/_shared/rls-integration.test.js` connects to a **real**
PostgreSQL server as the least-privilege `app_rls` role and proves:
1. a cross-tenant `SELECT` returns 0 rows and a cross-tenant `INSERT`/`UPDATE`
   is rejected (fail closed);
2. a **non-admin** `app_rls` session **cannot** invoke the `SECURITY DEFINER`
   admin functions — even after forging `app.admin_session` — because authority
   is derived from the session token, not the GUC (HOLD 3);
3. the same functions **do** work once a **real admin session token** is
   presented (the authorized path);
4. `app_rls` has **no DML grant on `sessions`** (SELECT-only) — no
   self-promotion or session tampering (HOLD 2).

The suite is **skipped** unless `RLS_INTEGRATION=1` and both `RLS_SUPER_URL`
(owner/superuser) and `RLS_APP_RLS_URL` (`app_rls` with `LOGIN`) are set and
reachable — so it can never false-pass on pg-mem or in a default `npm test`.
`security-ci.yml` runs it as the **blocking** `rls-integration` job (real
Postgres service container, `app_rls` provisioned `WITH LOGIN`), so the
enforcement is proven by execution on every PR/merge, not skipped. Run it
locally against a real Postgres with:

```bash
RLS_INTEGRATION=1 \
RLS_SUPER_URL=postgres://owner@…/runout \
RLS_APP_RLS_URL=postgres://app_rls:<pw>@…/runout \
npm run db:test:rls     # applies db/rls then runs rls-integration.test.js
```

`npm run db:test:rls` first runs `npm run db:migrate:rls` (so `DATABASE_URL`
must point at the owner/superuser connection too, or apply the migrations
beforehand).

### Residual risk (documented, out of scope for #165)

The admin gate (`assert_admin_session`) closes the **app-layer latent-elevation
vector**: a missing/buggy `requireAdmin` on a future admin route can no longer
reach the cross-tenant `SECURITY DEFINER` functions — the DB refuses the call
unless a real admin session token is presented. It is **not** a defense against
a directly compromised DB identity or arbitrary SQL execution:

- **Leaked `app_rls` credential** — the `app_rls` DB role holds broad table-level
  DML on tenant-scoped tables (that is its job at cutover). A leaked `app_rls`
  credential lets an attacker read/write tenant data directly as any tenant
  (`app.tenant_id` is a settable GUC at the DB layer). That is a separate
  control (secret management, connection encryption, credential rotation,
  network egress) and is **not** mitigated by the admin gate.
- **Arbitrary SQL injection** — any injection that lets an attacker run arbitrary
  SQL as `app_rls` can read/mutate tenant data regardless of RLS scope. This is a
  separate application-layer control (parameterized queries, the existing
  security audit), not the DB gate. The admin functions remain safe from a
  *member-level* SQL injection (a member cannot fabricate an admin session
  token), but a *role-level* injection that already runs as `app_rls` can access
  the tenant data that role legitimately holds.

## 3. Migration tooling & repeatable initialization

- **Ordered SQL migrations** in `db/migrations/*.sql`, applied by
  `scripts/db-migrate.mjs` (`npm run db:migrate`). Each file runs in its own
  transaction and is recorded in `schema_migrations`, so re-running is a
  no-op (idempotent). The same SQL is applied by every pg-mem-backed repo test
  (`repositories/test-helpers.js`), so migrations are exercised on every run.
- **RLS DDL** lives in `db/rls/*.sql`, applied by
  `scripts/db-migrate-rls.mjs` (`npm run db:migrate:rls`) to real Postgres only.
  pg-mem cannot parse RLS DDL, so this split is enforced (008/009/010/011) and
  validated by `rls-migration.test.js`. **Do not put RLS DDL in `db/migrations`.**
- **Repeatable init / restore**: apply migrations to an empty DB, then backfill
  (`scripts/backfill.mjs`) — same path as the original provision (db/README.md).

## 4. Backup, restore & retention

**Backup (operator, managed Postgres):**
```bash
# Logical dump — schemas + data (excludes nothing; includes schema_migrations).
pg_dump --no-owner --format=plain --file=runout_$(date +%F).sql "$DATABASE_URL"
# Streaming/point-in-time is managed by the provider (e.g. RDS/Neon automated
# snapshots + PITR). Logical dumps are the portable, manual safety net.
```

**Restore (documented + tested):** the acceptance criterion "restore procedure is
documented and tested" maps to: migrations are additive/idempotent and re-apply
cleanly to a fresh database, which `db-migrate.test.js` proves on every run
(apply → apply again = no-op; data written after the first run survives a second
run). A full restore is:
```bash
# 1. Create/point DATABASE_URL at a fresh database.
# 2. Re-create schema: npm run db:migrate && npm run db:migrate:rls
# 3. Load the logical dump: psql "$DATABASE_URL" < runout_<date>.sql
# 4. Backfill any Blobs-only drift: node scripts/backfill.mjs
```
Reversibility is guaranteed by ADR-0014 (additive, reverse-mapping rollback): the
legacy `items` table + Blob stores are preserved, so no stage irreversibly
deletes data. Hard-purging tombstones / retiring legacy stores requires a
reconciliation PASS + documented retention window + approved retirement ADR.

**Retention:** soft-deleted `collection_items` carry `tombstoned_at` + `purge_at`;
`purge_at` schedules hard deletion only after the documented retention window and
reconciliation (§7 ADR-0020). Identity/auth tables (`users`, `sessions`) follow
the product's account/retention policy; sessions expire server-side.

## 5. Shared → dedicated schema path

The generic model (ADR-0020) is schema-agnostic: tenancy is a **column**
(`owner_id` / via `Collection.owner_id`) in the shared schema today. The path to
dedicated isolation for enterprise tenants is a **topology change, not a model
change**:

1. **Shared schema (current):** all tenants in one `public` schema, isolated by
   the owner-scoped columns + binding RLS (§2). Correct at the current scale.
2. **Per-tenant schema (medium):** a tenant's `collections`/`collection_items`
   rows moved to a dedicated schema (or a partitioned set keyed by tenant)
   while `canonical_items`/`collection_types` stay global. RLS policies already
   key on `owner_id`, so this is a physical move of owned rows only.
3. **Dedicated database (enterprise):** a tenant gets its own database; global
   catalogue is replicated/read-mostly. Chosen when legal/compliance isolation
   or tenant scale requires a hard boundary.

Because every migration here is additive/idempotent and tenancy is a column, this
is a **forward-compatible** path: nothing in the shared schema prevents a
per-tenant move later, and no tenant-owned table is tied to the shared schema.

## Scope guardrail

#165 is the M3 **schema/tenancy/migration** prerequisite only. The registry
seed (`collection_types`), the legacy→generic **backfill/reconciliation**, and
the provider adapter layer are owned by #315/#316/#317 and serialize AFTER this
work; they are NOT implemented here.
