-- 012_canonical_items.sql — FEAT-6.3 #316: the shared CanonicalItem table
-- (ADR-0020 §4) and the CollectionItem→CanonicalItem FK. Plain DDL — pg-mem
-- safe — applied in order by scripts/db-migrate.mjs.
--
-- Scope boundary:
--   * This file creates the SHAPE of the global, read-mostly catalogue table
--     and the reference FK it carries. It writes NO data.
--   * The DATA backfill — legacy `items` → Collection + CanonicalItem +
--     CollectionItem — lives in the migration TOOL
--     (netlify/functions/_shared/collection-migration.js, run by
--     scripts/migrate-collections.mjs) so it is idempotent, rehearsable, and
--     gated by pre/post reconciliation + reverse-mapping rollback (ADR-0020
--     §11, ADR-0014). A live SQL backfill would be unrehearsable and would
--     force the legacy `items` envelope to be written from a single migration
--     statement rather than the reconciliation tooling.
--   * The legacy `items` table and its API contract stay fully supported until
--     reconciliation PASS + an approved retirement ADR (ADR-0020 §11). Nothing
--     here alters or deletes `items`.
--   * CanonicalItem write-control RLS (service identity only, SELECT-only app
--     role) is db/rls/013_canonical_item_rls.sql.
--
-- Dedup note (ADR-0020 §4): the canonical object is at most one per
-- `(collection_type_id, provider_id)` when a provider id is present, and at
-- most one per `(collection_type_id, content_fingerprint)` for a locally-created
-- item with no provider id. The partial unique indexes below enforce both at
-- the DB layer; the backfill tool performs the same dedup so it can reuse the
-- canonical reference. Merging duplicates is a service/vetted operation and
-- never rewrites a CollectionItem reference (references are by
-- CanonicalItem.id — ADR-0020 §7).

CREATE TABLE canonical_items (
  id                    uuid PRIMARY KEY,          -- server-assigned, immutable
  collection_type_id    text NOT NULL REFERENCES collection_types(id),  -- records | books
  provider_ids          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- keyed provider ids (validated; additive)
  content_fingerprint   text,                      -- stable hash for locally-created dedup (no provider id)
  canonical_attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- validated extensible public metadata (ADR-0020 §6)
  media                 jsonb NOT NULL DEFAULT '{}'::jsonb,   -- public cover/asset refs (public + cacheable)
  source                text NOT NULL DEFAULT 'local',        -- provenance marker
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Content-fingerprint dedup: at most one locally-created canonical per
-- (type, fingerprint). The predicate keeps locally-created items (no provider
-- id) unique without constraining provider-identified rows.
CREATE UNIQUE INDEX canonical_items_fingerprint_uidx
  ON canonical_items (collection_type_id, content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

-- Per-provider dedup (ADR-0020 §4): at most one CanonicalItem per
-- (collection_type_id, provider_id) when that provider id is present.
-- Records: discogsId, mbid. Books: googleBooksId, openLibraryId.
CREATE UNIQUE INDEX canonical_items_discogs_uidx
  ON canonical_items (collection_type_id, (provider_ids->>'discogsId'))
  WHERE (provider_ids->>'discogsId') IS NOT NULL;
CREATE UNIQUE INDEX canonical_items_mbid_uidx
  ON canonical_items (collection_type_id, (provider_ids->>'mbid'))
  WHERE (provider_ids->>'mbid') IS NOT NULL;
CREATE UNIQUE INDEX canonical_items_gbooks_uidx
  ON canonical_items (collection_type_id, (provider_ids->>'googleBooksId'))
  WHERE (provider_ids->>'googleBooksId') IS NOT NULL;
CREATE UNIQUE INDEX canonical_items_olid_uidx
  ON canonical_items (collection_type_id, (provider_ids->>'openLibraryId'))
  WHERE (provider_ids->>'openLibraryId') IS NOT NULL;

-- Wire the FK that 010 deliberately deferred (its header: "canonical_items is
-- #316's job; canonical_item_id is a nullable uuid and its FK is added by
-- #316"). A canonical reference is by canonical_items.id — a merge never
-- rewrites a CollectionItem reference (ADR-0020 §7). Nullable for draft /
-- partially-identified items (deferred enrichment, ADR-0017).
ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_canonical_fk
  FOREIGN KEY (canonical_item_id) REFERENCES canonical_items(id);