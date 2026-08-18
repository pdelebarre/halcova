# ADR-0013: External provider and cache boundaries

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #313, #331

## Context

Halcova relies on catalog providers and may add valuation, marketplace and AI providers. Provider data is unreliable, potentially malicious and subject to rate limits and terms of use.

## Decision

All external providers are accessed through server-side adapters/gateways. Provider-specific payloads never become authoritative domain data without validation and normalization.

Each provider integration defines:

- authentication/secret ownership;
- request limits and timeouts;
- retry/backoff policy;
- response schema validation;
- normalization mapping;
- cache policy and TTL;
- provenance/source metadata;
- failure behavior;
- privacy/data-minimization rules.

Shared caches contain only data safe to share across users. User-private responses are scoped to the user or are not cached.

## Security

Provider responses and URLs are untrusted input. Do not follow arbitrary server-side URLs without an explicit allowlist. Validate content type, payload size and schema. Prevent SSRF through provider adapters and URL fetchers.

Secrets remain server-side and are rotated without changing domain code.

## AI and commerce

AI providers use the AI gateway defined by ADR-0006. Marketplace/valuation providers are separate adapters and cannot access payment credentials or unrelated private collection data.

## Consequences

Positive: provider replacement, outage isolation and caching are localized; the domain remains stable.

Negative: every integration requires adapter code, validation and operational policy.
