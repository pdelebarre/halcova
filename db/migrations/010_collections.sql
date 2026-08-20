-- 010_collections.sql — ARCH-6.1 #165: introduce the tenant-owned generic
-- collection tables (ADR-0020 §3/§5) that M3 sync, tombstones and the
-- CollectionItem RLS predicate build on. Plain DDL — pg-mem safe — applied in
-- order by scripts/db-migrate.mjs.
--
-- Scope boundary (do not over-build):
--   * collection_types (the registry) is #315's job; `collection_type_id`
--     here is the immutable slug (text) and its FK is added by #315 when the
--     registry table exists.
--   * canonical_items (the shared catalogue) is #316's job; `canonical_item_id`
--     is a nullable uuid and its FK is added by #316.
--   * This file creates the SHAPE + tenancy so the RLS policies in
--     db/rls/010_rls_generic_collections.sql (Collection-subquery predicate)
--     can be defined and tested NOW, as the #165 prerequisite requires.
--   * Backfill/reconciliation from the legacy `items` table is #316, not here.

-- --- collections: one per (owner, kind) — the tenant-scoped container ---
CREATE TABLE collections (
  id                 uuid PRIMARY KEY,           -- server-assigned, immutable
  owner_id           text NOT NULL,              -- TENANT scope (server-derived; never client-supplied)
  collection_type_id text NOT NULL,              -- immutable slug ('records' | 'books'); FK added by #315
  display_name       text NOT NULL DEFAULT '',
  theme              text NOT NULL DEFAULT '',
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1, -- M3 OCC token (ADR-0020 §8)
  UNIQUE (owner_id, collection_type_id)          -- at most one collection per (owner, kind)
);

-- Tenant-scoped listing by owner + kind (covered by the UNIQUE above).

-- --- collection_items: the owned/wanted copy — the ONLY row that holds
-- authoritative ownership + private instance state (ADR-0020 §5) ---
CREATE TABLE collection_items (
  id               uuid PRIMARY KEY,             -- server-assigned, immutable
  collection_id    uuid NOT NULL REFERENCES collections(id),  -- ownership flows via the Collection
  canonical_item_id uuid,                        -- nullable FK to canonical_items (added by #316)
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','tombstoned')),
  owned_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,  -- private extensible instance attrs (validated §6)
  flags            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- wishlist / lending / rating (owned, non-authoritative)
  version          integer NOT NULL DEFAULT 1,   -- M3 OCC token (ADR-0020 §8)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  tombstoned_at    timestamptz,                  -- stamped when status -> 'tombstoned' (soft delete)
  purge_at         timestamptz                   -- schedules hard delete after the retention window
);

-- The reads M3 sync / listing do: per-collection status-filtered listing and
-- the tombstone-excluding scan (ADR-0020 §7).
CREATE INDEX collection_items_collection_status_idx ON collection_items (collection_id, status);
-- Advisory duplicate-detection index (NOT a blocking constraint — a user may
-- own a second copy / "add anyway", ADR-0020 §5). Duplicate hint only.
CREATE INDEX collection_items_collection_canonical_idx ON collection_items (collection_id, canonical_item_id);
-- Change-since sync watermark for a whole collection (M3 sync cursor).
CREATE INDEX collection_items_updated_idx ON collection_items (collection_id, updated_at DESC);
