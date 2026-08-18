# ADR-0010: API contract, validation and error semantics

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #313, #337

## Context

Halcova currently exposes Netlify Functions and a browser client. The roadmap adds generic collections, social, AI, imports and payments. Without a stable contract, these capabilities would create inconsistent authorization, validation and error handling.

## Decision

Treat the API as a stable application boundary independent of the current compute platform.

Existing routes remain compatible during migration. New resources use resource-oriented endpoints and explicit request/response schemas. Breaking changes require explicit versioning and a migration plan.

Every request follows:

```text
Authenticate
  -> Authorize resource + properties
  -> Validate request schema
  -> Execute domain command/query
  -> Return allowlisted response
```

The server derives ownership and tenancy from the authenticated session. Request bodies may contain a target resource identifier, but never an authoritative owner identity.

## Validation

- Reject unknown or unsafe fields where practical.
- Enforce maximum body, field, array and upload sizes.
- Normalize identifiers before lookup.
- Validate external-provider responses before mapping them into domain objects.
- Treat imported data, metadata and LLM output as untrusted.
- Do not use client validation as a security control.

## Error contract

Errors use stable machine-readable codes plus safe human-readable messages. Examples include `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` and domain-specific codes such as `PLAN_LIMIT`.

Do not expose stack traces, database errors, provider credentials or sensitive existence information.

## Consequences

Positive: clients can evolve independently, negative authorization tests become systematic, and Netlify Functions can later be replaced by a dedicated API without changing the product contract.

Negative: schemas and compatibility require deliberate versioning and test maintenance.
