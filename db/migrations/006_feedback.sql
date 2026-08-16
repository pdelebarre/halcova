-- 006_feedback.sql — Feedback (feat/feedback, T1): first-class feedback objects
-- (suggestions + bug reports) submitted by members and triaged by the owner.
-- Every row is private to its author + the owner — read only through the admin
-- inbox, unlike items/users there is no per-user or per-owner store.
--
-- Applied in order by scripts/db-migrate.mjs, which tracks each file in
-- `schema_migrations` (so re-running is a no-op). Plain DDL that runs on real
-- Postgres AND on pg-mem (the in-memory emulator used by the repo unit tests).
--
-- Design principle (deliberately DIFFERENT from 001's `data jsonb`): the
-- feedback object is FIRST-CLASS — every field is a real column and the source
-- of truth, with CHECK constraints enforced by the database (the `type`
-- allow-list and the `message` length 1–4000). The shape is small, stable and
-- queryable (type, category, message, status), so a mirror column would add
-- drift with nothing to query for. No `data jsonb` here.
--
-- `status` drives the owner's inbox triage: open → in_progress → done, or
-- closed out as wontfix / duplicate. `admin_note` is the owner-only internal
-- note. `author_id`/`author_name` are denormalized so an inbox row shows who
-- wrote it even after the member account changes.

CREATE TABLE feedback (
  id          uuid PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('suggestion','bug')),
  category    text NOT NULL DEFAULT 'other',   -- records|books|scanner|auth|billing|games|lending|other
  message     text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  author_id   text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  url         text NOT NULL DEFAULT '',        -- route where the report was made
  app_version text NOT NULL DEFAULT '',
  user_agent  text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open',    -- open|in_progress|done|wontfix|duplicate
  admin_note  text NOT NULL DEFAULT '',        -- owner-only
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Inbox sort (newest-first) — the read the admin triage view does.
CREATE INDEX feedback_status_idx ON feedback (status, created_at DESC);
-- Member deletion cleanup + "everything by this author" admin lookups.
CREATE INDEX feedback_author_idx  ON feedback (author_id);
