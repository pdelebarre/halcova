# ADR-0016: Passkeys and Sign in with Apple evaluation

- **Status:** Accepted — Deferred
- **Date:** 2026-08-18
- **Related security roadmap:** identity/authentication work
- **Supersedes:** duplicate legacy `0004-passkeys-and-sign-in-with-apple.md`

## Context

Halcova is already passwordless. Members use access-code/session authentication and self-serve email verification. Passkeys and Sign in with Apple are candidates for a future consumer authentication experience.

## Decision

Defer both technologies for the current PWA/private-test stage.

Passkeys should be reconsidered when authentication friction, phishing risk or public scale justifies phishing-resistant credentials. Sign in with Apple should be reconsidered when a native iOS application or a third-party-login strategy makes it materially valuable.

If adopted, both are additive authentication methods that resolve to the same server-side session model defined by ADR-0009. They do not bypass authorization or replace the recovery mechanism without a separate decision.

## Security requirements if adopted

### Passkeys

- WebAuthn origin/RP-ID validation;
- short-lived single-use challenges;
- credential public keys only, never private keys;
- sign-counter/cloning checks where applicable;
- account recovery through an independently secured mechanism;
- credential revocation and account-management UX.

### Sign in with Apple

- validate issuer, audience, expiry and nonce;
- validate authorization state/CSRF protections;
- treat Apple private-relay email addresses correctly;
- link accounts explicitly rather than silently merging identities;
- keep Apple identifiers separate from authorization roles.

## Revisit triggers

- measurable email-login friction or deliverability problems;
- phishing incidents or materially increased public exposure;
- native iOS application planning;
- security/compliance requirements for stronger authentication.
