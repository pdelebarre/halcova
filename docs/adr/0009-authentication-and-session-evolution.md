# ADR-0009: Authentication and session evolution

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related security roadmap:** SEC-EPIC-1 / identity work, #337
- **Related ADR:** 0004-passkeys-and-sign-in-with-apple (evaluation)

## Context

Halcova is passwordless and currently uses access-code authentication with server-managed sessions. Self-serve onboarding introduces email magic links. Future native iOS support may introduce passkeys or Sign in with Apple.

## Decision

Use a single server-side session model regardless of authentication method.

Authentication methods are credentials used to establish a session; they are not authorization mechanisms.

```text
Access code / magic link / passkey / Apple
                 |
                 v
          Identity resolution
                 |
          Session issuance
                 |
      Authorization middleware
                 |
          Domain operations
```

Sessions are opaque, high-entropy, revocable and expire server-side. Persistent credentials are stored only as hashes or provider-specific public identifiers where applicable.

The current access-code contract remains supported during migration. Magic-link verification is single-use, short-lived and rate-limited. Passkeys and Sign in with Apple remain additive until explicitly adopted.

## Authorization rules

- Authentication establishes identity; it does not grant resource access.
- Every protected operation derives the user identity from the validated session.
- Client-supplied owner/user IDs are never authoritative.
- Disable/delete/logout-all operations revoke affected sessions.
- Admin authorization is separate from ordinary member authorization.
- Session and credential material never appears in `publicUser` or logs.

## Recovery

Email verification remains the recovery mechanism for lost access methods unless a later ADR replaces it with an equivalent secure recovery process.

## Consequences

Positive: authentication methods can evolve independently from authorization and collection APIs; revocation and auditing remain centralized.

Negative: maintaining multiple credential methods increases testing and account-linking complexity.

## Revisit triggers

- Material email deliverability/authentication friction → evaluate passkeys.
- Native iOS application with third-party login → evaluate Sign in with Apple.
- Large public audience or phishing threat → prioritize phishing-resistant authentication.
