-- 014_ai_provider_profiles_rls.sql — ADMIN-3.2 #304: Row Level Security for
-- the owner-only AI provider-profile table (ADR-0018 access model).
--
-- ai_provider_profiles is OWNER-ONLY platform configuration, not tenant data.
-- Every session — admin and member alike — connects to Postgres as the single
-- `app_rls` runtime role, so the DB layer cannot distinguish an admin session
-- from a member session (the admin boundary is enforced in the application by
-- `requireAdmin` / `enforce(req,'admin:*')` in admin.js, per SEC-1.6 #181).
--
-- The RLS posture here therefore mirrors the app-layer truth:
--   * Only `app_rls` (the runtime role) may read/write this table; the shared
--     PUBLIC role and any other role are denied outright (a DB user without
--     the app role can never touch the table, even by mistake).
--   * The membership-vs-owner distinction stays at the application layer
--     (requireAdmin), because RLS cannot express it without a per-role split
--     the app does not use.
--
-- This file lives in db/rls (NOT db/migrations) because pg-mem cannot parse
-- RLS DDL; it is applied to real Postgres by `npm run db:migrate:rls` and its
-- content is validated by rls-migration.test.js.

ALTER TABLE ai_provider_profiles ENABLE ROW LEVEL SECURITY;

-- app_rls is the single runtime role for every app session; the requireAdmin
-- gate in admin.js is the authorization boundary. No PUBLIC read or write.
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_provider_profiles TO app_rls;

-- No policy for the PUBLIC role / others -> every other role sees no rows and
-- can write none (RLS fails closed with no matching policy).
