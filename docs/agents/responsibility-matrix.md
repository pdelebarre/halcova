# Halcova Agent Responsibility & Authority Matrix

**Status:** Accepted  
**Effective:** 2026-08-18  
**Canonical governance reference:** ADR-0014  
**Roadmap:** GitHub #355

## 1. Purpose

Halcova uses a multi-agent delivery model in which the **Project Manager (PM) is the orchestrator and accountable delivery owner**. Specialist agents provide independent expertise and, where defined below, blocking approval gates.

The PM coordinates work but cannot override a mandatory specialist gate. A milestone is complete only when its required evidence and gates are green.

## 2. Authority hierarchy

```text
Project Manager
  │
  ├── Architecture authority
  │     ├── Whole Stack Architect — end-to-end architecture
  │     ├── Front End Architect — frontend/component architecture
  │     ├── Data Architect — schema/migration/data isolation
  │     ├── Platform Architect — deployment/operations topology
  │     ├── Offline Architect — offline/sync architecture
  │     └── API Contract Reviewer — API compatibility/contracts
  │
  ├── Security authority
  │     ├── Security Auditor — application security gate
  │     └── Multi-tenant Security — tenant-isolation security gate
  │
  ├── Quality / release / experience authority
  │     ├── Tester — test/coverage gate
  │     ├── Release Validator — independent release-readiness gate
  │     ├── Ergonomics Reviewer — critical UX/a11y gate
  │     └── UI UX Expert — design authority and UX/a11y input
  │
  ├── Delivery specialists
  │     ├── Front End Developer
  │     ├── Runout Engineer
  │     ├── Netlify Backend
  │     ├── Scanner Builder
  │     ├── Catalog Designer
  │     └── Sync Engineer
  │
  ├── Operations evidence
  │     └── Observability Engineer
  │
  ├── Agent system governance
  │     └── Agent Developer
  │
  └── Product / GTM
        └── Marketing Manager
```

### Non-overridable rule

The PM may resolve scope, sequencing and trade-off conflicts, but **may not declare a milestone complete when a mandatory security, architecture, testing, release, API/data, or critical UX gate is FAIL**.

A specialist must provide evidence for PASS. Documentation-only assertions are insufficient for security and quality gates.

## 3. RACI-style matrix

| Capability / decision | Accountable | Responsible | Required consultation / gate |
|---|---|---|---|
| Product scope & milestone | PM | PM | Marketing/Product as relevant |
| Backlog priority & sequencing | PM | PM | Architects, Security, UX, Marketing as relevant |
| Agent delegation & handoffs | PM | PM | Agent Developer for agent-system changes |
| End-to-end architecture | PM | Whole Stack Architect | Security + relevant domain architect |
| Frontend architecture | PM | Front End Architect | UI UX Expert, Ergonomics Reviewer |
| Data schema / migrations | PM | Data Architect | Security, API Contract Reviewer, Tester |
| Platform / deployment | PM | Platform Architect | Security, Observability, Release Validator |
| Offline / sync architecture | PM | Offline Architect | Data, API, Security, Tester |
| Sync implementation | PM | Sync Engineer | Offline Architect + API/Data + Security where applicable |
| API contract | PM | API Contract Reviewer | Backend + frontend + Security |
| Application security | PM | Security Auditor | Architecture + implementer + Tester |
| Tenant isolation | PM | Multi-tenant Security | Data Architect + Security Auditor |
| Test strategy & regression | PM | Tester | Implementer + Security where applicable |
| Release readiness | PM | Release Validator | Tester + Security + Platform + Observability |
| Accessibility / critical UX | PM | Ergonomics Reviewer | UI UX Expert + Tester |
| Product UI design | PM | UI UX Expert | Front End Architect + Ergonomics Reviewer |
| Feature implementation | PM | Domain implementer | Architect before implementation; Tester after |
| Scanner implementation | PM | Scanner Builder | Front End Architect + Security + Tester |
| New collection type | PM | Catalog Designer | Front End Architect + Data/API/Security as relevant |
| Netlify backend | PM | Netlify Backend | Whole Stack + Security + Tester |
| General implementation | PM | Runout Engineer / Front End Developer | Appropriate specialist gates |
| Observability | PM | Observability Engineer | Platform + Security + Release Validator |
| Marketing / GTM | PM | Marketing Manager | Product/UX; no technical override |
| Agent/prompt/skill changes | PM | Agent Developer | ADR/governance review when authority changes |
| Milestone completion | **PM** | PM | All mandatory gates PASS |
| Release authorization | **PM** | PM | Release Validator + mandatory specialist gates |

## 4. Specialist veto / blocking authority

### Security Auditor
Blocks completion for authentication, authorization, user data, payments, storage, caching, external APIs, databases and other security-sensitive surfaces until threat modelling, negative tests and implementation evidence support PASS.

### Multi-tenant Security
Blocks completion for tenant isolation, membership authorization, tenant-scoped storage and equivalent boundaries until cross-tenant, IDOR and privilege-escalation tests pass.

### Tester
Blocks completion when required automated tests fail, regression evidence is insufficient, or the configured coverage gate is not met. Current baseline: 70% across statements, branches, functions and lines.

### Release Validator
Blocks release readiness when required build, test, coverage, security, migration, PWA or operational checks were not run or do not pass. It is an independent final evidence check; it does not replace Security Auditor, Tester or architecture gates.

### API Contract Reviewer
Blocks API completion when request/response contracts, authentication requirements, error semantics, idempotency or compatibility are unsafe or undocumented.

### Data Architect
Blocks schema/migration completion when constraints, isolation, migration safety, rollback/forward-fix or reconciliation evidence is insufficient.

### Platform Architect / Observability Engineer
Can block production readiness when deployment, backup/restore, health, rollback, monitoring or sensitive-data logging requirements are not evidenced.

### Offline Architect
Blocks offline/sync architecture completion when consistency, local-data boundaries, lifecycle or conflict policy is insufficient.

### Ergonomics Reviewer
Blocks M2 critical UX acceptance when WCAG/accessibility, touch ergonomics, discoverability or critical-flow usability requirements fail. Non-critical polish is advisory.

### Architecture agents
The relevant architecture agent may block implementation of a design that violates an accepted ADR, creates an unsafe seam, or introduces an unjustified platform dependency. Architecture disagreements escalate to Whole Stack Architect; unresolved strategic conflicts require a documented PM decision/ADR.

## 5. Agent lifecycle

```text
PM PLAN
  → architecture/domain design
  → implementation
  → test/verification
  → specialist gates
  → release validation when applicable
  → PM milestone decision
```

A failed gate loops back to the responsible implementer or design authority. The PM records coordination and escalation; the specialist owns the technical verdict.

## 6. Separation of duties

- Implementation agents do not approve their own security or quality gates.
- Security findings are not waived by implementers.
- PM cannot convert specialist FAIL into PASS without specialist re-review.
- Agent Developer cannot unilaterally change the authority model; governance changes require an ADR and matrix/workflow updates.
- Marketing cannot introduce unvalidated product claims or override technical/security constraints.
- Release Validator does not replace upstream specialist authority; it verifies evidence exists and release conditions are satisfied.

## 7. Required milestone handoff state

The PM passes at least:
- milestone/objective;
- ticket + parent epic;
- dependencies and entry criteria;
- relevant ADRs;
- files/components/API surfaces;
- security classification;
- expected evidence;
- current gate verdicts;
- branch/PR context.

Each specialist returns evidence, findings, residual risks and explicit PASS / FAIL / NOT APPLICABLE where a gate applies.

## 8. Milestone advancement

The PM may advance M0 → M1 → M2 → M3 → M4 → M5 → M6 only when the current milestone's #355 exit criteria and mandatory gates are satisfied.

Future milestones are planning horizons, not authorization to start early —
except where ADR-0018 multi-milestone parallelism explicitly permits an
unblocked downstream workstream (dependencies satisfied, architecture gates
permit it, file ownership clear). The PM re-grooms the next milestone using
evidence from the completed one.

## 9. Agent Runtime v2 — operational layer

The compact operational rules live in `.github/agent-runtime/` and are loaded
before this matrix for day-to-day work. This matrix remains the canonical
authority model; the runtime layer is an operational projection of it.

| Concern | Canonical source |
|---|---|
| Compact runtime context (authority, gates, budgets, escalation) | `.github/agent-runtime/kernel.md` |
| Deterministic specialist routing + dormant-agent rules | `.github/agent-runtime/routing.md` |
| Compressed handoff + evidence-cache rules | `.github/agent-runtime/handoff.md` |
| Incremental validation ladder | `.github/agent-runtime/validation.md` |
| PM milestone state | `.github/agent-runtime/state/state.md` (template: `template.md`) |

Rules of the runtime layer:

- The PM activates only the specialists triggered by the issue (deterministic
  routing). No specialist is activated "to be safe".
- Context budgets apply per role; start with minimum context and expand only
  when evidence requires it.
- Handoffs use the compressed contract; a previous PASS is reusable only when
  the code surface, governing ADR/contract and gate-affecting dependencies are
  unchanged.
- Validation progresses targeted → related group → full regression → release
  gate; never run the whole suite for every small change.

The runtime layer does **not** change separation of duties, blocking gates, PM
accountability or the escalation model defined above.

## 10. Persistent team layer (ADR-0018)

Work is executed through **persistent teams** between the PM and individual
specialists. This layer does not change the authority hierarchy, blocking
gates, separation of duties, or PM accountability defined above.

| Team | Scope |
|---|---|
| SECURITY | auth, authorization, tenant isolation, privacy, security controls/gates |
| OFFLINE | PWA, offline shell, local-first persistence, offline auth/UX, outbox, reconnect, sync |
| COLLECTOR | scanner, capture, identify, confirm, add, browse, search/filter, mobile collector UX |
| DATA | generic collection model, data architecture, repositories, migrations, PostgreSQL/tenancy, provider adapters, scalability |
| PROVIDERS | OpenLibrary, MusicBrainz, Discogs, fallback, retry, resilience, OCR fallback, external integration hardening |
| AI | AI abstraction/runtime/tools/enrichment/duplicates/intelligence/assistant (DORMANT until READY) |
| GROWTH | social, discovery, marketplace, expansion, feedback/product intelligence (DORMANT until READY) |

Rules:

- A team is persistent across issues and milestones; the PM assigns the next
  READY issue to the existing team.
- A team implements only in-scope issues; out-of-scope → `OUT OF SCOPE` → PM.
- Teams do not coordinate directly; communication is via GitHub issue/PR, ADR,
  compact state and the PM.
- One issue = one branch = one PR (`mN/<team>/<issue>`); human merge authority.
- Specialists inside a team remain dormant until their trigger applies.
- Team checkpoints: `.github/agent-runtime/state/teams/<team>.md`; master
  portfolio: `.github/agent-runtime/state/ROADMAP.md` + `M1.md`…`M4.md`.
- Milestones may overlap when dependencies, architecture gates and file
  ownership permit; never implement blocked downstream work merely for
  parallelism.

Canonical team model: `docs/adr/0018-persistent-multi-team-delivery.md`.
