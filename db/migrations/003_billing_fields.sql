-- 003_billing_fields.sql — S3 (ADR-0003 §2.3/§2.5): payment-webhook billing
-- columns on `users`.
--
-- S2 deliberately shipped WITHOUT these columns — reads normalized them to null
-- via toUser / normalizeUser so old rows stayed clean. S3 adds them so the
-- payment webhook (billing.js) can persist plan expiry + the Stripe billing
-- ids, and the O(1) idempotency indexes (`stripe:session:<id>` /
-- `stripe:subscription:<id>` → userId) make replayed webhook events cheap
-- no-ops — the same ADR-0002 `code:` index pattern.
--
-- Every column is nullable + additive: old rows read cleanly (null) and no
-- backfill is required — the webhook fills them in as payments land. Plain DDL
-- only (pg-mem compatible, like 001/002) so the repo unit tests exercise it.

ALTER TABLE users ADD COLUMN plan_expires_at timestamptz;
ALTER TABLE users ADD COLUMN plan_changed_at timestamptz;
ALTER TABLE users ADD COLUMN stripe_customer_id text;
ALTER TABLE users ADD COLUMN stripe_subscription_id text;
ALTER TABLE users ADD COLUMN stripe_checkout_session_id text;

-- O(1) webhook idempotency lookups (ADR-0003 §2.5). UNIQUE: a checkout session /
-- subscription id can only ever belong to ONE user, so a duplicate materialization
-- (a racing webhook replay) fails the insert instead of silently creating a
-- second account. NULLs (users with no billing yet) never collide.
CREATE UNIQUE INDEX users_stripe_checkout_session_uidx ON users (stripe_checkout_session_id);
CREATE UNIQUE INDEX users_stripe_subscription_uidx ON users (stripe_subscription_id);
