# Agent Runtime v2 — Deterministic Routing

The PM activates **only** the specialists required for the issue. No specialist
is activated "to be safe"; a specialist is activated because a deterministic
trigger applies or a dependency requires it.

## Ticket classification

Classify every ticket by: domain, complexity, architecture impact, security
impact, data impact, API impact, offline impact, UX impact, operational impact,
release impact, dependencies and milestone constraints. If classification is
uncertain, use the safer routing and obtain the smallest specialist
clarification needed.

## Routing matrix

| Trigger | Mandatory specialist(s) |
|---|---|
| Cross-layer / end-to-end architecture change | Whole Stack Architect |
| React/frontend architecture boundary | Front End Architect |
| Frontend implementation | Front End Developer or Runout Engineer |
| Netlify functions / Blobs / auth / PWA backend | Netlify Backend |
| Schema, migration, reconciliation or data-model change | Data Architect |
| Deployment/infrastructure/topology change | Platform Architect |
| Offline cache, local writes, sync or conflict semantics | Offline Architect |
| Consumer-visible API or compatibility change | API Contract Reviewer |
| Auth, authorization, sensitive user data, storage, caching, external API or database boundary | Security Auditor |
| AI provider / model / tool security boundary | Security Auditor + Whole Stack Architect (ADR-0006) |
| Tenant/membership/IDOR/privilege boundary | Multi-tenant Security (+ Security Auditor) |
| Critical mobile journey or accessibility gate | Ergonomics Reviewer |
| Product UI/UX design (Figma/design system) | UI UX Expert |
| Logging/metrics/diagnostics/operational evidence | Observability Engineer |
| Release/build/PWA/deployment readiness | Release Validator |
| Automated regression/coverage requirement | Tester |
| Agent/skill/prompt/governance change | Agent Developer (+ PM; ADR when governance changes) |
| New collection kind / provider model | Catalog Designer |
| Scanner/camera/barcode/OCR capability | Scanner Builder |
| IndexedDB/outbox/push-pull/retry implementation | Sync Engineer |
| Marketing / GTM | Marketing Manager |

The PM may add agents for risk or dependencies but may not omit a mandatory
specialist triggered by the ticket. Record ambiguous omissions.

## Dormant-agent rules

Do **not** activate a specialist when its trigger does not apply:

| No trigger | Agent not activated |
|---|---|
| No persistence/schema change | Data Architect |
| No auth/data/API/security boundary | Security Auditor |
| No tenant/membership boundary | Multi-tenant Security |
| Backend-only/internal refactor | Ergonomics Reviewer |
| Documentation-only change | Release Validator |
| No offline behavior | Offline Architect |
| No synchronization | Sync Engineer |
| No deployment/topology change | Platform Architect |
| No consumer-visible API change | API Contract Reviewer |
| No UI/design work | UI UX Expert |
| No operational evidence need | Observability Engineer |
| No new collection kind | Catalog Designer |
| No camera/barcode/OCR | Scanner Builder |
| No Netlify/Blobs/auth/PWA backend | Netlify Backend |
| No agent/skill/prompt change | Agent Developer |
| No GTM work | Marketing Manager |

**Never skip security gates.** When the issue affects security (auth,
authorization, user data, payments, storage, caching, external APIs, databases,
AI providers), the Security Auditor gate applies regardless of the dormant-agent
rules above.

## Minimal graph examples

```text
Low-risk UI:
PM → Front End Developer → Tester → PM

Frontend architecture:
PM → Front End Architect → Front End Developer → Tester → PM

Offline synchronization:
PM → Offline Architect → triggered Data/API specialists
  → Sync Engineer / Backend → Tester + Security Auditor
  → Release Validator if release-critical → PM

Tenant authorization:
PM → Security Auditor + Multi-tenant Security → Backend
  → Tester → Security re-review → PM
```
