# ADR-0015: Platform foundation and offline-first architecture

- **Status:** Accepted
- **Date:** 2026-08-19
- **Related roadmap:** #150, #152, #157, #162

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

### 4. Offline trust model

Offline access is allowed only on a previously authenticated/trusted device and only for capabilities whose data has already been synchronized locally. Offline authorization is bounded by the approved session/trust policy.

No raw passwords, access codes, bearer/session tokens or equivalent credentials may be stored in IndexedDB.

Sign-out and account switching must clear or invalidate local collection data according to the offline security policy. Local keys and records must be scoped so another user/tenant cannot reuse them accidentally.

### 5. Synchronization

M2/M3 synchronization will use explicit operation identities, durable outbox records, server-side authorization, idempotent processing, cursors and optimistic concurrency. Synchronization is not implemented by blindly replaying HTTP requests.

Every offline mutation must have a deterministic operation ID. Server-side processing must reject cross-user/tenant replay and duplicate operations must be safe.

### 6. Conflict policy

Conflict handling is entity-specific. Silent universal last-write-wins is rejected where it can lose user intent. The detailed M2/M3 conflict matrix will be recorded before conflict-sensitive implementation.

### 7. API evolution

Existing API envelopes remain compatible during migration. New contracts are versioned where compatibility requires it. Error responses remain machine-readable and must not expose internal implementation details.

### 8. External provider boundaries

External catalog providers remain server-mediated. Provider host allowlists, SSRF controls, response size limits, bounded retries and safe caching remain mandatory. Offline operation must never turn the browser into a generic external proxy.

### 9. Assets

Public catalogue assets and private user assets remain separate. User documents/photos must use an authorization-before-signed-access pattern before file-heavy features are released.

### 10. Observability

Offline and synchronization state must expose operational evidence without collecting unnecessary personal data. Metrics must distinguish offline, pending, synchronized, conflict and failure states without logging secrets or sensitive collection content.

## Consequences

### Positive

- incremental migration without a platform rewrite;
- durable offline foundation;
- explicit security boundary;
- deterministic synchronization path;
- compatibility with current deployment model;
- clear separation between M1 foundation and M2 collector implementation.

### Negative

- temporary coexistence of Blobs and IndexedDB;
- local schema migration/versioning becomes a new responsibility;
- synchronization requires additional server contracts and testing;
- some operations intentionally remain unavailable offline.

## Rejected alternatives

- Immediate microservice decomposition.
- Generic service-worker caching of authenticated collection responses.
- Storing collection data in localStorage.
- Universal last-write-wins synchronization.
- Client-authoritative tenant or owner identifiers.
- Browser-direct provider access using site credentials.

## Required follow-up

- #157 implements only the installable offline shell.
- #162 hardens the offline trust/session boundary.
- #158/#159/#289/#292 implement the M2 collection offline workflow.
- #160/#161 implement robust synchronization and conflict handling in M3.
