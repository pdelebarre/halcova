# Halcova — Architecture Decision & Recommendations

- **Status:** Accepted roadmap baseline
- **Date:** 2026-08-18
- **Authoring disciplines:** Product / Architecture / UX / Security
- **ADR registry:** [`docs/adr/`](adr/)

## Executive decision

Halcova will evolve from a records/books application into a **generic, secure, collector-first collection platform**.

The evolution is incremental. There will be **no big-bang rewrite** and no separate core architecture per collection type.

The target domain is:

```text
CollectionType
     |
     +--> Collection
             |
             +--> CollectionItem ----> CanonicalItem
```

`CanonicalItem` represents reusable catalogue identity. `CollectionItem` represents a user's relationship to that item and contains ownership/private data.

## Target platform

```text
React PWA / future native clients
              |
          API boundary
              |
   Authentication + sessions
              |
 Authorization + validation
              |
       Collection domain
              |
   +----------+-----------+
   |                      |
PostgreSQL          Object/blob storage
(system of record)  images/documents
   |
Provider adapters ---- AI gateway ---- external providers
   |
Social / marketplace / valuation capabilities
```

The API boundary is intentionally independent of Netlify Functions so the application can later move compute without changing product contracts. ADR-0002 governs the phased Netlify → PostgreSQL → dedicated API evolution.

## Architectural principles

1. **Collection type is configuration/domain data, not a separate application.**
2. **Canonical metadata and personal ownership data are separate.**
3. **Authentication establishes identity; authorization establishes access.**
4. **The server is authoritative for ownership, entitlements and mutations.**
5. **External provider data, imports and LLM output are untrusted.**
6. **AI uses typed tools and the existing provider-neutral gateway; it never receives unrestricted data access.**
7. **Social is collection-centric, optional and privacy-first.**
8. **Offline is optimized for high-value collector workflows, with the server authoritative on synchronization.**
9. **Security, privacy, accessibility and observability are release gates.**
10. **Microservices are introduced only when operational requirements justify them.**

## Product/UX architecture

The primary interaction remains:

**Capture → Identify → Confirm → Add → Browse**

Use one dominant Add action, progressive disclosure, infer-first metadata, one-handed mobile controls, ≥44px touch targets, explicit offline/loading/error states and reusable item-detail patterns. Critical flows target WCAG 2.2 AA.

A known item should target **<10 seconds from capture to successful add** under realistic device/network conditions.

## Security baseline

Every protected operation follows:

```text
Authenticate → Authorize → Validate → Execute → Audit safely
```

Required controls include object/property-level authorization, server-derived ownership, rate limiting, schema validation, signed private asset access, secret/dependency/SAST scanning, PII-safe logging, security audit events, negative authorization tests, threat modeling and data export/deletion/retention controls.

No new P0 platform capability is production-ready with an unresolved HIGH security finding.

## Data and persistence

ADR-0002 remains authoritative for scaling. The preferred relational target is centered on:

```text
users
collection_types
collections
canonical_items
collection_items
collection_type_fields
wishlist_entries
sets
lookup_cache
social_* / entitlement_* as enabled
```

Use JSONB for genuinely extensible type-specific attributes, with explicit schema validation. Do not use ungoverned JSON as a replacement for core relational invariants.

Migration is additive, idempotent, reconcilable and reversible within a defined retirement window (ADR-0014).

## External providers

Provider adapters normalize external metadata and isolate provider-specific schemas, secrets, rate limits, retries, caching and failures. Shared caches contain only data safe to share across users. Arbitrary provider URLs are never trusted for server-side fetching (ADR-0013).

## AI

AI capabilities include metadata completion, duplicate detection, collection questions, recommendations and image identification. All access goes through the existing provider-neutral gateway so the administrator can change model/provider without application changes or redeployment.

AI is an assistant, not an authority:

```text
User → AI → typed tool → authorization → domain command/query
```

## Social

The social graph is built around collectors, public collections and collection activity. Public DTOs explicitly allowlist fields. Purchase prices, precise locations, serial numbers, receipts and private notes remain private by default. Blocking, reporting, moderation and rate limiting precede broad rollout.

## Monetization

Entitlements are provider-neutral. Payment providers update normalized application entitlements through signature-verified, idempotent server-side webhooks. Payment data never becomes part of the collection domain. The final merchant-of-record decision remains separate from the domain architecture (ADR-0008).

## Delivery sequence

### P0 — Foundation

- Security/privacy platform
- Generic collection domain
- Collection type registry
- Books/Records migration
- Collector-first UX
- Stable API/validation boundary

### P1 — Differentiation

- Wishlist/completion
- Import/bulk operations
- Additional collection types
- AI assistant/metadata intelligence
- Profiles/public collections
- Follows/feed

### P2 — Growth and monetization

- Communities/recommendations
- Valuation
- Marketplace discovery
- Buy/sell/trade
- Insurance/provenance services

Feature flags, release gates and rollback criteria apply to every phase.

## Related GitHub roadmap

- #313 Generic Collection Platform
- #319 Collector-First Mobile Experience
- #325 Collector Social & Discovery
- #331 Collection Intelligence & AI Assistant
- #337 Collection Platform Security & Privacy
- #343 Collector Marketplace & Value Services
- #348 Collection Type Expansion, Import & Growth
- #354 Collection Platform Product Transformation
- #355 Transformation Roadmap, Dependencies & Release Gates
- #356 Cross-Functional Architecture, UX, Security & Product Readiness Review

## ADR governance

ADR-0015 defines the ADR lifecycle. ADR numbers are unique; superseded decisions are explicitly marked rather than left as contradictory active decisions.
