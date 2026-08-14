-- 002_hash_codes.sql — Part B (ADR-0002, epic #38): access-code hashing.
--
-- Part A kept an INTERIM plaintext `code` column so findUserByCode() and
-- sessionPayload() behaved identically while the code_hash index was added.
-- Part B makes `code_hash` the sole authority:
--
--   1. The plaintext `code` column is dropped. Postgres is the secure system
--      of record — plaintext codes live ONLY in the legacy Blobs mirror during
--      read-through (documented in db/README.md) and are never returned to the
--      client.
--   2. `code_hash` becomes NOT NULL. The unique index from 001
--      (users_code_hash_uidx) is unchanged and is what makes the O(1) member
--      lookup + duplicate protection work.
--
-- No SQL-side crypto here (kept pg-mem / plain-DDL compatible): every row
-- written through the repository carries a JS-computed sha256 hash, and the
-- backfill script (scripts/backfill.mjs) recomputes hashes for any legacy
-- Blobs-only user during the staged cutover. Since this migration runs at
-- provision time (before backfill) the users table is empty here, so SET NOT
-- NULL is always safe.

ALTER TABLE users DROP COLUMN code;

-- The unique code_hash index from 001 already enforces uniqueness; NOT NULL
-- guarantees every user resolves via the hash.
ALTER TABLE users ALTER COLUMN code_hash SET NOT NULL;
