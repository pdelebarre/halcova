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
| Post-gate FAIL loop completed | Agent Developer — write `LESSONS_LEARNED.md` entry + open `[RETRO-x.y]` ticket (P1 label: `retro`, link to original issue) |
| Weekly cadence (every 7 days) | PM — update `VELOCITY` block in `kernel.md` with rolling metrics |


The PM may add agents for risk or dependencies but may not omit a mandatory
specialist triggered by the ticket. Record ambiguous omissions.

## Persistent team routing (ADR-0018)

The PM routes every ticket to exactly **one persistent team** (its scope
owner), then activates only the triggered specialists inside that team. See
`docs/adr/0018-persistent-multi-team-delivery.md` for full scopes.

| Team | Owns triggers | State |
|---|---|---|
| SECURITY | auth, authorization, tenant isolation, privacy, security controls/gates | active |
| OFFLINE | PWA, offline shell, local-first persistence, offline auth/UX, outbox, reconnect, sync | active |
| COLLECTOR | scanner, capture, identify, confirm, add, browse, search/filter, mobile collector UX | active |
| DATA | generic collection model, data architecture, repositories, migrations, PostgreSQL/tenancy, provider adapters, scalability | active |
| PROVIDERS | OpenLibrary, MusicBrainz, Discogs, provider fallback, retry, resilience, OCR fallback, external integration hardening | active |
| AI | AI provider abstraction, AI runtime, tool contracts, metadata enrichment, duplicate detection, collection intelligence, assistant | DORMANT |
| GROWTH | social, discovery, marketplace, collection expansion, feedback/product intelligence | DORMANT |

A DORMANT team is not assigned work until its GitHub dependencies are READY.
The PM assigns the next READY issue to the existing team — never recreate the
team per issue.

### Team scope boundary

- A team may implement only issues within its scope.
- An issue outside a team's scope → report `OUT OF SCOPE` and return control to
  the PM. A team must not implement out-of-scope work or expand its own
  roadmap.
- Teams do not coordinate with each other directly; cross-team communication
  goes through GitHub issue/PR, ADR, compact state and the PM.

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

**Dormant within a team.** An active team does not activate every specialist.
Activate only the specialists whose trigger applies to the current issue (e.g.
Sync Engineer only for outbox/conflict work; Data Architect only for
schema/migration work; Ergonomics Reviewer only for user-facing interaction
changes).

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
