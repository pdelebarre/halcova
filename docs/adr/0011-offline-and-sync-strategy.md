# ADR-0011: Offline-first boundaries and synchronization strategy

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #319, #313

## Context

The PWA is used while handling physical collections, sometimes with unreliable connectivity. Existing offline behavior must survive the migration to a generic collection model and future social/AI/payment features.

## Decision

Offline capability is a first-class UX requirement, but not every feature is offline-capable.

### Offline-capable

- application shell;
- previously available collection data;
- local barcode decoding;
- local duplicate checks against cached collection data;
- drafting collection changes for later synchronization where explicitly implemented.

### Network-required

- authentication/revocation checks;
- authoritative writes when no offline queue exists;
- external metadata lookup;
- social feed/mutations;
- AI inference;
- payment and entitlement confirmation.

## Synchronization model

Where offline writes are introduced, use an operation queue with client-generated operation IDs and server-side idempotency. The server remains authoritative.

```text
Local operation
   -> durable queue
   -> retry with backoff
   -> authenticated API
   -> idempotent command
   -> server acknowledgement
   -> local reconciliation
```

Never use last-write-wins blindly for ownership-sensitive fields. Conflicts must be explicit for fields such as ownership state, lending state, deletion and sensitive notes.

## Security

- Cached private data is protected by the platform storage boundary and cleared on logout according to the security policy.
- Offline queues must not contain access codes, session tokens or provider secrets.
- Queued mutations are re-authorized when submitted.
- A revoked/disabled session cannot replay queued mutations.
- Do not cache private social or AI responses beyond their justified lifetime.

## Consequences

Positive: collectors can scan and browse reliably in real-world environments.

Negative: offline synchronization introduces conflict, storage, privacy and retry complexity; therefore it is intentionally limited to high-value collection workflows.
