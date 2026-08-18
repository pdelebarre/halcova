# ADR-0004: Security and privacy by design

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related epic:** #337

## Decision

Security and privacy are platform capabilities and release gates. Every protected operation must follow Authenticate -> Authorize -> Validate -> Execute. Authorization is object- and property-level and derives ownership from authenticated context.

Public collection representations are explicit allowlists. Sensitive ownership data is private by default. Private assets use authorization plus short-lived signed access. External providers and user content are treated as untrusted.

Required baseline: rate limiting, schema validation, secret/dependency/SAST scanning, PII-safe logging, security audit events, negative authorization tests, threat models and export/deletion/retention controls.

AI tools must independently re-authorize and cannot escalate privileges through prompts or model output.

## Rationale

Social, AI and future marketplace features substantially increase the attack surface. Retrofitting authorization and privacy after those features exist would create unacceptable data-leakage and abuse risk.

## Consequences

Feature delivery has additional security gates, but the platform gains a consistent authorization model and significantly lower risk of BOLA/BOPLA, privacy leakage, abuse and AI privilege escalation.

## Release rule

No new P0 platform capability is production-ready with an unresolved HIGH security finding.
