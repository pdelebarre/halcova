# Residual Risk Register — Halcova Collection Platform

> **Issue:** SEC-7.5 #342  
> **Milestone:** M1 — Security, Reliability & Platform Foundation  
> **Last updated:** 2026-08-20  
> **Owner:** @pdelebarre

This register records security risks that are **known, evaluated, and explicitly accepted** for M1. Each entry requires a named owner and a justification. Entries without a justification are not accepted — they must be fixed or escalated.

---

## How to use this register

1. A finding is identified (via CodeQL, npm audit, Gitleaks, manual review, or a test failure).
2. If it cannot be fixed before M1 close, it is added here with a severity, owner, and justification.
3. The Security Auditor reviews the register before recording PASS.
4. Items rated HIGH or CRITICAL require explicit sign-off; they are not accepted by default.

---

## Open Accepted Risks

| # | Area | Severity | Finding | Justification | Owner | Accepted date |
|---|---|---|---|---|---|---|
| RR-001 | Platform | LOW | No application-level circuit breaker for Netlify function invocations | Netlify platform limits apply. Cost DoS is mitigated by per-identity rate limiting. A circuit breaker is planned for M2. | @pdelebarre | 2026-08-20 |
| RR-002 | Prompt injection | INFO | No server-side LLM integration in M1 | Client-only AI features; no user text is forwarded to an LLM API by the server. Re-evaluate when server-side LLM is introduced. | @pdelebarre | 2026-08-20 |
| RR-003 | Session storage | LOW | Session tokens stored in localStorage | Industry standard for SPAs. HttpOnly cookies require a same-origin backend; Netlify Functions are cross-origin in this architecture. XSS mitigations (CSP, React escaping) reduce the attack surface. Upgrade path to HttpOnly cookies is documented for M2. | @pdelebarre | 2026-08-20 |

---

## Closed / Fixed Risks

| # | Area | Severity | Finding | Resolution | Closed date |
|---|---|---|---|---|---|
| RF-001 | BOLA | HIGH | Cross-user item access via guessed id | Per-user isolated blob stores + uniform 403 (SEC-7.1, #338) | 2026-08-18 |
| RF-002 | BOPLA | HIGH | Crafted body with ownerId/role/plan | `pickItemFields()` allowlist strips all non-item fields (SEC-EPIC-2, #188) | 2026-08-18 |
| RF-003 | Credential leak | HIGH | Secrets in source code | Gitleaks blocking scan on all PRs; full history clean | 2026-08-18 |
| RF-004 | Dependency | MEDIUM | Vulnerable npm packages | `npm audit --audit-level=high` blocking on PRs | 2026-08-18 |
| RF-005 | Abuse/DoS | MEDIUM | No rate limiting on write endpoints | Per-identity write sub-limit (SEC-7.4, #341) | 2026-08-18 |

---

## Security Auditor Sign-off

| Auditor | Date | Decision | Notes |
|---|---|---|---|
| _(pending)_ | | | |
