# ADR-0014: Data migration and backward compatibility

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #313, #354

## Context

Halcova must evolve from Netlify Blobs and a flat records/books item model toward a generic collection domain and eventually PostgreSQL. Existing user data, APIs and PWA behavior are valuable and must not be put at risk.

## Decision

Use additive, phased migration with parity checks and rollback windows.

```text
Legacy reads
     |
New model backfill
     |
Dual/read-through compatibility
     |
New-model writes
     |
Parity verification
     |
Legacy retirement
```

Migrations are idempotent. Every migrated record retains a stable mapping to its legacy identity until retirement is approved.

No migration may silently change ownership, delete data or alter user-visible semantics.

## Compatibility

Existing API routes and error semantics remain supported during migration. The generic domain is introduced behind the existing API boundary first.

Legacy data remains readable until reconciliation proves that the new representation is complete. Retirement requires a documented backup/retention period and rollback procedure.

## Verification

For each migration:

- count source and target entities;
- compare stable identifiers;
- compare ownership;
- compare collection membership;
- compare important user-visible fields;
- sample media references;
- verify duplicate-detection behavior;
- run authorization tests against migrated data.

## Consequences

Positive: migration risk is controlled and rollback remains possible.

Negative: temporary dual representations and compatibility code increase complexity and require explicit retirement work.
