-- 010_rls_generic_collections.sql — ARCH-6.1 #165: Row Level Security for the
-- tenant-owned generic collection tables introduced in migration
-- db/migrations/010_collections.sql (ADR-0020 §3/§5).
--
-- Same defense-in-depth model as 008_rls.sql / 009_lookup_queue_rls.sql: the
-- APP layer is the primary tenant boundary (every future repo method derives
-- ownership from the resolved session's user.id); these policies make a
-- cross-tenant DB access impossible at the DB layer too.
--
-- This file lives in db/rls (NOT db/migrations) because pg-mem — the emulator
-- the repo unit tests run against — cannot PARSE RLS DDL, so it is applied to
-- real Postgres by `npm run db:migrate:rls` (scripts/db-migrate-rls.mjs) and
-- its content is validated by netlify/functions/_shared/rls-migration.test.js.
--
-- Critical predicate (Security-Auditor blocking condition #2): CollectionItem
-- has NO owner_id column — ownership flows through Collection.owner_id
-- (ADR-0020 §10). The predicate is therefore resolved via a COLLECTION
-- SUBQUERY (EXISTS ... FROM collections c WHERE c.id =
-- collection_items.collection_id AND c.owner_id = current_setting(...)), NOT a
-- bare `owner_id = current_setting('app.tenant_id', true)` — a bare predicate
-- would compare a non-existent column and silently allow every row.
--
-- FORCE ROW LEVEL SECURITY (the "binding" switch) is applied here so these
-- tables are binding for the table owner too; the least-privilege role +
-- SECURITY DEFINER admin paths are provisioned in 011_binding_rls.sql.

-- --- collections: fully tenant-scoped on owner_id ---------------------------
-- A member/service identity operating for tenant U can only see/insert/update/
-- delete collections with owner_id = U.
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collections_tenant_all ON collections;
CREATE POLICY collections_tenant_all ON collections
  USING (owner_id = current_setting('app.tenant_id', true))
  WITH CHECK (owner_id = current_setting('app.tenant_id', true));

-- --- collection_items: tenant-scoped VIA the owning Collection --------------
-- There is no owner_id here. A row is visible/writable iff the Collection it
-- belongs to is owned by the current tenant. An unset tenant fails closed (the
-- EXISTS subquery's owner_id compare against NULL never matches -> no rows).
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_items_tenant_all ON collection_items;
CREATE POLICY collection_items_tenant_all ON collection_items
  USING (
    EXISTS (
      SELECT 1 FROM collections c
      WHERE c.id = collection_items.collection_id
        AND c.owner_id = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM collections c
      WHERE c.id = collection_items.collection_id
        AND c.owner_id = current_setting('app.tenant_id', true)
    )
  );

-- --- binding switch ----------------------------------------------------------
-- A table owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set. These two
-- tables are FORCED so the app role (which owns them today) cannot bypass the
-- tenant predicate. See 011_binding_rls.sql for the least-privilege role that
-- formalizes this for the pre-existing tenant tables too.
ALTER TABLE collections FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_items FORCE ROW LEVEL SECURITY;
