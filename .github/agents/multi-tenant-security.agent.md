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

## Required severity levels

BLOCKER, HIGH, MEDIUM, LOW, NIT.

Every finding must include evidence, impact, recommendation and a test.

Never infer tenant isolation from a frontend filter alone.
