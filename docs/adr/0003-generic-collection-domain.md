# ADR-0003: Generic collection domain

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related epic:** #313

## Context

Halcova currently supports records and books. Future product expansion requires Games, instruments, cards, coins and other collection types without creating separate domain architectures.

## Decision

Adopt a generic domain based on `CollectionType`, `Collection`, `CanonicalItem` and `CollectionItem`.

`CanonicalItem` represents catalogue identity and reusable metadata. `CollectionItem` represents a user's owned/wanted copy and private attributes. Collection types are registered through schemas, capabilities and provider mappings.

Books and Records will be migrated incrementally into this model. Existing API contracts remain supported during migration.

## Alternatives rejected

- Separate domain/table hierarchy per collection type: rejected because it multiplies code, APIs and UX.
- One completely untyped JSON document: rejected because identifiers, ownership and core queries require strong invariants.
- Big-bang rewrite: rejected because it creates unnecessary migration and regression risk.

## Consequences

Positive: extensibility, reuse, canonical metadata deduplication, and a clean foundation for wishlist/social/AI/marketplace features.

Negative: migration complexity and the need for controlled schemas for type-specific fields.

## Guardrails

New collection types must not introduce new core domain entities. Type-specific attributes must be schema validated and must not contain authoritative ownership information that belongs in `CollectionItem`.
