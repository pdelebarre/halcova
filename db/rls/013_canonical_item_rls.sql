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
-- This is enforced here in THREE independent ways:
--   1. NO write policy. Only a SELECT policy is created, so INSERT/UPDATE/
--      DELETE on canonical_items fail under RLS — there is no WITH CHECK path a
--      tenant session could take.
--   2. app_rls is granted SELECT-only (below), never DML, so even the app
--      runtime role that serves every session has no write path to the shared
--      catalogue.
--   3. The ONLY write surface is a SECURITY DEFINER service function
--      (canonical_upsert_service) that (i) asserts an UNFORGEABLE service
--      identity (Security-Auditor HOLD A) — a dedicated `canonical_service`
--      role, not a settable marker — and (ii) validates/sanitizes every caller
--      payload against the public allowlist before it reaches the FORCE-RLS
--      table. GRANT EXECUTE is limited to `canonical_service` (revoked from
--      app_rls and the default PUBLIC EXECUTE), so EXECUTE privilege is NO
--      LONGER exposed to the shared tenant role.
--
-- This file lives in db/rls (NOT db/migrations) because pg-mem cannot parse
-- RLS DDL; it is applied to real Postgres by `npm run db:migrate:rls` and its
-- content is validated by netlify/functions/_shared/rls-migration.test.js.

-- --- dedicated service role (least privilege, like app_rls) -----------------
-- The enrichment/dedup service connects as `canonical_service` with operator-
-- managed credentials (NOLOGIN here; the operator grants LOGIN + a password
-- when wiring the service DATABASE_URL, exactly like app_rls in 011). Only
-- this role may invoke the canonical write surface. A tenant session connects
-- as app_rls and CANNOT assume canonical_service (no membership), so the DB
-- layer can tell the two apart unforgeably via session_user.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'canonical_service') THEN
    CREATE ROLE canonical_service NOLOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA public TO canonical_service;

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
-- ADR-0020 §7). Canonical writes require the service function below.
GRANT SELECT ON canonical_items TO app_rls;

-- --- binding switch ---------------------------------------------------------
-- FORCE ROW LEVEL SECURITY so even the table owner cannot bypass the read-only
-- contract via ownership. Canonical writes after deployment go through the
-- migration owner / the SECURITY DEFINER service function that runs with
-- BYPASSRLS (see 011_binding_rls.sql's REQUIRED OWNER note).
ALTER TABLE canonical_items FORCE ROW LEVEL SECURITY;

-- --- SECURITY DEFINER service write path (least-privilege, narrow) ---------
-- The ONLY write surface for canonical rows. It is a single, reviewed upsert
-- that (a) fills ONLY missing fields (never clobbers existing canonical
-- metadata — ADR-0016 invariant, ADR-0020 §8), (b) never rewrites a
-- CollectionItem reference (references are by id), (c) derives the row id
-- SERVER-SIDE (it never trusts a caller-supplied id), and (d) validates/
-- sanitizes every caller payload against the public allowlist before it can
-- reach the shared FORCE-RLS catalogue.
--
-- SERVICE IDENTITY gate (Security-Auditor HOLD A #316, same doctrine as
-- assert_admin_session in #165): `app_rls` is the single DB role serving BOTH
-- admin and non-admin tenant sessions, so GRANT EXECUTE is NOT by itself a
-- service gate — a tenant session could call it and poison the shared
-- catalogue. The gate here is the UNFORGEABLE DB-layer service identity: the
-- enrichment/dedup service connects as the dedicated `canonical_service` role,
-- and the function asserts `session_user = 'canonical_service'` FIRST and
-- RAISES (fails closed, no DML) otherwise. `session_user` reflects the
-- authenticating DB role and cannot be forged with a settable GUC
-- (`set_config` cannot change it) nor assumed by a tenant session unless the
-- operator granted it `SET ROLE canonical_service`. In addition, GRANT EXECUTE
-- is limited to `canonical_service` (REVOKEd from app_rls and the default
-- PUBLIC EXECUTE), so the gate never relies on app_rls EXECUTE.
--
-- NOTE: this function is the #317 enrichment seam. #316 (this ticket) performs
-- its backfill through the migration owner (BYPASSRLS) directly; the function
-- is provisioned here so the write-control contract is in place and testable,
-- and #317's enrichment drain can call it without a schema change.

-- --- service identity helper (unforgeable at the DB layer) ------------------
CREATE OR REPLACE FUNCTION assert_service_identity()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'canonical_service' THEN
    RAISE EXCEPTION 'insufficient_privilege: canonical service session required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION assert_service_identity() FROM PUBLIC;

-- --- public payload sanitizer (stored-XSS guard + allowlist) ---------------
-- Canonical metadata is PUBLIC + cacheable (rendered in the shared catalogue),
-- so anything written here must be safe to serve to every tenant. Rejects:
--   * a non-object JSON value (provider ids / attributes / media must be JSON
--     objects, never arrays or primitives);
--   * more than p_max_keys fields;
--   * a key outside p_allowed_keys (when supplied);
--   * a nested object/array leaf (flat public metadata only);
--   * a string leaf containing HTML control chars ('<','>','{','}') — stored-
--     XSS guard for the public allowlist — or longer than 500 chars.
CREATE OR REPLACE FUNCTION assert_clean_public_jsonb(
  p_label text,
  p_value jsonb,
  p_max_keys integer,
  p_allowed_keys text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_key_count integer;
  r record;
  v_val text;
BEGIN
  IF p_value IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'invalid %: must be a JSON object', p_label USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_value);
  IF v_key_count > p_max_keys THEN
    RAISE EXCEPTION 'invalid %: too many keys', p_label USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_each(p_value)
  LOOP
    IF p_allowed_keys IS NOT NULL AND NOT (r.key = ANY(p_allowed_keys)) THEN
      RAISE EXCEPTION 'invalid %: disallowed key "%"', p_label, r.key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(r.value) IN ('object','array') THEN
      RAISE EXCEPTION 'invalid %: nested % value is not allowed', p_label, jsonb_typeof(r.value) USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(r.value) = 'string' THEN
      v_val := r.value #>> '{}';
      IF v_val ~ '[<>{}]' OR char_length(v_val) > 500 THEN
        RAISE EXCEPTION 'invalid %: value contains disallowed characters or exceeds length', p_label USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION assert_clean_public_jsonb(text, jsonb, integer, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION canonical_upsert_service(
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
  -- SERVICE IDENTITY gate (unforgeable DB-layer role, not a settable marker).
  PERFORM assert_service_identity();

  -- Reference integrity: the collection type must already be registered.
  IF NOT EXISTS (SELECT 1 FROM collection_types WHERE id = p_collection_type_id) THEN
    RAISE EXCEPTION 'invalid collection_type_id "%"', p_collection_type_id USING ERRCODE = '23503';
  END IF;

  -- PAYLOAD VALIDATION / sanitization (HOLD A #316): only the public allowlist
  -- reaches the shared FORCE-RLS catalogue. provider_ids is restricted to the
  -- provider keys the registry owns (ADR-0016; matches the unique indexes in
  -- migration 012); canonical_attributes / media are open, flat, sanitized JSON
  -- objects (stored-XSS guard).
  PERFORM assert_clean_public_jsonb('provider_ids', p_provider_ids, 8,
    ARRAY['discogsId','mbid','googleBooksId','openLibraryId']);
  PERFORM assert_clean_public_jsonb('canonical_attributes', p_canonical_attributes, 100);
  PERFORM assert_clean_public_jsonb('media', p_media, 20);
  IF p_content_fingerprint IS NOT NULL THEN
    IF char_length(p_content_fingerprint) > 128 OR p_content_fingerprint !~ '^[A-Za-z0-9_-]+$' THEN
      RAISE EXCEPTION 'invalid content_fingerprint' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_source IS NOT NULL AND p_source !~ '^[A-Za-z0-9_-]{1,32}$' THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  -- Idempotent upsert keyed on the canonical identity (provider id / fingerprint).
  -- If the canonical already exists, return its id WITHOUT rewriting it (enrichment
  -- only fills missing fields; a merge never rewrites a CollectionItem reference —
  -- ADR-0020 §7/§8).
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

  -- The row id is DERIVED SERVER-side. The caller can never pick one (HOLD A).
  v_id := gen_random_uuid();
  INSERT INTO canonical_items
    (id, collection_type_id, provider_ids, content_fingerprint,
     canonical_attributes, media, source, version)
  VALUES (v_id, p_collection_type_id,
     COALESCE(p_provider_ids, '{}'::jsonb), p_content_fingerprint,
     COALESCE(p_canonical_attributes, '{}'::jsonb),
     COALESCE(p_media, '{}'::jsonb), COALESCE(p_source, 'local'), 1)
  ON CONFLICT DO NOTHING;
  -- A concurrent service may have inserted the same canonical identity between
  -- our SELECT and INSERT; re-resolve to return the existing row.
  SELECT id INTO v_id FROM canonical_items
   WHERE collection_type_id = p_collection_type_id
     AND (
       (p_content_fingerprint IS NOT NULL AND content_fingerprint = p_content_fingerprint)
       OR
       (p_provider_ids IS NOT NULL AND provider_ids = p_provider_ids)
     )
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'canonical_upsert_service failed to resolve inserted row'
      USING ERRCODE = '23505';
  END IF;
  RETURN v_id;
END;
$$;

-- Least privilege: EXECUTE ONLY for the dedicated service role. No PUBLIC
-- default EXECUTE, and NO EXECUTE for app_rls (the shared tenant role).
REVOKE ALL ON FUNCTION canonical_upsert_service(text, jsonb, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION canonical_upsert_service(text, jsonb, text, jsonb, jsonb, text) FROM app_rls;
GRANT EXECUTE ON FUNCTION canonical_upsert_service(text, jsonb, text, jsonb, jsonb, text) TO canonical_service;