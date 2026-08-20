-- 011_binding_rls.sql — ARCH-6.1 #165: BINDING Row Level Security (M3
-- prerequisite; Security-Auditor blocking condition #1). Applied to real
-- Postgres ONLY by `npm run db:migrate:rls` (scripts/db-migrate-rls.mjs) and
-- validated by netlify/functions/_shared/rls-migration.test.js. pg-mem cannot
-- parse this file, so it is deliberately NOT part of db/migrations.
--
-- This is the follow-up 008_rls.sql documented as the "binding" hardening:
--   * deploy a LEAST-PRIVILEGE role that does NOT own the tables;
--   * set FORCE ROW LEVEL SECURITY so the table owner can no longer bypass
--     the tenant policies (without it, a table owner bypasses RLS);
--   * the app sets the tenant per request:  SET LOCAL app.tenant_id = '<id>'
--     (the repo wiring uses set_config('app.tenant_id', $1, true), which is
--     the SET-LOCAL-equivalent for a custom GUC — see _shared/tenant-rls.js);
--   * admin / owner cross-tenant flows (feedback inbox, member deletion,
--     dashboard aggregates, review management) run through SECURITY DEFINER
--     functions here so requireAdmin-gated operations keep working under RLS.
--
-- Cutover ordering (safe, non-breaking): this migration MUST ship together
-- with the repo wiring in _shared/tenant-rls.js and the app role switch.
--   1. Provision `app_rls` (below) and set the app's DATABASE_URL to its
--      credentials — the app then connects as a NON-OWNER.
--   2. Deploy the SECURITY DEFINER admin functions + SET LOCAL wiring.
--   3. Apply this migration (FORCE RLS). Because the app now connects as
--      app_rls (non-owner, no bypass) and sets app.tenant_id per request,
--      FORCE does not lock anything out; the owner role is simply no longer
--      the app's identity. Applying FORCE while still connecting as the owner
--      AND without the SET LOCAL wiring would hide every tenant row (fails
--      closed) — that is the intended semantics once the cutover is complete.
--
-- NOTE: `users` and `sessions` are deliberately NOT FORCED. Session/identity
-- bootstrap must resolve a token hash to a user BEFORE any tenant context
-- exists (the auth chicken-and-egg), so those reads run under the owner role /
-- a SECURITY DEFINER lookup, not under a per-tenant RLS policy.

-- --- Least-privilege app role (does NOT own the tables) ---------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls') THEN
    CREATE ROLE app_rls NOLOGIN;
  END IF;
END;
$$;
-- The operator grants LOGIN + sets a password when wiring DATABASE_URL, e.g.:
--   ALTER ROLE app_rls WITH LOGIN PASSWORD '<managed-secret>';

GRANT USAGE ON SCHEMA public TO app_rls;

-- Table-level DML on every tenant-scoped table. app_rls owns none of these.
GRANT SELECT, INSERT, UPDATE, DELETE ON items TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON reviews TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON lookup_queue TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_items TO app_rls;
-- identity/registry: app_rls may read users; token/session reads stay owner/
-- SECURITY DEFINER (see note above). Admin user writes go through the owner
-- role or a SECURITY DEFINER function, not this role.
GRANT SELECT ON users TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO app_rls;

-- --- FORCE ROW LEVEL SECURITY (binding) on the tenant-scoped tables ---------
ALTER TABLE items FORCE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE lookup_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE collections FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_items FORCE ROW LEVEL SECURITY;

-- feedback had NO policy yet — add the author-scoped policy before forcing it
-- (FORCE with no policy would hide every row). The admin inbox reads cross-
-- tenant through the SECURITY DEFINER functions below.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_tenant_write ON feedback;
CREATE POLICY feedback_tenant_write ON feedback
  FOR ALL
  USING (author_id = current_setting('app.tenant_id', true))
  WITH CHECK (author_id = current_setting('app.tenant_id', true));
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;

-- --- SECURITY DEFINER admin/owner cross-tenant functions --------------------
-- Each is OWNED by the table owner (the superuser/owner that provisions the
-- schema) and SECURITY DEFINER, so it executes with the owner's privileges and
-- BYPASSES RLS. GRANT EXECUTE to app_rls so the app can call them through the
-- requireAdmin-gated repo layer. The app NEVER grants app_rls blanket
-- cross-tenant DML — only these narrow, reviewed functions.
--
-- PRIVILEGE-ESCALATION BACKSTOP (Multi-tenant-Security HOLD A, #165):
-- `app_rls` is the SINGLE DB role that serves BOTH admin and non-admin app
-- sessions, so EXECUTE on the function is NOT by itself an admin gate — an
-- ordinary tenant session could call it and read/mutate every tenant's rows.
-- Every admin function below therefore asserts an ADMIN session context
-- (assert_admin_session()) FIRST and RAISES (fails closed, no DML) when it is
-- absent. The app sets `app.admin_session` ONLY after requireAdmin() passes in
-- the repo layer (_shared/tenant-rls.js setAdminContext). A buggy/missing
-- requireAdmin on any future route can no longer reach these functions — the
-- DB layer refuses the call. This is the DB-level control; it does not rely on
-- the app-layer requireAdmin alone.
--
-- REQUIRED OWNER (BYPASSRLS): SECURITY DEFINER alone does NOT bypass FORCE RLS
-- — that requires the function OWNER to be superuser or to hold the BYPASSRLS
-- attribute. This migration is applied by the owner/superuser that provisions
-- the schema; if provisioning with a non-superuser owner, run:
--   ALTER ROLE <owner> BYPASSRLS;   (after schema provision)
-- so the admin cross-tenant functions keep working under FORCE RLS. Integration
-- tests in rls-integration.test.js verify the owner has this capability.

-- Fail-closed ADMIN gate, called by every SECURITY DEFINER admin function
-- below. Raises (SQLSTATE 42501, insufficient_privilege) unless the session
-- carries the admin context that the requireAdmin-gated app layer set.
CREATE OR REPLACE FUNCTION assert_admin_session()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.admin_session', true), '') <> '1' THEN
    RAISE EXCEPTION 'insufficient_privilege: admin session context required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Feedback inbox: cross-tenant read for the admin triage view.
CREATE OR REPLACE FUNCTION admin_feedback_list()
RETURNS SETOF feedback
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_session();
  RETURN QUERY SELECT * FROM feedback ORDER BY created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_feedback_list() TO app_rls;

-- Feedback triage: cross-tenant status/admin_note update for the admin inbox.
CREATE OR REPLACE FUNCTION admin_feedback_triage(
  fb_id uuid,
  new_status text,
  note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_session();
  UPDATE feedback
     SET status = new_status,
         admin_note = note,
         updated_at = now(),
         version = version + 1
   WHERE id = fb_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_feedback_triage(uuid, text, text) TO app_rls;

-- Feedback delete: cross-tenant delete for the admin inbox.
CREATE OR REPLACE FUNCTION admin_feedback_delete(fb_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_session();
  DELETE FROM feedback WHERE id = fb_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_feedback_delete(uuid) TO app_rls;

-- Member deletion cleanup: delete every item for a departing member across all
-- kinds (the owner-scoped repository's deleteAllForOwner under binding RLS).
CREATE OR REPLACE FUNCTION admin_delete_items_for_owner(owner text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  PERFORM assert_admin_session();
  WITH deleted AS (
    DELETE FROM items WHERE owner_id = owner RETURNING id
  )
  SELECT count(*)::integer INTO n FROM deleted;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_items_for_owner(text) TO app_rls;

-- Dashboard aggregate: owned item totals by kind across ALL owners (the admin
-- dashboard's countsByKind under binding RLS).
CREATE OR REPLACE FUNCTION admin_counts_by_kind()
RETURNS TABLE(kind text, count integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_session();
  RETURN QUERY
    SELECT i.kind, count(*)::integer
      FROM items i
     WHERE NOT i.wishlist
     GROUP BY i.kind;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_counts_by_kind() TO app_rls;

-- Review management: admin hide/show of any review (cross-author).
CREATE OR REPLACE FUNCTION admin_review_set_status(rev_id uuid, new_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_session();
  UPDATE reviews
     SET status = new_status,
         updated_at = now(),
         version = version + 1
   WHERE id = rev_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_review_set_status(uuid, text) TO app_rls;

-- Reviews listing for admin moderation (all statuses, cross-author).
CREATE OR REPLACE FUNCTION admin_reviews_all()
RETURNS SETOF reviews
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_session();
  RETURN QUERY SELECT * FROM reviews ORDER BY created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_reviews_all() TO app_rls;
