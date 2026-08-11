---
name: whole-stack-architecture
description: "Whole-stack architecture for Runout: analyze the React/Vite SPA, the Netlify serverless functions (collection/auth/admin/discogs), Netlify Blobs, auth boundaries, caching, rate limits, and deployment topology; and design scalable cloud evolution — including evaluating a Spring Boot backend — with incremental migration paths. Triggers: 'architecture', 'scalability', 'cloud', 'Spring Boot', 'backend design', 'API contract', 'deployment topology', 'ADR', 'system design'."
---
# Whole-Stack Architecture

How to reason about Runout's architecture end to end and design its evolution.
Read-only — produces reviews and design decisions, never edits code.

## When to Use
- Review the app for scalability / cloud-readiness / maintainability.
- Design a target architecture (e.g. a Spring Boot backend, a managed
  datastore, a caching layer) with a migration path.
- Decide API contracts, storage layout, auth boundaries, or deployment
  topology.

## Current Stack (ground truth — read the code before designing)
- **Frontend**: React 19 + Vite 8 SPA (`src/`), PWA via `vite-plugin-pwa`
  (precached shell + scanner `.wasm`, runtime caching for Discogs/Google
  Books).
- **Backend**: Netlify Functions (`netlify/functions/`): `collection` (CRUD
  over Blobs, auth-gated), `auth`/`admin` (access codes), `discogs` (server
  proxy, single `RUNOUT_DISCOGS_TOKEN`, cached in Blobs). **There is no
  Spring Boot backend today.**
- **Storage**: Netlify Blobs — `runout-identity` (users/requests), owner
  stores `runout-collection` / `runout-library`, per-member
  `collection-<userId>-<kind>`, and the Discogs lookup cache.
- **Auth**: Bearer access codes / admin key, validated in every function;
  per-user store isolation; per-collection plans (403).

## Review Dimensions
- **API contracts** — surface, error model (`{ error }` + HTTP codes),
  versioning, and who owns each endpoint (client `src/api/*` vs functions).
- **Auth & tenant isolation** — per-user stores, plan enforcement, admin
  boundary, secret handling (`RUNOUT_ADMIN_KEY`, Discogs token).
- **Storage** — key layout, `index` + `item:<id>` pattern, growth, and
  migration risk (renaming keys orphans collections).
- **Caching & rate limits** — Discogs proxy cache (Blobs), PWA runtime
  caching; where the next bottleneck appears.
- **Reliability** — no client error boundary (dark-screen), optimistic
  updates + rollback, error surfacing.
- **Deployment & cloud** — current Netlify topology vs managed services; what
  actually needs to scale (functions, blobs, caching, a dedicated API
  service).

## Designing an Evolution (including Spring Boot)
Evaluate with trade-offs, not hype. If the serverless ceiling is the concern,
design a Spring Boot service (e.g. Azure App Service/ACA or container hosting)
that:
- Exposes the same API contract the SPA already calls (so the frontend moves
  unchanged).
- Migrates Blobs → a real datastore with a migration path that never orphans
  the owner's legacy stores.
- Reuses or deliberately evolves the access-code auth model.
- Keeps the PWA + offline behavior intact during the move (incremental, not a
  big-bang rewrite).

## Procedure
1. Read `docs/technical.md`, the functions under `netlify/functions/`, and
   `src/api/*` to build the current picture.
2. Produce a current-state summary and score each review dimension.
3. For a target design: options → chosen option → steps → risks → preserve
   list.
4. Deliver as a written architecture decision; never edit app code.

See [references/scalability-review.md](./references/scalability-review.md) for
the checklist.
