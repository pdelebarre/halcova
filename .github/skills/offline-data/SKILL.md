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

## Security requirements (checklist)

Verify before merging local-first / IndexedDB changes:

- [ ] **Offline storage review** — enumerate stores and keys, classify
      sensitivity, and minimize sensitive local data.
- [ ] **Cache scope** — private data is scoped per user + tenant and never
      shared or readable across accounts.
- [ ] **Logout cleanup** — sign-out clears/deletes the user's local records,
      sync tombstones, and any user-scoped cache, on every store.
- [ ] **Cross-account isolation** — local data from a previous account cannot
      be read after sign-in as another account; tenant switching is a
      data-boundary event (see `multi-tenant-data`).
- [ ] **Online-only operations** — payment and security-critical operations
      stay online-only.

## Required design output

- Stores and indexes.
- Migration plan.
- Repository interface.
- Offline capability matrix.
- Data-retention and sign-out behaviour.
- Test plan.
