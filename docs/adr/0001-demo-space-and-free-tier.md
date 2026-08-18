# ADR-0001: Free demo space and free tier for collections

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #354
- **Updated by:** ADR-0008, ADR-0009

## Context

Halcova needs a safe public demonstration experience and a useful free tier. The demo must be read-only; plan limits must be authoritative on the server.

## Decision

### Demo

Use a special read-only demo identity backed by a curated shared collection. The demo identity is not a normal member and cannot mutate data.

Server-side authorization rejects demo writes with a stable `DEMO_READONLY` error. Provider lookup access is rate-limited and bounded.

### Free tier

Use configuration-driven entitlements with a server-side item limit per collection. Existing items are preserved when a user reaches the limit; the limit blocks new owned items rather than deleting data.

Wishlist conversion must be counted as an owned-item addition when it changes the user's owned count.

## Authentication

Access codes are exchange credentials only. Successful login mints an opaque, expiring, revocable session token as defined by ADR-0009. The demo code is intentionally public because its identity is read-only.

## Security

- Never enforce plan limits only in the client.
- Never expose admin credentials or member access codes through public user objects.
- Demo collections must be protected server-side against mutation.
- Rate-limit public demo and lookup usage.
- Do not log credentials or private collection content.

## Consequences

Positive: safe product discovery and a simple upgrade path without corrupting collection data.

Negative: shared demo traffic consumes provider quota and plan enforcement requires authoritative counting/transactions as the persistence layer evolves.

## Related decisions

- ADR-0002 — scaling architecture
- ADR-0008 — monetization and self-serve access
- ADR-0009 — authentication and session evolution
