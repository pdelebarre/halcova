-- 008_rls.sql — PostgreSQL Row Level Security (SEC-EPIC-2, #190)
--
-- Defense-in-depth at the DB layer for tenant isolation. The APP layer is the
-- primary enforcement (every repo method is owner-scoped by the resolved
-- session's user.id — a cross-tenant read/write is impossible there already);
-- this migration adds the matching RLS policies so a cross-tenant DB access is
-- impossible at the DB layer too.
--
-- Why this file lives in db/rls (not db/migrations):
--   The pg-mem in-memory emulator used by the repo unit tests cannot PARSE RLS
--   DDL (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`) nor
--   `current_setting(...)`, so including it in the shared db/migrations set
--   would break every repo test. It is therefore applied to real Postgres by
--   its own runner (`npm run db:migrate:rls` -> scripts/db-migrate-rls.mjs)
--   and its content is validated by a dedicated migration-safety test
--   (netlify/functions/_shared/rls-migration.test.js).
--
-- Authentication model (single DB role):
--   The app connects to Postgres with a single role (the pool's DATABASE_URL
--   user) that OWNS these tables. A table owner BYPASSES row-level security
--   unless `FORCE ROW LEVEL SECURITY` is set, so today these policies do NOT
--   restrict the app's own queries — the app-layer owner-scoping is what
--   actually protects data, and this migration is safe/non-breaking as a
--   result (the admin/owner cross-tenant paths — member deletion
--   `deleteAllForOwner`, admin review management — keep working through the
--   owner bypass).
--
--   To make these policies BINDING, deploy a LEAST-PRIVILEGE role that does
--   NOT own the tables and set `FORCE ROW LEVEL SECURITY`, then have the app
--   set the tenant per request:
--       SET LOCAL app.tenant_id = '<resolved user.id>';
--   (per-request, inside the repo transaction for writes and at the top of
--   the request for reads — see the SEC-EPIC-2 report / #190 follow-up). The
--   admin cross-tenant paths would then go through a SECURITY DEFINER function
--   (or a role that is granted bypass) so `requireAdmin`-gated flows keep
--   working. That hardening is tracked as a follow-up; the policies below are
--   the model it activates.
--
-- Tenant session variable:
--   `app.tenant_id` is read via current_setting('app.tenant_id', true)
--   (missing_ok=true -> NULL when unset). Under binding RLS, an unset var
--   yields no rows for tenant-scoped tables (NULL compares are never true),
--   which fails CLOSED.

-- --- items: fully tenant-scoped --------------------------------
-- A member can only see/insert/update/delete their OWN rows (owner_id).
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_tenant_all ON items;
CREATE POLICY items_tenant_all ON items
  USING (owner_id = current_setting('app.tenant_id', true))
  WITH CHECK (owner_id = current_setting('app.tenant_id', true));

-- --- reviews: public reads, tenant-scoped writes -----------------
-- A release's reviews are intentionally PUBLIC to every authenticated caller
-- (the reviews API serves them to all users), so SELECT is open. But a member
-- may only insert/update/delete THEIR OWN reviews (author_id) — matching the
-- app-level ownership check in reviews.js.
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_public_select ON reviews;
CREATE POLICY reviews_public_select ON reviews FOR SELECT USING (true);

DROP POLICY IF EXISTS reviews_tenant_write ON reviews;
CREATE POLICY reviews_tenant_write ON reviews
  FOR ALL
  USING (author_id = current_setting('app.tenant_id', true))
  WITH CHECK (author_id = current_setting('app.tenant_id', true));

-- Supporting index: the RLS policies filter on owner_id/author_id, which the
-- existing owner-scoped indexes already cover (items_owner_kind_idx on
-- items(owner_id, kind); reviews_author_idx on reviews(author_id)). No new
-- index is required.
