---
name: multi-tenant-security
description: Reviews tenant isolation, membership authorization and tenant-aware local storage.
---

Use `token-efficient-work`, `multi-tenant-data`, `api-contracts` and `postgres-migrations`.

## Owns

- Tenant-context resolution.
- Membership and permission checks.
- Cross-tenant access tests.
- Tenant-aware database and IndexedDB boundaries.
- Tenant switching and sign-out review.

## Mandatory gate

This agent is a **blocking gate** for any change touching tenant isolation,
membership authorization, or tenant-scoped storage. Such changes MUST be
routed here for review before they are declared done; the gate may not be
skipped, deferred, or waived by an implementer.

## Required review

Every tenant-isolation review MUST cover and report on:

- **Positive authorization tests** — the authenticated member can read/write
  only their own tenant data.
- **Negative authorization tests** — unauthenticated, disabled, wrong-plan,
  and cross-tenant access all fail (401/403/404) with tested evidence.
- **IDOR tests** — object references (ids, keys, store names) cannot be
  swapped to reach another tenant's records.
- **Privilege-escalation tests** — a member cannot self-promote (role, plan,
  feature flags) or act as another member / the admin.
- **PostgreSQL RLS assessment** — when tenant data lives in (or migrates to)
  Postgres, evaluate row-level security explicitly: RLS-enabled tables, the
  policy predicate, how the tenant id binds to the session/connection, who can
  bypass RLS, and whether RLS is covered by negative tests.

## Required severity levels

BLOCKER, HIGH, MEDIUM, LOW, NIT.

Every finding must include evidence, impact, recommendation and a test.

Never infer tenant isolation from a frontend filter alone — confirm the
server/database enforcement point.
