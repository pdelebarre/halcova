-- 001_init.sql — Runout Phase 1 (ADR-0002, epic #38): move persistence from
-- Netlify Blobs (index + item:<id> pattern) to PostgreSQL behind the SAME
-- Netlify Functions and API contract. `src/api/*` and the client are untouched.
--
-- Applied in order by scripts/db-migrate.mjs, which tracks each file in
-- `schema_migrations` (so re-running is a no-op). Every statement here is
-- plain DDL/DML that runs on real Postgres AND on pg-mem (the in-memory
-- emulator used by the repo unit tests).
--
-- Design principle: `data jsonb` is the source of truth for the exact object
-- the client wrote (items) or the identity store held (users/requests), so
-- reads reconstruct the blob-shaped JSON byte-for-byte. The scalar/array
-- columns are MIRRORS derived from `data` on write — they exist for querying,
-- ordering and the SQL owned-count, and can never drift from the JSON.

-- --- Users & signup requests (mirrors the `runout-identity` blob store) ---

CREATE TABLE users (
  id         text PRIMARY KEY,          -- member ids are uuid strings; the owner is never stored
  name       text NOT NULL DEFAULT '',
  email      text NOT NULL DEFAULT '',
  -- Part A interim: the plaintext access code, kept so findUserByCode() and
  -- sessionPayload() keep working identically (the Blobs path stores plaintext
  -- codes today). Part B (auth hashing + admin rotation) drops this column and
  -- makes code_hash the authority.
  code       text,
  -- sha256(normalize(code)). Populated from Part A so the O(1) lookup is ready;
  -- Part B owns the hashing/rotation story.
  code_hash  text,
  role       text NOT NULL DEFAULT 'member',
  status     text NOT NULL DEFAULT 'active',
  plan       text NOT NULL DEFAULT 'free',
  features   jsonb NOT NULL DEFAULT '{}'::jsonb,
  collections jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { records, books } — required by the API contract
  created_at timestamptz NOT NULL DEFAULT now()
);

-- O(1) code lookup + duplicate protection (ADR-0002 § data model).
CREATE UNIQUE INDEX users_code_hash_uidx ON users (code_hash);
CREATE INDEX users_email_idx ON users (email);

CREATE TABLE requests (
  id          text PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  email       text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb   -- the exact request object (id/name/email/status/createdAt/approvedAt/rejectedAt)
);
CREATE INDEX requests_email_idx ON requests (email);

-- --- Items (replaces the per-user `index` + `item:<id>` blob stores) ---
--
-- `data` is the exact item object the client knows (id, title, year, label,
-- genre, coverImage, barcode, discogsId/googleBooksId, dateAdded, notes,
-- lending, lendingHistory, wishlist, and kind-specific extras like catno,
-- formatRaw, style, country, isbn, pageCount, description). The columns mirror
-- a queryable subset. Per-user isolation is `owner_id` (the blob layout's
-- `collection-<userId>-<kind>` maps to owner_id + kind).

CREATE TABLE items (
  id              uuid PRIMARY KEY,       -- server-assigned randomUUID(), same as today
  owner_id        text NOT NULL,          -- 'owner' (legacy stores) or a member id
  kind            text NOT NULL,          -- 'records' | 'books'
  title           text NOT NULL DEFAULT '',
  year            integer,                -- null when the client value isn't numeric
  label           text,
  genre           text[] NOT NULL DEFAULT '{}',
  style           text[] NOT NULL DEFAULT '{}',
  country         text,
  format_type     text,                   -- formatType (LP / CD / …)
  barcode         text,
  discogs_id      text,
  google_books_id text,
  cover_image     text,                   -- coverImage
  data            jsonb NOT NULL,         -- source of truth — the exact item object
  date_added      timestamptz NOT NULL DEFAULT now(),
  wishlist        boolean NOT NULL DEFAULT false,
  lending         jsonb,                  -- mirror of data.lending
  lending_history jsonb,                  -- mirror of data.lendingHistory
  page_count      integer,                -- mirror of data.pageCount (books)
  notes           text,                   -- mirror of data.notes
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Ordered list read (newest first — same as the blob index order).
CREATE INDEX items_owner_kind_date_idx ON items (owner_id, kind, date_added DESC);
-- Duplicate detection on discogsId (ADR-0002).
CREATE INDEX items_owner_discogs_idx ON items (owner_id, discogs_id);
-- Instant local barcode match (ADR-0002).
CREATE INDEX items_owner_barcode_idx ON items (owner_id, barcode);
-- Scoped count/listing per collection kind.
CREATE INDEX items_owner_kind_idx ON items (owner_id, kind);

-- --- Lookup response cache (replaces `discogs-cache` / `books-cache`) ---
--
-- Keyed by (provider, key) with a real `expires_at` TTL (Netlify Blobs had no
-- native expiry; the blob path stored { ts, data } and judged staleness by age).
-- Part A exposes the repository; discogs.js / books.js still use Blobs until
-- Part B flips them over.

CREATE TABLE lookup_cache (
  provider   text NOT NULL,               -- 'discogs' | 'books'
  key        text NOT NULL,               -- hashed/cleaned cache key
  data       jsonb NOT NULL,              -- the cached provider payload
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider, key)
);
CREATE INDEX lookup_cache_expires_idx ON lookup_cache (expires_at);
