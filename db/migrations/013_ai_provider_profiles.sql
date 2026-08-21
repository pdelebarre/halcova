-- 013_ai_provider_profiles.sql — ADMIN-3.2 #304: secure LLM provider-profile
-- storage. Plain DDL — pg-mem safe — applied in order by scripts/db-migrate.mjs.
--
-- This is the owner-only runtime AI configuration. Each row is one provider
-- profile the admin can create/edit/test/activate without a deployment. The
-- apiKey is NEVER stored as plaintext — only `secret_ciphertext` (AES-256-GCM
-- under the server-side RUNOUT_AI_SECRET_KEY) is persisted, with `secret_set`
-- recording presence (see netlify/functions/_shared/ai/ai-secrets.js).
-- Encryption/decryption lives in the application layer, never here.
--
-- Invariants enforced at the DB layer:
--   * provider_type is constrained to the KNOWN adapters (openai today).
--   * base_url must be https (mirrors ai-endpoint.js; the app validates before
--     writing, the CHECK is defense in depth).
--   * At most ONE profile is active at a time (partial unique index), the
--     atomic-activation invariant the admin facade relies on.
--   * A profile cannot be its own fallback (self-reference guard).

CREATE TABLE ai_provider_profiles (
  id                     uuid PRIMARY KEY,          -- server-assigned, immutable
  name                   text NOT NULL,             -- display name (1-80)
  provider_type          text NOT NULL DEFAULT 'openai'
                         CHECK (provider_type IN ('openai')),
  base_url               text NOT NULL
                         CHECK (base_url LIKE 'https://%'),
  model                  text NOT NULL,
  capabilities           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- text array of capability ids
  active                 boolean NOT NULL DEFAULT false,
  fallback_provider_id   uuid REFERENCES ai_provider_profiles(id),
  secret_ciphertext      text,                      -- AES-256-GCM payload; never plaintext
  secret_set             boolean NOT NULL DEFAULT false,
  last_test_ok           boolean,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- At most one active profile (atomic-activation invariant). The partial unique
-- index on the boolean makes a second active row a DB-level conflict.
CREATE UNIQUE INDEX ai_provider_profiles_active_uidx
  ON ai_provider_profiles (active)
  WHERE active = true;

-- A profile must not be its own fallback (would be a degenerate self-loop).
ALTER TABLE ai_provider_profiles
  ADD CONSTRAINT ai_provider_profiles_no_self_fallback
  CHECK (fallback_provider_id IS NULL OR fallback_provider_id <> id);
