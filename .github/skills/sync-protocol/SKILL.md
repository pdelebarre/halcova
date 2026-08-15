# Synchronization protocol

Use for offline mutation queues and reconciliation.

## Required properties

- Stable operation ID.
- Device ID.
- Idempotent server processing.
- Push and incremental pull semantics.
- Cursor persistence and recovery.
- Exponential retry with bounded attempts.
- Explicit conflict response.
- Tombstone handling.
- Observable queue state.

## Default operation envelope

```json
{
  "operationId": "...",
  "deviceId": "...",
  "entityType": "...",
  "entityId": "...",
  "operation": "CREATE|UPDATE|DELETE",
  "baseVersion": 0,
  "payload": {}
}
```

Do not use silent last-write-wins for all entities. Define a merge policy per entity type.
