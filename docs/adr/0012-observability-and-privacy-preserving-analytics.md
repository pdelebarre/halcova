# ADR-0012: Observability and privacy-preserving analytics

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #354, #337

## Context

Halcova needs operational telemetry and product metrics to scale safely and measure collector UX. Collection content can contain personal and commercially sensitive information, so observability must not become a secondary data-exfiltration path.

## Decision

Separate operational logs, security audit events and product analytics. Each has a documented purpose, retention and data minimization rule.

### Operational telemetry

Capture request outcome, latency, dependency health, queue/retry state and coarse resource identifiers. Never log credentials, access codes, session tokens, provider secrets or private collection content.

### Security audit events

Record security-relevant actions such as login failures, session revocation, authorization failures, role/entitlement changes, asset access decisions and moderation actions. Store actor/resource identifiers only as necessary and protect audit access.

### Product analytics

Measure privacy-preserving funnel events such as time-to-first-item, time-to-add, identification success, add completion, collection activity, wishlist conversion, public-share conversion, retention and AI cost/provider reliability.

Do not use full collection payloads as analytics dimensions.

## Controls

- structured events;
- documented retention;
- access control for logs/audit data;
- redaction tests for sensitive fields;
- correlation IDs without embedding credentials;
- provider and AI telemetry separated from prompts/content;
- alerting for security and availability thresholds.

## Consequences

Positive: actionable reliability/security/product insight without creating a shadow copy of user collections.

Negative: some debugging requires correlation and controlled access to source systems rather than unrestricted logs.
