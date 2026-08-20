-- 009_harden_tenancy.sql — ARCH-6.1 #165: tenancy & migration hardening (M3
-- prerequisite, parent epic #150). Plain DDL that runs on real Postgres AND on
-- pg-mem (the in-memory emulator used by the repo unit tests), applied in order
-- by scripts/db-migrate.mjs.
--
-- What this stage does (the #165 tasks that are pure schema):
--   * Version columns — every tenant-owned row that will participate in M3
--     sync / OCC (#160/#161) carries a monotonic `version` optimistic-
--     concurrency token (ADR-0020 §8). Added nullable-with-default so existing
--     rows read cleanly (v1) and no backfill is required.
--   * updated_at timestamps — the "change-since" watermark M3 sync needs
--     (ADR-0020 §8). Added nullable-with-default so existing rows read cleanly.
--   * Sync indexes — the change-since queries (`WHERE owner = ? AND updated_at >
--     ?`) are indexed so a sync cursor is an index range scan, not a seq scan
--     (acceptance: "synchronization queries are indexed and explain plans
--     reviewed").
--
-- Deliberately NOT here: RLS DDL (ENABLE/FORCE ROW LEVEL SECURITY, CREATE
-- POLICY) and the least-privilege binding role. pg-mem cannot parse them, so
-- they live in db/rls/*.sql applied by `npm run db:migrate:rls` (see
-- 010_rls_generic_collections.sql and 011_binding_rls.sql). This split is the
-- existing, enforced contract (008_rls.sql / rls-migration.test.js).

-- --- items: version + updated_at + change-since index ---
-- `version` is the OCC token for M3; `updated_at` is the sync watermark.
ALTER TABLE items ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE items ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Sync change-since read for one owner (an index range scan on the watermark).
CREATE INDEX items_owner_updated_idx ON items (owner_id, updated_at DESC);

-- --- reviews: version (has updated_at already from 005) ---
ALTER TABLE reviews ADD COLUMN version integer NOT NULL DEFAULT 1;
-- Change-since read for a member's own reviews.
CREATE INDEX reviews_author_updated_idx ON reviews (author_id, updated_at DESC);

-- --- feedback: version (has updated_at already from 006) ---
ALTER TABLE feedback ADD COLUMN version integer NOT NULL DEFAULT 1;
-- Change-since read for a member's own submissions.
CREATE INDEX feedback_author_updated_idx ON feedback (author_id, updated_at DESC);

-- --- lookup_queue: version (has updated_at already from 008) ---
ALTER TABLE lookup_queue ADD COLUMN version integer NOT NULL DEFAULT 1;

-- --- sessions: version (has no updated_at; created_at/expires_at exist) ---
ALTER TABLE sessions ADD COLUMN version integer NOT NULL DEFAULT 1;

-- --- users: version + updated_at (the identity/tenant registry table) ---
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 1;
