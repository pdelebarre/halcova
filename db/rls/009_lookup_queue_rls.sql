-- 009_lookup_queue_rls.sql — T6 deferred-enrichment queue (#285) Row Level
-- Security. Mirrors 008_rls.sql (items/users + reviews) — the same
-- defense-in-depth model: the APP layer is the primary tenant boundary (every
-- lookup-queue repo method is user_id-scoped), and this migration adds the
-- matching RLS policy so a cross-tenant DB access is impossible at the DB layer
-- too. Applied to REAL Postgres by `npm run db:migrate:rls`
-- (scripts/db-migrate-rls.mjs); kept OUT of db/migrations because pg-mem
-- cannot parse RLS DDL.

-- The queue is fully tenant-scoped: a member/service identity operating for
-- tenant U can only see/insert/update/delete rows with user_id = U. The drain
-- runs per-tenant, and the admin/owner service identity bypasses RLS as the
-- table owner (same as items/users).
ALTER TABLE lookup_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lookup_queue_tenant_all ON lookup_queue;
CREATE POLICY lookup_queue_tenant_all ON lookup_queue
  USING (user_id = current_setting('app.tenant_id', true))
  WITH CHECK (user_id = current_setting('app.tenant_id', true));

-- The RLS filter is on user_id; the claim query is indexed by
-- (user_id, status, next_at) — covered by lookup_queue_tenant_due_idx.
