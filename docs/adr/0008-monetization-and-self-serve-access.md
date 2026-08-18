# ADR-0008: Monetization & self-serve access

- **Status:** Proposed
- **Date:** 2026-08-18
- **Related roadmap:** #354, #343
- **Supersedes:** legacy duplicate `0003-monetization-and-self-serve-access.md`

## Context

Halcova currently has an admin-mediated access model and a configurable free-tier cap. Public growth requires self-serve onboarding and a sustainable entitlement model without coupling the collection domain to a payment provider.

## Decision

Adopt a provider-neutral entitlement boundary. Billing providers may create or change entitlements, but the collection/application layer consumes normalized entitlements such as `free`, `premium`, `lifetime` and `unlimited`.

Stripe Checkout is the initial implementation candidate, subject to the final merchant-of-record/VAT decision. Payment details never enter the collection domain and no card data is handled by Halcova.

Self-serve onboarding uses passwordless email verification/magic links. Access-code/session compatibility is preserved during migration.

The server is authoritative for plan limits. Client UI is only a presentation of entitlement state.

## Architecture

```text
User
  |
Self-serve auth
  |
Entitlement service <---- Payment provider webhook
  |
Application authorization
  |
Collection domain
```

Webhook processing is signature-verified, idempotent and server-only. Provider identifiers are integration metadata and are not exposed through normal public user representations.

## Security requirements

- Never accept price or entitlement values from the client.
- Verify webhook signatures against the raw request body.
- Make webhook and reconciliation processing idempotent.
- Rate-limit checkout/status endpoints.
- Do not log payment secrets, magic links, access codes or unnecessary billing data.
- Keep payment-provider credentials server-side.
- Payment failures must not delete user collection data.

## UX / product rules

- Free tier remains useful and is not a countdown trial.
- Primary paywall trigger is a meaningful product limit such as adding beyond the free allowance.
- Existing private-test users are grandfathered according to the launch policy.
- Pricing is configuration, not application logic.

## Consequences

Positive: self-serve growth, clean payment boundary, reversible provider choice and simple authorization semantics.

Negative: entitlement lifecycle, webhook reconciliation and billing/legal requirements add operational complexity.

## Related decisions

- ADR-0001 — demo/free-tier behavior
- ADR-0002 — phased scaling
- ADR-0004 — security/privacy
- ADR-0009 — authentication evolution
