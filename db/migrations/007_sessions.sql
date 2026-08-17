-- 007_sessions.sql — SEC-EPIC-1 (SEC-1.1, #176): server-managed session tokens.
--
-- Replaces "the access code IS the session" with a server-held session token:
-- the access code (or admin key) is now only an EXCHANGE credential used at
-- login; every protected call carries an opaque, expiring, revocable session
-- token instead. The token itself is never stored — only its sha256 hash
-- (same rule as users.code_hash), so a leaked `sessions` table row exposes no
-- reusable credential.
--
-- Per-account properties (role, status) are captured ON the session record at
-- creation so authorization is stable for the life of the session and admin
-- role checks never need to re-derive identity from a bearer string (SEC-1.6,
-- #181). `status` toggles to 'revoked' on logout / disable / rotate; expired
-- sessions are simply not live. The legacy Blobs mirror (runout-sessions)
-- follows the same repository seam as users/items — Postgres is the
-- authority, Blobs the reversible read-through fallback.
--
-- Applied in order by scripts/db-migrate.mjs; runs on real Postgres AND on
-- pg-mem (the in-memory emulator used by the repo unit tests).

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,       -- sha256(session token); the raw token is never stored
  user_id    text NOT NULL,          -- 'owner' | 'demo' (constants) or a member id
  role       text NOT NULL DEFAULT 'member',  -- 'admin' | 'member' | 'demo'
  status     text NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,   -- hard-capped server-side (see _shared/sessions.js)
  revoked_at timestamptz             -- set when status flips to 'revoked'
);

-- Per-user listing for bulk revocation (logout-all / disable / delete).
CREATE INDEX sessions_user_idx ON sessions (user_id);
-- Opportunistic cleanup / expiry scans.
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
