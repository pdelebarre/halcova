# Halcova — Architecture Decision & Recommendations

- **Status:** Accepted for implementation
- **Date:** 2026-08-18
- **Related ADRs:** ADR-0002 through ADR-0006

## Executive decision

Halcova will evolve from a records/books application into a **generic, secure, collector-first collection platform**.

The evolution is incremental. There will be no big-bang rewrite and no separate core architecture per collection type.

Target domain:

```text
CollectionType
    |
    +--> Collection
            |
            +--> CollectionItem ----> CanonicalItem
```

`CanonicalItem` contains reusable catalogue identity/metadata. `CollectionItem` contains the user's ownership relationship and private attributes. This separation is foundational for social, AI, wishlist and marketplace capabilities.

## Target architecture

```text
React PWA / future native clients
          |
       API / BFF
          |
Application + Policy Layer
(authn, authz, validation, commands)
          |
Collection Domain Platform
(CollectionType, Collection, CanonicalItem,
 CollectionItem, Wishlist, Sets, Ownership)
          |
     +----+----------------+
     |                     |
 PostgreSQL          Object storage
(system of record)   images/documents
     |
Provider adapters
(Discogs, Books, MusicBrainz, etc.)
     |
AI Gateway / external providers
```

## Architecture recommendations

### 1. Generic collection model

Introduce a collection-type registry with field schemas, capabilities, identifier rules and provider mappings. Records and Books are the first types. Future candidates are Games, Vinyl/Albums, Guitars/Instruments, Trading Cards and Coins.

Adding a type should require configuration/provider/UX work, **not a new core domain model**.

### 2. Persistence and scalability

ADR-0002 remains the governing scaling decision: fix hot paths first, move persistence from Netlify Blobs to PostgreSQL at the appropriate scale, and introduce a dedicated API service only when operational requirements justify it. Do not introduce microservices prematurely.

Recommended PostgreSQL entities include `users`, `collection_types`, `collections`, `canonical_items`, `collection_items`, `collection_type_fields`, `wishlist_entries`, `sets` and `lookup_cache`. JSONB is allowed for genuinely type-specific attributes with explicit schema validation; it must not become an ungoverned replacement for relational modelling.

### 3. API/application layer

Preserve the existing API during migration and adapt it internally to the new domain. New resources should converge on collections, items, collection types, wishlist, sets, profiles, social and AI capabilities.

Every mutation follows:

```text
Authenticate -> Authorize -> Validate -> Execute -> Persist -> Audit
```

Ownership is always derived from authenticated context. The client is never authoritative for owner IDs or permissions.

### 4. Metadata providers

Use provider adapters and normalized internal representations. Provider-specific JSON must not leak into domain entities. Provider failures must be isolated, bounded, cached where appropriate and observable.

### 5. AI

AI is an application capability, not a privileged subsystem. All AI operations go through the existing provider-neutral AI gateway.

Rules: model output is untrusted; tool arguments are schema validated; every tool re-authorizes; minimum necessary data is sent; credentials remain server-side; prompt injection cannot grant permissions; mutations require application authorization/user confirmation where appropriate; calls are rate/cost limited; provider switching remains centralized.

### 6. Social

Social is collection-centric, not a generic social network. Profiles, public collections, follows and activity are introduced first. Comments, groups and recommendations follow only after moderation and privacy controls exist.

Public DTOs must explicitly allowlist fields. Purchase prices, precise locations, serial numbers, receipts and private notes are private by default.

### 7. UX

The core interaction is **Capture -> Identify -> Confirm -> Add -> Browse**.

Use one dominant Add action, progressive disclosure, infer-first workflows, one-handed mobile interaction, 44px+ touch targets, explicit loading/offline/error states, global search, grid/list/grouped views and a clear separation between shared metadata and My Copy data. Target WCAG 2.2 AA for critical flows.

The primary product performance target is under 10 seconds from capture to successful add for a known item under realistic conditions.

### 8. Security

Security is a release gate. Required controls include object/property-level authorization, server-side privacy policies, rate limiting, secure signed asset access, schema validation, secret/dependency/SAST scanning, PII-safe logging, audit events, threat modelling, negative authorization tests, and export/deletion/retention controls.

No new platform capability should ship with an unresolved HIGH security finding.

### 9. Migration

Migrate incrementally: introduce the generic domain, backfill canonical and ownership entities, reconcile, use read-through compatibility where required, switch writes, verify parity, then retire legacy storage only after a defined rollback/retention window.

### 10. Delivery sequence

**P0:** security/privacy foundation, generic domain, type registry, Books/Records migration, collector-first UX.

**P1:** wishlist/completion, import/bulk operations, additional types, AI intelligence, profiles/public collections, follows/feed.

**P2:** communities, recommendations, valuation, marketplace discovery, buy/sell/trade, insurance/provenance.

Use feature flags and explicit rollback criteria for social, AI and commerce.

## Architectural guardrails

1. No big-bang rewrite.
2. No collection-type-specific core architecture.
3. No client-authoritative ownership or authorization.
4. No unrestricted LLM access to data/tools.
5. No public serialization of private ownership data.
6. No marketplace before privacy and abuse controls are mature.
7. No microservices without demonstrated operational need.
8. No provider-specific models leaking into the domain.
9. No UX complexity that is not justified by measured user value.
10. No P0 production release with unresolved HIGH security findings.

## Roadmap issues

#313 Generic Collection Platform · #319 Collector UX · #331 AI · #325 Social · #337 Security · #348 Type Expansion · #343 Marketplace · #354 Transformation · #355 Roadmap/Gates · #356 Cross-functional readiness.
