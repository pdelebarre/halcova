-- 014_profiles.sql — Collector Profiles & Public Collections (FEAT-8.1, #326).
--
-- Every member gets exactly ONE profile row, created on first profile save.
-- Profile visibility is independently configurable per field group; collection
-- visibility is a separate toggle so a member can share their collection without
-- sharing their bio, or vice versa.
--
-- Design principle (first-class columns, same as 005_reviews / 006_feedback):
-- the profile object is small, stable and queryable — every field is a real
-- column with CHECK constraints enforced by the database. No `data jsonb` here.
--
-- Security model:
--   - `share_id` is an opaque UUID (not sequential) used in public URLs.
--   - `visibility` controls profile page visibility (private/owner/public).
--   - `collection_visibility` controls collection item visibility independently.
--   - Purchase price, precise location, serial numbers, receipts and private
--     notes are NEVER exposed on public pages — enforced by the function layer
--     via visibility.js / filter.js (C3–C7 classification).
--   - Account deletion/privacy changes invalidate public access promptly by
--     toggling visibility to 'private'.

CREATE TABLE profiles (
  id                     uuid PRIMARY KEY,          -- server-assigned, matches user id
  user_id                text NOT NULL UNIQUE,       -- the member's user id
  share_id               uuid NOT NULL UNIQUE,       -- opaque public identifier
  username               text NOT NULL DEFAULT '',   -- display name (max 80)
  avatar                 text NOT NULL DEFAULT '',   -- avatar URL or asset reference
  bio                    text NOT NULL DEFAULT '',   -- short bio (max 500)
  links                  jsonb NOT NULL DEFAULT '[]', -- array of { label, url }
  visibility             text NOT NULL DEFAULT 'private', -- private|owner|public
  collection_visibility  text NOT NULL DEFAULT 'private', -- private|owner|public
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- visibility must be a known value (fail closed: unknown -> private)
  CONSTRAINT profiles_visibility_check
    CHECK (visibility IN ('private', 'owner', 'public')),
  CONSTRAINT profiles_collection_visibility_check
    CHECK (collection_visibility IN ('private', 'owner', 'public'))
);

-- Lookup by share_id (the public URL path).
CREATE INDEX profiles_share_id_idx ON profiles (share_id);
-- Lookup by user_id (the internal reference).
CREATE INDEX profiles_user_id_idx ON profiles (user_id);