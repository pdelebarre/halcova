# ADR-0002: Scaling architecture — phased evolution, hosting stays on Netlify

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #354, #355
- **Supersedes:** none; this remains the governing scaling decision
- **Related:** ADR-0010 API contract, ADR-0014 migration

## Context

Halcova is a React/Vite PWA on Netlify with Netlify Functions and Netlify Blobs. The application has already added server-managed sessions, rate limiting and magic-link authentication. The remaining scale constraints are primarily the Blob persistence model and serverless hot paths.

Known constraints include full identity/index scans in legacy paths, collection reads that can fetch many item blobs, non-transactional Blob index updates and shared provider-cache limits.

## Decision

Keep the frontend/PWA on Netlify. Evolve backend persistence and compute in reversible phases.

### Phase 0 — harden hot paths

- eliminate O(n) authentication/index lookups;
- paginate collection reads;
- maintain denormalized counts where useful;
- cache safe reads with explicit invalidation;
- rate-limit public/auth/provider endpoints;
- preserve the existing PWA and API contract.

### Phase 1 — managed PostgreSQL

Move authoritative application data to PostgreSQL while keeping the API boundary and client contract stable.

Target core model:

```text
users
collections
collection_types
canonical_items
collection_items
collection_type_fields
requests
lookup_cache
entitlements
```

Use relational constraints/indexes for ownership, uniqueness and authorization-sensitive invariants. JSONB is reserved for validated extensible attributes.

### Phase 2 — dedicated API compute when justified

Introduce a dedicated API service only when traffic, latency, workload isolation or operational requirements justify its cost. The service keeps the stable API contract defined by ADR-0010.

Redis, queues, replicas and additional workers are introduced only for demonstrated workloads rather than as a default microservice architecture.

## Migration

Use read-through/backfill, reconciliation and rollback windows as defined by ADR-0014. Existing owner and member data must never be renamed or deleted as an optimization.

## Authentication clarification

Access codes are exchange credentials only. The current client uses an opaque server-managed session token as the Bearer credential after login. ADR-0009 is authoritative for identity/session architecture.

## Alternatives rejected

- Big-bang rewrite to Spring Boot now — rejected because migration and regression risk are disproportionate.
- Stay on Netlify Blobs indefinitely — rejected because the index/blob model becomes increasingly expensive and difficult to make transactional.
- Leave Netlify entirely — rejected because the static PWA/CDN remains a good fit.
- Microservices now — rejected because domain concepts do not by themselves justify distributed operational complexity.

## Consequences

Positive: controlled scaling, preserved frontend investment and explicit rollback points.

Negative: temporary dual persistence and later database/API operations add complexity; migration must be actively retired rather than left permanently in compatibility mode.

## Non-negotiable preservation

- user isolation and ownership;
- API routes and stable error semantics during migration;
- PWA/offline behavior;
- provider secrets remaining server-side;
- session revocation and authorization semantics;
- existing user data.
