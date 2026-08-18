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
  ├── accountable for scope, sequencing, priorities, delegation and milestone advancement
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
  ├── Quality & experience authority
  │     ├── Tester — test/coverage gate
  │     ├── Ergonomics Reviewer — UX/a11y review gate
  │     └── UI UX Expert — design authority and UX/a11y input
  │
  ├── Delivery specialists
  │     ├── Front End Developer
  │     ├── Runout Engineer
  │     ├── Netlify Backend
  │     ├── Scanner Builder
  │     └── Catalog Designer
  │
  ├── Operations evidence
  │     └── Observability Engineer
  │
  ├── Agent system governance
  │     └── Agent Developer
  │
  └── Product/GTM
        └── Marketing Manager
```

### Non-overridable rule

The PM may resolve scope, sequencing and trade-off conflicts, but **may not declare a milestone complete when a mandatory security, architecture, testing, API/data, or critical UX gate is FAIL**.

A specialist must provide evidence for a PASS. Documentation-only assertions are insufficient for security and quality gates.

## 3. RACI-style matrix

| Capability / decision | Accountable | Responsible | Required consultation / gate |
|---|---|---|---|
| Product scope & milestone | PM | PM | Marketing/Product as relevant |
| Backlog priority & sequencing | PM | PM | Architects, Security, UX, Marketing as relevant |
| Agent delegation & handoffs | PM | PM | Agent Developer for agent-system changes |
| End-to-end architecture | PM | Whole Stack Architect | Security + relevant domain architect |
| Frontend architecture | PM | Front End Architect | UI UX Expert, Ergonomics Reviewer |
| Data schema / migrations | PM | Data Architect | Security, API Contract Reviewer, Tester |
| Platform / deployment | PM | Platform Architect | Security, Observability Engineer |
| Offline / sync | PM | Offline Architect | Data, API, Security, Tester |
| API contract | PM | API Contract Reviewer | Backend + frontend + Security |
| Application security | PM | Security Auditor | Architecture + implementer + Tester |
| Tenant isolation | PM | Multi-tenant Security | Data Architect + Security Auditor |
| Test strategy & regression | PM | Tester | Implementer + Security where applicable |
| Accessibility / critical UX | PM | Ergonomics Reviewer | UI UX Expert + Tester |
| Product UI design | PM | UI UX Expert | Front End Architect + Ergonomics Reviewer |
| Feature implementation | PM | Domain implementer | Architect before implementation; Tester after |
| Scanner implementation | PM | Scanner Builder | Front End Architect + Security + Tester |
| New collection type | PM | Catalog Designer | Front End Architect + Data/API/Security as relevant |
| Netlify backend | PM | Netlify Backend | Whole Stack + Security + Tester |
| General implementation | PM | Runout Engineer / Front End Developer | Appropriate specialist gates |
| Observability | PM | Observability Engineer | Platform + Security |
| Marketing / GTM | PM | Marketing Manager | Product/UX; no technical gate override |
| Agent/prompt/skill changes | PM | Agent Developer | ADR/governance review when authority changes |
| Milestone completion | **PM** | PM | All mandatory gates must PASS |
| Release authorization | **PM** | PM | Security/Architecture/Tester/UX gates as applicable |

## 4. Specialist veto / blocking authority

### Security Auditor
Blocks completion for changes touching authentication, authorization, user data, payments, storage, caching, external APIs, databases, or other security-sensitive surfaces until threat modelling, negative tests and implementation evidence support PASS.

### Multi-tenant Security
Blocks completion for tenant isolation, membership authorization, tenant-scoped storage and equivalent boundaries until cross-tenant, IDOR and privilege-escalation tests pass.

### Tester
Blocks completion when required automated tests fail, regression evidence is insufficient, or the repository coverage gate is not met. The current project baseline is 70% across the configured metrics.

### API Contract Reviewer
Blocks API-related completion when a change breaks or ambiguously changes request/response contracts, authentication requirements, error semantics, idempotency or compatibility without an approved migration/versioning strategy.

### Data Architect
Blocks schema/migration completion when constraints, isolation, migration safety, rollback/forward-fix or reconciliation evidence is insufficient.

### Platform Architect / Observability Engineer
Can block production readiness when deployment, backup/restore, health, rollback, monitoring or sensitive-data logging requirements are not evidenced.

### Ergonomics Reviewer
Blocks M2 critical UX acceptance when WCAG/accessibility, touch ergonomics, discoverability or critical-flow usability requirements fail. For non-critical UX issues it reports findings to the PM rather than blocking delivery.

### Architecture agents
The relevant architecture agent may block implementation of a design that violates an accepted ADR, creates an unsafe architectural seam, or introduces an unjustified platform dependency. Architecture disagreements are escalated to the Whole Stack Architect; unresolved strategic conflicts go to the PM for a documented decision/ADR.

## 5. Agent lifecycle

Every milestone follows:

```text
PM PLAN
  → architecture/design
  → implementation
  → test/verification
  → security/API/data/UX/operations gates as applicable
  → PM milestone decision
```

A failed gate creates a loop back to the responsible implementer or design authority. The PM owns the coordination and records the decision; the blocking specialist owns the technical verdict.

## 6. Separation of duties

- An implementation agent must not approve its own security or quality gate.
- Security findings are not waived by developers or implementers.
- The PM cannot convert a specialist FAIL into PASS without the specialist re-reviewing evidence.
- Agent Developer cannot unilaterally change the authority model; governance changes require an ADR and PM approval.
- Marketing cannot introduce unvalidated product claims or override engineering/security constraints.

## 7. Required milestone handoff state

The PM must pass at least:

- milestone and objective;
- ticket + parent epic;
- dependencies and entry criteria;
- relevant ADRs;
- files/components/API surfaces;
- security classification;
- expected evidence;
- current gate verdicts;
- branch/PR context.

Each specialist returns a concise verdict, evidence, findings, residual risks and explicit **PASS / FAIL / NOT APPLICABLE** decision where a gate applies.

## 8. Milestone advancement

The PM may advance from M0 → M1 → M2 → M3 → M4 → M5 → M6 only when the current milestone's exit criteria in #355 are satisfied.

Future milestones are planning horizons, not authorization to start work early. The PM re-grooms the next milestone using evidence from the completed milestone.
