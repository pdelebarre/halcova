-- 005_reviews.sql — Reviews (feat/reviews, Task 3): first-class review objects
-- shared across ALL users (a release's reviews are public to every member and
-- the owner — unlike items/users there is no per-user or per-owner store).
--
-- Applied in order by scripts/db-migrate.mjs, which tracks each file in
-- `schema_migrations` (so re-running is a no-op). Plain DDL that runs on real
-- Postgres AND on pg-mem (the in-memory emulator used by the repo unit tests).
--
-- Design principle (deliberately DIFFERENT from 001's `data jsonb`): the
-- review object is FIRST-CLASS — every field is a real column and the source
-- of truth, with CHECK / UNIQUE constraints enforced by the database. The
-- shape is small, stable and queryable (rating, status, author), so a mirror
-- column would add drift with nothing to query for. No `data jsonb` here.
--
-- The UNIQUE (kind, source_id, author_id) constraint is what makes a member
-- editing their review an UPSERT (INSERT … ON CONFLICT DO UPDATE) instead of
-- a second row — one review per member per release. `status` lets the admin
-- hide/show a review or hold it as 'pending' before it is publicly visible.

CREATE TABLE reviews (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,                      -- 'records' | 'books'
  source_id   text NOT NULL,                      -- discogsId | googleBooksId (the release/volume)
  author_id   text NOT NULL,                      -- member id
  author_name text NOT NULL DEFAULT '',           -- denormalized public display name
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text NOT NULL DEFAULT '',           -- review text
  status      text NOT NULL DEFAULT 'published',  -- 'published' | 'pending' | 'hidden'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_id, author_id)             -- one review per member per release (upsert)
);

-- Newest-first listing per release (the read a collection detail page does).
CREATE INDEX reviews_source_idx ON reviews (kind, source_id, created_at DESC);
-- Member deletion cleanup + "everything by this author" admin lookups.
CREATE INDEX reviews_author_idx ON reviews (author_id);
