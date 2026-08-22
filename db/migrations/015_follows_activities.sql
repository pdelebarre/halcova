-- 015_follows_activities.sql — Social: Follows & Collector Activity Feed (FEAT-8.2, #327).
--
-- Every member can follow other members (by user_id) or public collections (by
-- share_id). Activities are event-driven: logged when an item is added, a
-- collection is completed (100% complete), or a showcase/featured display is
-- updated.
--
-- Security model:
--   - follows.followed_type = 'user' | 'collection'
--   - UNIQUE constraint on (follower_id, followed_id, followed_type) enforces
--     idempotent follow/unfollow.
--   - Activities are filtered through the viewer's authorization (visibility
--     model in profiles) and block checks (isBlocked) before reaching the feed.
--   - No private item attributes (C3–C7) ever appear in activity payloads.
--   - Activity data is a JSONB payload limited to C1 public metadata + the type
--     identifier — no price/serial/location/notes/borrower contact.

CREATE TABLE follows (
  id                     uuid PRIMARY KEY,
  follower_id            text NOT NULL,             -- the member who follows
  followed_id            text NOT NULL,             -- the target user_id or share_id
  followed_type          text NOT NULL DEFAULT 'user', -- 'user' | 'collection'
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- A member can follow the same target only once (idempotent).
  UNIQUE (follower_id, followed_id, followed_type)
);

-- Lookup who a member follows.
CREATE INDEX follows_follower_idx ON follows (follower_id);
-- Lookup who follows a target.
CREATE INDEX follows_followed_idx ON follows (followed_id, followed_type);

-- Activity types for the feed.
--   add_item         — item added to collection (data: { kind, itemId, title, coverImage, artists/authorsList, year })
--   complete_collection — collection reached 100% completion (data: { kind })
--   showcase_update  — featured/pinned items updated (data: { kind, itemIds })
--   profile_update   — profile details changed (data: { fields: [...] })
CREATE TABLE activities (
  id                     uuid PRIMARY KEY,
  user_id                text NOT NULL,             -- the member who performed the action
  type                   text NOT NULL,             -- activity type identifier
  data                   jsonb NOT NULL DEFAULT '{}', -- type-specific payload (C1 public metadata only)
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Lookup by user (for profile activity lists).
CREATE INDEX activities_user_idx ON activities (user_id);
-- Time-ordered lookup for the feed (created_at DESC).
CREATE INDEX activities_created_idx ON activities (created_at DESC);