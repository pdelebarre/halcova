# Offline data

Use for IndexedDB and local-first workflows.

## Rules

- Treat IndexedDB as a persistence boundary, not a UI state object.
- Scope local records by user, tenant and device where appropriate.
- Version schemas and test migrations.
- Include `updatedAt`, server version, sync status and deletion tombstones for synchronizable entities.
- Never store raw passwords.
- Minimize sensitive local data and provide an explicit local-data deletion path.
- Keep payment and security-critical operations online-only unless explicitly approved.

## Required design output

- Stores and indexes.
- Migration plan.
- Repository interface.
- Offline capability matrix.
- Data-retention and sign-out behaviour.
- Test plan.
