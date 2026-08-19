-- 008_lookup_queue.sql — T6 full-row / deferred-enrichment queue (#285).
--
-- Lets items saved with PARTIAL metadata (a rate-limited lookup, a manual add
-- with sparse fields, an OCR save with no provider id) be COMPLETED later by a
-- background drain. Enqueue records the lookup parameters; the @hourly drain
-- (and opportunistic piggybacks) re-run the SSRF-safe provider lookup and
-- idempotently merge ONLY the missing fields into the item, never clobbering a
-- user's edits.
--
-- Security model (SEC-EPIC-2, #190 — same defense-in-depth as items/users):
--   * The APP is the primary tenant boundary: every repo method is scoped by
--     `user_id` (a drain for user A claims/enqueues/merges ONLY user A's
--     records). The @hourly drain also iterates one tenant at a time under a
--     service identity.
--   * The `user_id` column is the RLS tenant key; the matching RLS policies
--     live in db/rls/009_lookup_queue_rls.sql (applied to real Postgres by the
--     dedicated RLS runner, since pg-mem cannot parse RLS DDL).
--   * The queue is server/service-identity ONLY — it has NO client-facing
--     endpoint and its rows are never echoed to a client. `id` is a
--     server-assigned uuid; `payload` holds provider lookup parameters only,
--     never client data.
--
-- Queue lifecycle (drain, in `_shared/lookup-queue.js`):
--   enqueue  -> status 'pending', attempts 0, next_at now()
--   claim    -> pick due rows (next_at <= now()), status flips to... (kept
--               'pending' across a run; the scheduler is the single drainer,
--               so no row is picked twice in the same run)
--   success  -> idempotent field-merge into items + mark DONE (attempts reset)
--   failure  -> exponential next_at (attempts+1); ABANDON after 5 attempts or
--               7 days; permanent failures are never retried more than once.

CREATE TABLE lookup_queue (
  id          uuid PRIMARY KEY,           -- server-assigned; opaque, never client-reachable
  user_id     text NOT NULL,              -- TENANT scope ('owner' | member id)
  kind        text NOT NULL,              -- 'records' | 'books'
  status      text NOT NULL DEFAULT 'pending',   -- 'pending' | 'done' | 'abandoned'
  attempts    integer NOT NULL DEFAULT 0,
  next_at     timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb, -- { provider, action, key, barcode?|q? } — provider lookup params only
  item_id     uuid,                       -- the item to merge into (server-assigned)
  last_error  text,                       -- safe (internal-only) failure reason
  enriched_at timestamptz,                -- set when the drain merged into the item
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index the drain's claim query: per-tenant, due first, oldest first.
CREATE INDEX lookup_queue_tenant_due_idx ON lookup_queue (user_id, status, next_at);

-- T6 (#285): the item rows carry an `enriched_at` mirror of data.enrichedAt —
-- set by the drain when it fills missing metadata, cleared by the same merge
-- only on success. Mirrors data.dateAdded -> date_added (same convention).
ALTER TABLE items ADD COLUMN enriched_at timestamptz;
