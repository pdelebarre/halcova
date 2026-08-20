-- 012_collection_types_rls.sql — FEAT-6.2 #315: Row Level Security for the
-- Collection Type Registry (ADR-0020 §10).
--
-- CollectionType is GLOBAL REGISTRY data: read-open to authenticated callers
-- for the public allowlist, write-restricted to service/vetted identity only.
-- A client can never supply or override a type/capability/field definition
-- (ADR-0020 §2 dec 6). This is enforced here in TWO independent ways:
--
--   1. NO write policy. Only a SELECT policy is created, so INSERT/UPDATE/
--      DELETE on collection_types / collection_type_fields fail under RLS —
--      there is no WITH CHECK path a tenant session could take.
--   2. app_rls is granted SELECT-only (below), never DML, so even the app
--      runtime role that serves every session has no write path to the
--      registry. Registry mutation is the migration owner / a narrow SECURITY
--      DEFINER service path only.
--
-- This file lives in db/rls (NOT db/migrations) because pg-mem cannot parse
-- RLS DDL; it is applied to real Postgres by `npm run db:migrate:rls` and its
-- content is validated by netlify/functions/_shared/rls-migration.test.js.

-- --- collection_types: read-open, write-restricted -------------------------
ALTER TABLE collection_types ENABLE ROW LEVEL SECURITY;

-- SELECT-only policy: every authenticated caller may read the registry (the
-- labels/icons/capabilities a UI renders). No WITH CHECK -> no write path.
DROP POLICY IF EXISTS collection_types_public_select ON collection_types;
CREATE POLICY collection_types_public_select ON collection_types
  FOR SELECT USING (true);

-- --- collection_type_fields: read-open, write-restricted -------------------
ALTER TABLE collection_type_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_type_fields_public_select ON collection_type_fields;
CREATE POLICY collection_type_fields_public_select ON collection_type_fields
  FOR SELECT USING (true);

-- --- least-privilege app role: SELECT-only on the registry -----------------
-- The app_rls role is the single runtime role for every app session. Granting
-- it ONLY SELECT on the registry means a buggy/compromised route or a tenant
-- session can read type metadata but can never add or redefine a type, field,
-- capability or provider mapping. Registry writes stay with the migration
-- owner / a SECURITY DEFINER service path.
GRANT SELECT ON collection_types TO app_rls;
GRANT SELECT ON collection_type_fields TO app_rls;

-- --- binding switch ---------------------------------------------------------
-- FORCE ROW LEVEL SECURITY so even the table owner cannot bypass the read-only
-- contract via ownership. Registry writes after deployment go through the
-- migration owner / a SECURITY DEFINER path that runs with BYPASSRLS (see
-- 011_binding_rls.sql's REQUIRED OWNER note).
ALTER TABLE collection_types FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_type_fields FORCE ROW LEVEL SECURITY;
