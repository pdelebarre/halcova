# ADR-0007: Collection-centric social architecture

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related epic:** #325

## Decision

Halcova's social layer will be centered on collectors, collections and collection activity rather than becoming a generic social network.

Initial capabilities are optional profiles, public collections, follows and an activity feed. Comments, groups and recommendations are later capabilities.

Privacy is enforced server-side at object and property level. Public DTOs explicitly allowlist public fields. Sensitive ownership information such as purchase price, precise location, serial numbers, receipts and private notes remains private by default.

Blocking, reporting, moderation and rate limiting are prerequisites for broad social rollout.

## Rationale

The collection is Halcova's strongest social object and provides a natural viral loop: create -> showcase -> share -> discover -> follow -> collect. A generic social feed would add complexity without strengthening the core product proposition.

## Consequences

The social graph is smaller and easier to secure. Growth features can be introduced progressively while the core collection experience remains valuable for users who never enable social functionality.
