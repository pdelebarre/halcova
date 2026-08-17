# Multi-tenant data

Use for tenant-owned data and authorization.

## Rules

- Resolve tenant context from authenticated membership, never from an untrusted browser value.
- Carry tenant context through every repository operation.
- Add foreign keys, unique constraints and indexes containing tenant scope where required.
- Test cross-tenant reads, writes, updates and deletes negatively.
- Scope local offline data to the authenticated user and tenant.
- Treat tenant switching and sign-out as data-boundary events.

## Required tests

A tenant-isolation review MUST include:

- **Positive authorization tests** — a member reads/writes only their own data.
- **Negative authorization tests** — cross-tenant reads, writes, updates and
  deletes fail (this extends the "test cross-tenant ... negatively" rule above
  and is blocking, not advisory).
- **IDOR tests** — guessable or swappable object references (ids, keys, store
  names) cannot reach another tenant's data.
- **Privilege-escalation tests** — a member cannot self-promote (role, plan,
  feature flags) or impersonate another member/admin.

## PostgreSQL RLS assessment

When tenant data lives in (or migrates to) Postgres, assess row-level security
explicitly:

- Which tables carry tenant data and are RLS-enabled?
- What is the policy predicate, and how is the tenant id bound to the
  session/connection (e.g. a session setting like `app.current_tenant`)?
- Who can bypass RLS (`BYPASSRLS` / table owner) and how is that minimized?
- Are RLS policies covered by negative (cross-tenant) tests?

RLS is the enforcement point; frontend or application-level filters are
defense-in-depth only and never a substitute. Never infer tenant isolation
from a frontend filter alone — confirm the server/database enforcement point.

## Required review output

- Tenant context source.
- Authorization path.
- Database enforcement.
- Local-storage enforcement.
- Cross-tenant test cases.
- Remaining risks.
