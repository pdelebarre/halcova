# ADR-0019: Platform foundation and offline-first architecture

- **Status:** Proposed — pending specialist review
- **Date:** 2026-08-19
- **Related roadmap:** #150, #152, #157, #162, #289, #292, #159, #160, #161
- **Note:** This ADR was renumbered from `0015` to `0019` to resolve an ADR numbering collision with the Accepted `0015-architecture-decision-governance.md` (unique-number rule). The substantive decisions below are unchanged from the prior proposal; only governance/numbering, the M2/M3 sync boundary, the service-worker cache boundary and the observability carve-out were clarified.

## Context

Halcova must evolve from the current Netlify/React application into a maintainable offline-first collection platform without a big-bang rewrite. Offline operation is a product requirement, but sensitive operations must remain online-only unless explicitly approved.

The existing application uses React/Vite, Netlify Functions and Netlify Blobs. M1 must establish the architecture needed by the M2 collector journey without prematurely introducing distributed infrastructure.

## Decisions

### 1. Application topology

Retain a **modular monolith** for the backend and the existing React/Vite frontend. Netlify Functions remain the deployment boundary while the application contracts are progressively modularized.

Do not introduce microservices, Kubernetes, queues or distributed workers unless measured requirements justify them through a later ADR.

### 2. Local persistence

Use **IndexedDB** for durable client-side application data required by approved offline capabilities. Keep browser `localStorage` for the minimal session/bootstrap state only; never use it as the collection database.

Use a versioned local schema with explicit migrations. Local repositories must be accessed through application/infrastructure abstractions rather than directly from feature components.

### 3. Offline capability boundary

Offline capabilities are explicit per feature. The M1 shell may start and render offline. M2 will define and implement the collection mirror and mutation outbox.

Sensitive operations remain online-only by default, including registration, password/access-code management, payments, security administration, uncached external lookup and operations requiring current authorization.

### 4. Trusted-device/session model

Offline access requires a previously authenticated and explicitly trusted device/session. The trust record must have a defined expiry/revocation mechanism and must never itself contain reusable credentials.

The implementation must define and enforce:

- trust establishment only after successful online authentication;
- trust expiry and revalidation;
- server-side revocation/disable handling when connectivity returns;
- local invalidation on sign-out and account switch;
- local invalidation when the trusted session is determined to be expired or revoked;
- fail-closed behaviour for capabilities requiring current authorization.

Offline authorization is capability-scoped and time-bounded. A cached trusted state is not evidence that an account remains authorized indefinitely.

No raw passwords, access codes, bearer/session tokens or equivalent credentials may be stored in IndexedDB.

### 5. Local data and service-worker boundary

Private collection data must be stored only in the approved IndexedDB application store and must be scoped by authenticated user/tenant/device context. Generic service-worker HTTP caching must not cache authenticated/private collection responses.

Service-worker precache is limited to the public application shell and other explicitly approved non-sensitive assets. Private data must never be made available to another browser user through a shared cache.

The `lookup-api` service-worker route uses a **NetworkFirst** strategy **strictly for PUBLIC catalog metadata**: provider search/list results (e.g. Discogs/Google Books/OpenLibrary/MusicBrainz lookups) and public cover images. Per-user, per-tenant and account-scoped fields/responses — collection items, visibility-classified/private fields, trust/session state, audit identifiers — must never enter the service-worker HTTP cache. Invariant: **only public catalog metadata may enter the SW cache; a cached response containing per-user/private fields is a cache-boundary violation and must be treated as a defect (fail-closed).**

Sign-out and account switching must clear or cryptographically invalidate local private data according to the offline security policy.

### 6. Local schema and repository boundary

IndexedDB uses an explicit versioned schema. Schema upgrades are deterministic and migration failures fail closed rather than silently interpreting incompatible data.

Feature code must use repository/application abstractions; direct IndexedDB access from UI components is prohibited.

Every private record must carry or be derivable from a non-user-controlled ownership scope. Client-supplied tenant/owner identifiers are never authoritative.

### 7. Synchronization

Synchronization will use explicit operation identities, durable outbox records, server-side authorization, idempotent processing, cursors and optimistic concurrency. Synchronization is not implemented by blindly replaying HTTP requests.

Every offline mutation must have a deterministic operation ID. Server-side processing must reject cross-user/tenant replay and duplicate operations must be safe.

**M2/M3 sync boundary (explicit).** M2 (#289/#292/#159) delivers:

- the offline collection mirror (#289);
- outbox creation and durable local operation IDs (#292);
- **minimal idempotent push + reconcile** on reconnect (#292) — server re-authorizes each operation and re-applies accepted mutations back to the local mirror.

M2 does **not** deliver full bidirectional pull with cursors, delta synchronization, optimistic-concurrency/version (OCC) checks, or the complete conflict matrix — those are **M3** scope (#160/#161). M2 push is limited to operations whose conflict semantics are defined in the minimal matrix below (Decision 8); anything outside that matrix is surfaced to the user rather than pushed speculatively.

### 8. Conflict policy

Conflict handling is entity-specific. Silent universal last-write-wins is rejected where it can lose user intent.

Per ADR-0016 rule 12, **no offline mutation may be silently discarded**. Before M2 delivers conflict-sensitive edit/delete push, the following **minimal conflict matrix** is recorded and enforced; ops outside it are surfaced to the user (fail-closed), never dropped silently:

| Mutation | M2 policy | Notes |
| --- | --- | --- |
| Item add (new local op ID) | Accepted as new record; idempotent by op ID | Duplicate replay safe server-side |
| Item edit — non-conflict-sensitive fields (e.g. notes/custom fields) | Push last-write-wins on these fields | Failed/conflicted ops surfaced to user; never silently discarded |
| Item edit — enrichment/authoritative fields (title, cover, provider metadata) | Not overwritten by offline edits; server re-authorizes and merges | Enrichment never silently overwrites a user edit (ADR-0016 invariant) |
| Item delete | Durable outbox op + server-side authorization | Rejected/conflicted deletes surfaced to user; not silently dropped |

Full bidirectional pull, cursors, OCC/version checks and the complete conflict matrix are delivered in **M3** (#160/#161).

### 9. API evolution

Existing API envelopes remain compatible during migration. New contracts are versioned where compatibility requires it. Error responses remain machine-readable and must not expose internal implementation details.

### 10. External provider boundaries

External catalog providers remain server-mediated. Provider host allowlists, SSRF controls, response size limits, bounded retries and safe caching remain mandatory. Offline operation must never turn the browser into a generic external proxy.

### 11. Assets

Public catalogue assets and private user assets remain separate. User documents/photos must use an authorization-before-signed-access pattern before file-heavy features are released.

### 12. Observability

Offline and synchronization state must expose operational evidence without collecting unnecessary personal data. Metrics must distinguish offline, pending, synchronized, conflict and failure states without logging secrets or sensitive collection content.

Telemetry (operational/analytics metrics) must not record credentials, raw private collection contents, access codes, bearer/session tokens, or user/tenant identifiers unless a later approved privacy decision explicitly requires an aggregated form.

**Security audit-trail carve-out.** Security audit trails are an explicit exception to the "no user identifiers in telemetry" clause: audit records legitimately record identity (e.g. authenticated `userId` and actor) as required for accountability, tamper-evidence and incident response. This clause applies to operational/analytics telemetry, not to audit records. Client **AUDIT** log lines log `userId` as a security-audit exception; they are excluded from metrics aggregation and from any analytics pipeline.

## Consequences

### Positive

- incremental migration without a platform rewrite;
- durable offline foundation;
- explicit security boundary;
- deterministic synchronization path;
- compatibility with current deployment model;
- clear separation between M1 foundation and M2 collector implementation;
- explicit M2/M3 sync boundary so M2 ships a minimal, safe push without over-reaching into cursor/OCC/conflict work;
- explicit trust, cache, migration and revocation boundaries.

### Negative

- temporary coexistence of Blobs and IndexedDB;
- local schema migration/versioning becomes a new responsibility;
- synchronization requires additional server contracts and testing;
- some operations intentionally remain unavailable offline;
- trusted-device lifecycle and local invalidation require dedicated implementation/testing;
- M2 pushes only a subset of mutations (minimal matrix) until M3 completes full sync/conflict handling.

## Rejected alternatives

- Immediate microservice decomposition.
- Generic service-worker caching of authenticated collection responses.
- Storing collection data in localStorage.
- Universal last-write-wins synchronization.
- Client-authoritative tenant or owner identifiers.
- Browser-direct provider access using site credentials.
- M2 delivering full bidirectional pull/cursors/OCC/conflict handling ahead of M3.

## Required follow-up

- #157 implements only the installable offline shell and must not precache private collection responses.
- #162 implements the trusted-session/security boundary, including expiry, revocation and invalidation behaviour.
- #289/#292/#159 implement the M2 collection offline workflow: mirror, outbox, minimal idempotent push + reconcile, capability/UX matrix — with the minimal conflict matrix (Decision 8) enforced before conflict-sensitive edit/delete push.
- #160/#161 implement full bidirectional synchronization, cursors, optimistic concurrency and the complete conflict matrix in **M3**.

## Gate

This ADR remains **Proposed** until the Offline Architect, Data Architect and Security Auditor have independently reviewed the renumbered/revised PR and the PM has accepted all required findings. Only then may dependent M2 implementation proceed.
