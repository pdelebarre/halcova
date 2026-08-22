-- 015_blocks.sql — Block/Mute model (FEAT-8.5, #330).
--
-- A member can block another member. Blocked users cannot view or interact
-- where policy forbids it. The block is server-side only — the blocked user
-- is never notified and sees no indication they are blocked (non-enumerating).
--
-- Design:
--   - Blocks are one-directional: user A blocks user B.
--   - The blocker controls the block; the blocked user cannot override it.
--   - `reason` is optional and private to the blocker (never exposed).
--   - Blocked users are filtered at the query/display layer server-side.
--   - Account deletion removes all associated blocks.

CREATE TABLE blocks (
  id          uuid PRIMARY KEY,
  blocker_id  text NOT NULL,          -- the user who applied the block
  blocked_id  text NOT NULL,          -- the user being blocked
  reason      text NOT NULL DEFAULT '', -- private reason (never exposed)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)     -- one block per pair
);

-- Lookup: is user A blocked by user B?
CREATE INDEX blocks_blocker_idx ON blocks (blocker_id);
-- Cleanup: find all blocks involving a user (for account deletion).
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);