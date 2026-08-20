-- 011_collection_types.sql — FEAT-6.2 #315: the Collection Type Registry &
-- Capabilities (ADR-0020 §2, §6; ADR-0002 Phase 1 `collection_types` +
-- `collection_type_fields`). Plain DDL + idempotent seed — pg-mem safe —
-- applied in order by scripts/db-migrate.mjs.
--
-- Scope boundary (do not over-build):
--   * This file defines the REGISTRY: the immutable type slug, display
--     metadata (label/icon), the validated extensible-attribute field schema,
--     the capability set and the ordered provider mappings for a collection
--     kind. Records and Books are BOTH registered here through the SAME
--     mechanism — a new kind (Games, coins, cards, …) is a configuration
--     change (new rows), never a new table or a new domain entity (ADR-0003).
--   * The registry is SERVER-AUTHORITATIVE. The app role (app_rls) is granted
--     SELECT-only on these tables (db/rls/012_collection_types_rls.sql), so a
--     client can never supply or override a type/capability/field definition
--     (ADR-0020 §2 dec 6). Seed rows are written here by the migration owner.
--   * `collections.collection_type_id` (created in 010 without its FK) gets
--     its FK to collection_types here, now that the registry table exists
--     (010's header defers the FK to #315). There are no collection rows yet
--     (backfill is #316), so adding the FK is safe and non-breaking.
--   * canonical_items backfill (#316) and provider adapter population (#317)
--     are NOT here. The `provider_mappings` column below is the CONTRACT that
--     #317 populates/enriches (ordered primary → fallback, ADR-0017); this
--     file only seeds the authoritative registry entry for each kind.
--   * Collection/CanonicalItem/CollectionItem write validation against these
--     field schemas is the job of the servers that write those rows (#316).

-- --- collection_types: one registry row per collection kind -----------------
-- id is the stable, immutable, API-facing collectionType slug. Removing or
-- renumbering an existing id is prohibited; a type is soft-deprecated only
-- (ADR-0020 §2).
CREATE TABLE collection_types (
  id                 text PRIMARY KEY,          -- stable slug ('records' | 'books')
  schema_version     integer NOT NULL DEFAULT 1, -- registry schema version this row conforms to (ADR-0020 §2)
  display_name       text NOT NULL,              -- human label (XSS-safe plain text; validated in the registry layer)
  icon               text NOT NULL DEFAULT '',   -- UI icon token (never raw SVG/HTML)
  description        text NOT NULL DEFAULT '',
  capabilities       jsonb NOT NULL DEFAULT '[]'::jsonb,      -- read-only capability flags (ADR-0020 §2)
  provider_mappings  jsonb NOT NULL DEFAULT '[]'::jsonb,      -- ordered provider list, primary → fallback (ADR-0017)
  is_public          boolean NOT NULL DEFAULT true,           -- classification default (ADR-0020 §9)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Registry slugs surface as the API `collectionType` and in the URL, so they
  -- must be a constrained, safe token. The full token charset
  -- (`^[a-z][a-z0-9_-]*$`) is enforced in the app registry layer (see
  -- collection-type-registry.js buildTypeDefinition); the DB CHECK below stays
  -- pg-mem-parseable (pg-mem cannot parse the regex `~` operator) and pins the
  -- lowest-risk invariants (lowercase, non-empty).
  CONSTRAINT collection_types_id_token CHECK (id = lower(id) AND id <> ''),
  CONSTRAINT collection_types_schema_version_positive CHECK (schema_version >= 1)
);

-- --- collection_type_fields: the validated extensible-attribute field schema
-- (ADR-0020 §6). Each row describes ONE field of the kind's schema. `bucket`
-- selects which attribute namespace the field belongs to:
--   'canonical' -> public catalogue metadata (CanonicalItem.canonical_attributes)
--   'owned'     -> private instance state (CollectionItem.owned_attributes)
-- The typed core columns (id, owner_id, status, version, provider_ids,
-- content_fingerprint, timestamps) are NOT here — they are strongly typed
-- columns, never extensible attributes (ADR-0020 §6).
CREATE TABLE collection_type_fields (
  id                 serial PRIMARY KEY,
  collection_type_id text NOT NULL REFERENCES collection_types(id) ON DELETE CASCADE,
  field_key          text NOT NULL,             -- attribute key (validated, allowlisted)
  bucket             text NOT NULL CHECK (bucket IN ('canonical','owned')),
  field_type         text NOT NULL CHECK (field_type IN (
                       'string','integer','boolean','array_string',
                       'string_or_array','date')),
  required           boolean NOT NULL DEFAULT false,
  label              text NOT NULL DEFAULT '',
  max_length         integer,                   -- string/string_or_array cap
  array_max          integer,                   -- array_string cap
  item_max           integer,                   -- array_string item cap
  allowed_values     jsonb,                     -- optional enum of allowed values (validated server-side)
  UNIQUE (collection_type_id, bucket, field_key)
);

-- FK for the collection container created in 010 (deferred to #315).
ALTER TABLE collections
  ADD CONSTRAINT collections_type_fk
  FOREIGN KEY (collection_type_id) REFERENCES collection_types(id);

-- --- idempotent seed: register 'records' and 'books' through the SAME
-- mechanism ----------------------------------------------------------------
-- ON CONFLICT DO NOTHING makes re-running a no-op (ADR-0014 additive,
-- idempotent). The field rows depend on the type rows (FK), so they are
-- inserted after.

INSERT INTO collection_types
  (id, display_name, icon, description, capabilities, provider_mappings, is_public)
VALUES
  (
    'records',
    'Records',
    'disc',
    'Vinyl, CDs and other sound recordings.',
    -- Capability flags gate UX/actions WITHOUT duplicating domain logic: a
    -- UI/action reads these from the server registry and never invents them.
    '["lookup.discogs","lookup.musicbrainz","barcode","ocr_cover","lending","wishlist","valuation","dedupe"]'::jsonb,
    -- Ordered provider list, primary → fallback (ADR-0017). #317 populates/
    -- enriches these; this is the authoritative registry contract.
    '[{"provider":"discogs","role":"primary"},{"provider":"musicbrainz","role":"fallback"}]'::jsonb,
    true
  ),
  (
    'books',
    'Books',
    'book',
    'Books and other print publications.',
    '["lookup.googleBooks","lookup.openlibrary","barcode","isbn","lending","wishlist","dedupe"]'::jsonb,
    '[{"provider":"googleBooks","role":"primary"},{"provider":"openlibrary","role":"fallback"}]'::jsonb,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- Records field schema (canonical = public catalogue attrs; owned = private
-- instance attrs). Kept aligned with the existing item shape/allowlist.
INSERT INTO collection_type_fields
  (collection_type_id, bucket, field_key, field_type, required, label, max_length, array_max, item_max, allowed_values)
VALUES
  -- canonical
  ('records','canonical','title',        'string',         true,  'Title', 500,  NULL, NULL, NULL),
  ('records','canonical','year',         'integer',        false, 'Year',  NULL,  NULL, NULL, NULL),
  ('records','canonical','genre',        'array_string',   false, 'Genre', NULL,  20,   100,  NULL),
  ('records','canonical','style',        'array_string',   false, 'Style', NULL,  20,   100,  NULL),
  ('records','canonical','country',      'string',         false, 'Country', 120, NULL, NULL, NULL),
  ('records','canonical','label',        'string',         false, 'Label', 300,  NULL, NULL, NULL),
  ('records','canonical','formatType',   'string',         false, 'Format', 120, NULL, NULL, NULL),
  ('records','canonical','catno',        'string',         false, 'Catalog number', 120, NULL, NULL, NULL),
  ('records','canonical','released',     'date',           false, 'Released', NULL, NULL, NULL, NULL),
  ('records','canonical','discogsId',    'string',         false, 'Discogs ID', 120, NULL, NULL, NULL),
  ('records','canonical','mbid',         'string',         false, 'MusicBrainz ID', 120, NULL, NULL, NULL),
  ('records','canonical','coverImage',   'string',         false, 'Cover', 2000, NULL, NULL, NULL),
  -- owned
  ('records','owned','notes',            'string',         false, 'Notes', 4000, NULL, NULL, NULL),
  ('records','owned','condition',        'string',         false, 'Condition', 24, NULL, NULL,
     '["mint","nm","vg+","vg","g","f","p"]'::jsonb),
  ('records','owned','grading',          'string',         false, 'Grading', 24,  NULL, NULL, NULL),
  ('records','owned','acquiredFrom',     'string',         false, 'Acquired from', 300, NULL, NULL, NULL)
ON CONFLICT (collection_type_id, bucket, field_key) DO NOTHING;

-- Books field schema.
INSERT INTO collection_type_fields
  (collection_type_id, bucket, field_key, field_type, required, label, max_length, array_max, item_max, allowed_values)
VALUES
  -- canonical
  ('books','canonical','title',          'string',         true,  'Title', 500,  NULL, NULL, NULL),
  ('books','canonical','subtitle',       'string',         false, 'Subtitle', 500, NULL, NULL, NULL),
  ('books','canonical','series',         'string',         false, 'Series', 300,  NULL, NULL, NULL),
  ('books','canonical','mainCategory',   'string',         false, 'Category', 120, NULL, NULL, NULL),
  ('books','canonical','publisher',      'string',         false, 'Publisher', 300, NULL, NULL, NULL),
  ('books','canonical','isbn',           'string',         false, 'ISBN', 24,   NULL, NULL, NULL),
  ('books','canonical','pageCount',      'integer',        false, 'Pages', NULL, NULL, NULL, NULL),
  ('books','canonical','googleBooksId',  'string',         false, 'Google Books ID', 120, NULL, NULL, NULL),
  ('books','canonical','openLibraryId',  'string',         false, 'Open Library ID', 120, NULL, NULL, NULL),
  ('books','canonical','coverImage',     'string',         false, 'Cover', 2000, NULL, NULL, NULL),
  -- owned
  ('books','owned','notes',              'string',         false, 'Notes', 4000, NULL, NULL, NULL),
  ('books','owned','condition',          'string',         false, 'Condition', 24, NULL, NULL,
     '["mint","nm","vg+","vg","g","f","p"]'::jsonb),
  ('books','owned','acquiredFrom',       'string',         false, 'Acquired from', 300, NULL, NULL, NULL)
ON CONFLICT (collection_type_id, bucket, field_key) DO NOTHING;
