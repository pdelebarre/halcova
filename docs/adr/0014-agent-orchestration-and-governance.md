# ADR-0014: Agent orchestration and governance

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related roadmap:** #354, #355
- **Related documentation:** `docs/agents/responsibility-matrix.md`

## Context

Halcova uses a team of specialized AI agents for product management, architecture, development, testing, security, UX, operations, marketing and agent-system maintenance. Without an explicit authority model, autonomous agents can duplicate work, approve their own changes, bypass specialist review, or advance milestones based on implementation rather than evidence.

The Project Manager is intended to orchestrate the team and milestones, but specialist agents must retain independent authority in their domains.

## Decision

Adopt a **PM-orchestrated, specialist-gated delivery model**.

### Accountability

The Project Manager is accountable for:

- product scope and priority;
- milestone sequencing;
- delegation and handoffs;
- dependency management;
- risk escalation;
- milestone completion decisions;
- release coordination.

The PM does not implement application code and cannot override mandatory specialist gates.

### Specialist authority

- **Whole Stack Architect:** end-to-end architecture authority.
- **Front End Architect:** frontend architecture authority.
- **Data Architect:** schema, migration and data-isolation authority.
- **Platform Architect:** deployment and operational-topology authority.
- **Offline Architect:** offline/sync architecture authority.
- **API Contract Reviewer:** API contract and compatibility authority.
- **Security Auditor:** blocking application-security gate.
- **Multi-tenant Security:** blocking tenant-isolation gate.
- **Tester:** blocking test/coverage quality gate.
- **Ergonomics Reviewer:** blocking critical UX/accessibility gate for defined user journeys.
- **UI UX Expert:** design authority and UX/a11y specialist; critical acceptance is independently reviewed where required.
- **Observability Engineer:** operational evidence authority for metrics, logs and diagnostics.
- **Domain implementers:** responsible for implementation, not independent approval of their own work.
- **Agent Developer:** owns agent/prompt/skill implementation; governance changes require this ADR to be updated and reviewed.
- **Marketing Manager:** owns GTM and messaging; cannot override product truth, security or engineering gates.

## Gate rule

A milestone or ticket cannot be declared done when a mandatory gate is FAIL.

The PM may coordinate remediation and resolve scope conflicts, but a specialist must re-review the new evidence before a failed gate becomes PASS.

There is deliberate separation of duties:

```text
PM → plans and orchestrates
Architect → designs/reviews
Developer → implements
Tester → verifies
Security → independently gates security
UX → independently gates critical experience
PM → accepts milestone only after required gates pass
```

## Milestone governance

Each milestone follows:

1. **Plan** — PM establishes objective, scope, non-goals, dependencies and exit criteria.
2. **Design** — relevant architecture/domain agents produce decisions and ADRs.
3. **Implement** — implementation agents execute approved work.
4. **Verify** — Tester and relevant specialist reviewers produce evidence.
5. **Gate** — mandatory security, architecture, data/API, UX and operational gates are applied.
6. **Decide** — PM records PASS/FAIL, residual risk and whether the milestone may advance.

A failed gate loops work back to the responsible implementer or design authority.

## Evidence requirements

Specialist PASS decisions require evidence appropriate to the role. Security cannot be approved from documentation alone; testing cannot be approved from a code review alone; migration cannot be approved without reconciliation/rollback evidence; and critical UX cannot be approved without evaluating the actual user journey.

## Consequences

### Positive

- clear separation of duties;
- reduced autonomous-agent drift;
- independent security and quality controls;
- deterministic milestone advancement;
- auditable decisions and residual risks;
- specialist expertise remains reusable across milestones.

### Negative

- additional handoffs and review latency;
- PM must actively manage blocked gates;
- specialist disagreements require escalation and sometimes ADR updates.

## Alternatives rejected

### PM as absolute authority
Rejected because it allows delivery pressure to override security, architecture or quality evidence.

### Every agent as an equal peer with no accountable owner
Rejected because responsibility becomes ambiguous and milestone advancement becomes inconsistent.

### One generalist agent performing all work
Rejected because it weakens separation of duties and specialist assurance.

## Governance change

Changes to the authority hierarchy, blocking gates or PM accountability require an ADR update and corresponding changes to `docs/agents/responsibility-matrix.md`, the agentic workflow skill and affected agent instructions.
