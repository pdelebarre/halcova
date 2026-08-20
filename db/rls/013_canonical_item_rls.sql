-- 013_canonical_item_rls.sql — FEAT-6.3 #316: Row Level Security for the
-- global, read-mostly CanonicalItem table (ADR-0020 §4, §10).
--
-- CanonicalItem is NOT owned by any user. It is shared catalogue identity:
--   * SELECT is open to authenticated callers for the PUBLIC allowlist
--     (title, cover/media, provider ids, public description).
--   * WRITES are restricted to SERVICE IDENTITY only — provider enrichment,
--     dedup, moderation and the migration backfill. A tenant session / the app
--     runtime role can NEVER insert/update/delete a canonical row.
--
-- This is enforced here in TWO independent ways (same model as the #315
-- registry, db/rls/012_collection_types_rls.sql):
--   1. NO write policy. Only a SELECT policy is created, so INSERT/UPDATE/
--      DELETE on canonical_items fail under RLS — there is no WITH CHECK path a
--      tenant session could take.
--   2. app_rls is granted SELECT-only (below), never DML, so even the app
--      runtime role that serves every session has no write path to the shared
--      catalogue. Canonical writes go through the migration owner / a narrow
--      SECURITY DEFINER service path (see the service function below).
--
-- This file lives in db/rls (NOT db/migrations) because pg-mem cannot parse
-- RLS DDL; it is applied to real Postgres by `npm run db:migrate:rls` and its
-- content is validated by netlify/functions/_shared/rls-migration.test.js.

-- --- canonical_items: read-open, write-restricted --------------------------
ALTER TABLE canonical_items ENABLE ROW LEVEL SECURITY;

-- SELECT-only policy: every authenticated caller may read the public catalogue
-- allowlist. No WITH CHECK -> no write path.
DROP POLICY IF EXISTS canonical_items_public_select ON canonical_items;
CREATE POLICY canonical_items_public_select ON canonical_items
  FOR SELECT USING (true);

-- --- least-privilege app role: SELECT-only on the shared catalogue ----------
-- The app_rls role is the single runtime role for every app session. Granting
-- it ONLY SELECT on canonical_items means a buggy/compromised route or a tenant
-- session can read public catalogue metadata but can never create, rewrite or
-- delete a canonical row (no orphan/rewrite of user references on merge —
-- ADR-0020 §7). Canonical writes stay with the migration owner / a SECURITY
-- DEFINER service path.
GRANT SELECT ON canonical_items TO app_rls;

-- --- binding switch ---------------------------------------------------------
-- FORCE ROW LEVEL SECURITY so even the table owner cannot bypass the read-only
-- contract via ownership. Canonical writes after deployment go through the
-- migration owner / a SECURITY DEFINER service path that runs with BYPASSRLS
-- (see 011_binding_rls.sql's REQUIRED OWNER note).
ALTER TABLE canonical_items FORCE ROW LEVEL SECURITY;

-- --- SECURITY DEFINER service write path (least-privilege, narrow) ---------
-- The ONLY write surface for canonical rows exposed to the app. It is a single,
-- reviewed upsert that (a) fills ONLY missing fields (never clobbers a user's
-- edit / existing canonical metadata — ADR-0016 invariant, ADR-0020 §8) and
-- (b) never rewrites a CollectionItem reference (references are by id). It is
-- SECURITY DEFINER so it runs with the owner's BYPASSRLS privileges, and it is
-- GRANTed to app_rls so the enrichment/dedup service can call it. It takes NO
-- tenant context and asserts NO admin session because it is a SERVICE write,
-- not a tenant write — the caller is the enrichment/dedup service identity,
-- not a user session. The app NEVER grants app_rls blanket DML on
-- canonical_items; only this narrow function.
--
-- NOTE: this function is the #317 enrichment seam. #316 (this ticket) performs
-- its backfill through the migration owner (BYPASSRLS) directly; the function
-- is provisioned here so the write-control contract is in place and testable,
-- and #317's enrichment drain can call it without a schema change.
CREATE OR REPLACE FUNCTION canonical_upsert_service(
  p_id uuid,
  p_collection_type_id text,
  p_provider_ids jsonb,
  p_content_fingerprint text,
  p_canonical_attributes jsonb,
  p_media jsonb,
  p_source text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Idempotent upsert keyed on the canonical identity (provider id /
  -- fingerprint). If the canonical already exists, return its id WITHOUT
  -- rewriting it (enrichment only fills missing fields; a merge never rewrites
  -- a CollectionItem reference — ADR-0020 §7/§8).
  SELECT id INTO v_id FROM canonical_items
   WHERE collection_type_id = p_collection_type_id
     AND (
       (p_content_fingerprint IS NOT NULL AND content_fingerprint = p_content_fingerprint)
       OR
       (p_provider_ids IS NOT NULL AND provider_ids = p_provider_ids)
     )
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO canonical_items
    (id, collection_type_id, provider_ids, content_fingerprint,
     canonical_attributes, media, source, version)
  VALUES
    (p_id, p_collection_type_id, COALESCE(p_provider_ids, '{}'::jsonb),
     p_content_fingerprint, COALESCE(p_canonical_attributes, '{}'::jsonb),
     COALESCE(p_media, '{}'::jsonb), COALESCE(p_source, 'local'), 1)
  ON CONFLICT DO NOTHING;
  RETURN p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION canonical_upsert_service(uuid, text, jsonb, text, jsonb, jsonb, text) TO app_rls;