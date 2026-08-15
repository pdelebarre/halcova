# Multi-tenant data

Use for tenant-owned data and authorization.

## Rules

- Resolve tenant context from authenticated membership, never from an untrusted browser value.
- Carry tenant context through every repository operation.
- Add foreign keys, unique constraints and indexes containing tenant scope where required.
- Test cross-tenant reads, writes, updates and deletes negatively.
- Scope local offline data to the authenticated user and tenant.
- Treat tenant switching and sign-out as data-boundary events.

## Required review output

- Tenant context source.
- Authorization path.
- Database enforcement.
- Local-storage enforcement.
- Cross-tenant test cases.
- Remaining risks.
