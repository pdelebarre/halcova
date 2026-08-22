-- 016_recommendations.sql — Discovery Recommendations Cache & Opt-Out (FEAT-8.4, #329).
--
-- Every member can receive personalized collection recommendations based on
-- deterministic rules (collection-type overlap, popular public collections,
-- followed-collector activity). Recommendations are cached with a TTL and
-- can be disabled per user.
--
-- Security model:
--   - Only PUBLIC collections/items are used in recommendations.
--   - Private collections/items are NEVER included in recommendation computation.
--   - The recommendations_enabled column on profiles allows per-user opt-out.
--   - Recommendation results are cached and regenerated on TTL expiry.
--   - Rate limiting prevents expensive recomputation loops.

-- --- recommendations_cache: per-user cached recommendation results -----------
-- Each row stores the generated recommendations as a JSONB array. The TTL is
-- enforced by the application layer (default 1 hour); the generated_at
-- timestamp is used to check freshness.
CREATE TABLE recommendations_cache (
  user_id          text PRIMARY KEY,                    -- the member's user id
  recommendations  jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array of recommendation objects
  generated_at     timestamptz NOT NULL DEFAULT now()   -- when this cache was generated
);

-- --- Add recommendations_enabled to profiles (opt-out toggle) ----------------
-- Defaults to true (recommendations enabled). When false, the recommendations
-- endpoint returns an empty list and no computation is performed.
ALTER TABLE profiles
  ADD COLUMN recommendations_enabled boolean NOT NULL DEFAULT true;