---
name: agentic-workflow
description: 'Run Halcova as a governed agent graph: the Project Manager orchestrates, specialist agents own domain decisions, mandatory security/quality gates can block completion, failed gates loop back to implementation, parallel work is used safely, and agents minimize unnecessary context/token consumption. Use for milestone execution, feature planning, agent DAGs, handoffs, release gates, governance, orchestration, or context-efficient execution.'
---
# Agentic Workflow — Governed Delivery Graph

Halcova's agents are nodes, specialist handoffs are edges, shared task context is state, and the Project Manager is the accountable orchestrator. The canonical authority model is `docs/agents/responsibility-matrix.md`; the rationale is ADR-0014.

## Governance rules

- **PM is accountable for delivery**, scope, sequencing, delegation, risk and milestone advancement.
- **PM is not a technical veto authority.** It cannot convert a mandatory specialist FAIL into PASS.
- Security, tenant-isolation, required testing, API/data, architecture and defined critical UX gates are independently controlled by specialist agents.
- An implementation agent must not approve its own security or quality gate.
- A failed gate loops work back to the responsible implementer or design authority.
- Future milestones are not automatically authorized because capacity exists; advance only after the current milestone passes its exit gates in #355.
- Governance changes affecting authority, veto rights, separation of duties, or milestone advancement require an ADR and corresponding update to the responsibility matrix and this skill.
- **Token/context efficiency is a delivery constraint, not a quality shortcut.** Agents MUST minimize unnecessary context while preserving correctness, security, architecture, testing and required evidence.

## Agent inventory and authority

The following is the canonical operational roster. Names must match the repository agent definitions; do not invent substitute roles.

| Agent | Primary responsibility | Authority / gate |
|---|---|---|
| **Project Manager** | Scope, prioritisation, sequencing, delegation, dependencies, risk, milestone decisions | **Accountable for delivery; cannot override mandatory specialist FAIL** |
| **Whole Stack Architect** | End-to-end architecture and cross-layer design | Architecture gate |
| **Front End Architect** | React/frontend architecture and component boundaries | Frontend architecture gate |
| **Data Architect** | Data model, schema, migrations, isolation and reconciliation | Data/migration gate |
| **Platform Architect** | Deployment, infrastructure and operational topology | Platform/operational gate |
| **Offline Architect** | Offline-first architecture, consistency and sync model | Offline/sync architecture gate |
| **API Contract Reviewer** | API contracts, compatibility, errors and idempotency | API contract gate |
| **Front End Developer** | Frontend implementation | No authority over own quality/security gate |
| **Runout Engineer** | Cross-app implementation, catalog/scanner/PWA integration | No authority over own quality/security gate |
| **Catalog Designer** | Collection-kind/domain design | Domain design authority within assigned scope; architecture/security still govern |
| **Scanner Builder** | Camera/barcode/scanner implementation | No authority over own security/quality gate |
| **Netlify Backend** | Netlify functions, Blobs, auth/admin/PWA backend implementation | No authority over own security/quality gate |
| **Sync Engineer** | IndexedDB persistence, mutation queues, push/pull sync, retries | Implementation authority only; Offline Architect owns architecture |
| **Tester** | Automated tests, regression, coverage and QA evidence | **Blocking quality gate** |
| **Security Auditor** | Application security, threat modelling and negative security tests | **Blocking security gate** |
| **Multi-tenant Security** | Tenant isolation, membership, IDOR and privilege boundaries | **Blocking tenant-security gate** |
| **Ergonomics Reviewer** | Accessibility, mobile ergonomics, discoverability and critical UX review | **Blocking gate for explicitly critical UX** |
| **UI UX Expert** | Product UI/UX design and Figma/design-system work | Design authority/input; critical UX independently reviewed by Ergonomics Reviewer |
| **Observability Engineer** | Logging, metrics, diagnostics and operational evidence | Operational evidence authority; Platform Architect governs topology |
| **Release Validator** | Build, tests, coverage, security evidence, migrations and release/PWA readiness | **Blocking release-readiness gate when assigned** |
| **Agent Developer** | Agents, prompts, skills and agent-system implementation | Implementation authority only; governance changes require ADR/PM approval |
| **Marketing Manager** | Positioning, messaging, GTM and product communication | Product/GTM input; no technical or security override |

### Authority hierarchy

```text
Project Manager
  │
  ├── accountable for delivery, scope, sequencing and milestone advancement
  │
  ├── Architecture authority
  │     ├── Whole Stack Architect
  │     ├── Front End Architect
  │     ├── Data Architect
  │     ├── Platform Architect
  │     ├── Offline Architect
  │     └── API Contract Reviewer
  │
  ├── Security authority
  │     ├── Security Auditor
  │     └── Multi-tenant Security
  │
  ├── Quality / release authority
  │     ├── Tester
  │     └── Release Validator
  │
  ├── Experience authority
  │     ├── Ergonomics Reviewer
  │     └── UI UX Expert
  │
  ├── Delivery specialists
  │     ├── Front End Developer
  │     ├── Runout Engineer
  │     ├── Catalog Designer
  │     ├── Scanner Builder
  │     ├── Netlify Backend
  │     └── Sync Engineer
  │
  ├── Operations evidence
  │     └── Observability Engineer
  │
  ├── Agent-system governance
  │     └── Agent Developer
  │
  └── Product / GTM
        └── Marketing Manager
```

### Non-overridable rule

The PM may resolve scope, sequencing and trade-off conflicts, but **may not declare a milestone complete when a mandatory security, architecture, testing, API/data, release, or explicitly critical UX gate is FAIL**.

A specialist must provide evidence for PASS. Documentation-only assertions are insufficient for security and quality gates.

## State passed on every handoff

At minimum pass:
- goal and milestone;
- ticket + parent epic;
- branch/PR context;
- files/components/API surfaces;
- dependencies and entry criteria;
- relevant ADRs;
- security classification;
- expected acceptance/evidence;
- previous gate verdicts and residual risks.

**Handoff rule:** pass the minimum sufficient state, not the entire prior conversation or repository context. Link/reference canonical documents instead of copying them into prompts where possible.

## Context and token efficiency protocol

Agents MUST optimize for **minimum sufficient context**. Token efficiency must never weaken security, correctness, architecture, testing, accessibility or required evidence.

### Context acquisition

- Start with the ticket, acceptance criteria, relevant parent epic and required ADRs.
- Inspect targeted files, symbols, directories and tests before opening large files or the entire repository.
- Use search to locate relevant symbols/references before reading broad code areas.
- Read only the sections needed for the current decision or implementation.
- Do not preload every agent definition, ADR, issue or source file when the task does not require it.
- Expand context progressively when evidence shows that more is needed.
- If required context is genuinely missing, request or retrieve it rather than guessing.

### Context reuse

- Treat `docs/agents/responsibility-matrix.md`, ADRs and canonical backlog items as sources of truth; reference them instead of duplicating their contents.
- Reuse valid prior gate results and test evidence when the underlying code and assumptions have not changed.
- Do not repeat an investigation already completed by another agent unless the evidence is stale, contradictory or specifically requires independent verification.
- PM state should be a compact execution record, not a transcript of every agent interaction.

### Handoff compression

Every agent handoff should prefer a structured concise summary containing:

```text
Decision / status:
Files / surfaces changed:
Dependencies:
Evidence:
Open risks / blockers:
Next action:
```

Do not paste large source files, full logs or complete prior conversations into downstream prompts when a concise summary plus file references is sufficient.

### Parallel-agent budget

Parallelism must not multiply redundant investigation.

- Launch an agent only when its work is unblocked and materially useful.
- Do not have multiple agents independently answer the same question without a defined reason for independent review.
- Avoid starting downstream agents merely to keep them busy; waiting is preferable to consuming context on blocked work.
- Prefer one authoritative architecture decision over several duplicate design explorations.
- For expensive validation, run the narrowest relevant checks first, then expand only if failures or risk justify it.

### Output discipline

Agents should return concise, evidence-oriented results rather than long narratives.

A completed implementation handoff should normally contain:

- outcome;
- changed files/components;
- tests/checks run;
- evidence/results;
- unresolved risks;
- next required gate.

Do not reproduce code or logs in the handoff unless the exact excerpt is required to explain a defect or decision.

### Safety boundary

Token optimization is **never** a reason to skip:

- security review required by the matrix;
- tenant-isolation validation;
- architecture decisions required by an ADR;
- mandatory tests or coverage;
- required accessibility/ergonomics review;
- release validation;
- evidence needed to substantiate a PASS.

If context is insufficient for a reliable gate decision, the agent MUST obtain more context or return `NOT VERIFIED`; it must not infer PASS to save tokens.

## Parallel execution protocol

The PM MUST identify independent workstreams and execute them concurrently when dependencies permit. Parallelism is a delivery optimization, not a relaxation of governance.

### Before parallel execution

1. Establish required architecture and domain decisions.
2. Establish shared API, domain, persistence, sync and error contracts.
3. Identify file/component ownership boundaries.
4. Identify dependencies and integration points.
5. Create one branch per implementation workstream.
6. Define required validation gates for each workstream.

### Parallelism is permitted only when

- prerequisite architecture decisions are resolved;
- shared contracts are stable enough for implementation;
- workstreams have independent ownership boundaries or explicit coordination points;
- no two agents are concurrently editing the same ownership boundary without a deliberate integration plan;
- security boundaries are understood;
- integration and validation responsibilities are explicit.

### Parallelism is prohibited when

- architecture, data, API or synchronization semantics are unresolved;
- two agents would independently define the same contract or domain model;
- a change has an unresolved security boundary;
- one workstream depends on behavior that another workstream has not yet defined;
- parallel work would create unsafe concurrent migrations or incompatible schema/API changes.

### Branch and PR isolation

For parallel implementation:

- one implementation workstream → one branch;
- one branch → one focused PR where practical;
- implementation agents do not share a mutable feature branch;
- the PM owns integration ordering;
- merge conflicts or semantic contract conflicts return to the relevant architecture/implementation owners rather than being silently resolved by an unrelated agent.

### Workstream ownership record

Every parallel workstream should have:

- owner agent;
- branch;
- files/components/API surfaces owned;
- dependencies;
- consumers;
- integration point;
- required validation agents;
- expected evidence.

Example:

```text
M2-Offline-Storage
Owner: Sync Engineer
Architecture: Offline Architect
Branch: agent/m2-offline-storage
Depends on: #152, #159
Owns: storage/sync modules
Consumed by: Front End Developer, Scanner Builder
Validation: Tester, Security Auditor
```

### Parallel completion model

The PM should maintain work in states such as:

```text
READY → IN PROGRESS → WAITING → READY FOR REVIEW → VALIDATED → INTEGRATED → DONE
```

Independent work may occupy these states concurrently. The PM must avoid unnecessary serialization while preserving dependency order and specialist gates.

### Milestone versus workstream sequencing

**Milestones remain sequential:**

`M0 → M1 → M2 → M3 → M4 → M5 → M6`

**Work inside a milestone may be highly parallel:**

```text
M2
├── Collector UI
├── Scanner
├── Offline storage
├── Search
└── Backend/API
      ↓
  integration + validation
      ↓
  milestone gate
```

Do not start a later milestone merely because independent work remains in the current milestone. Strategic progression remains gate-driven.

## Canonical execution graph

```mermaid
graph TD
  A[Request / Milestone] --> B[PM: PLAN + DAG + branch/workstream ownership]
  B --> C[Architecture / Domain / Contract Design]
  C --> D1[Parallel Workstream A]
  C --> D2[Parallel Workstream B]
  C --> D3[Parallel Workstream C]
  D1 --> E[Integration]
  D2 --> E
  D3 --> E
  E --> F[Tester]
  F --> G{Tests / coverage PASS?}
  G -- no --> D1
  G -- yes --> H{Specialist gates required?}
  H -- security --> I[Security Auditor]
  H -- tenant --> J[Multi-tenant Security]
  H -- API/data --> K[API/Data Architect Review]
  H -- UX --> L[Ergonomics / UI UX Review]
  H -- operations --> M[Platform / Observability Review]
  H -- release --> N[Release Validator]
  H -- none --> O[PM Gate]
  I --> P{All required gates PASS?}
  J --> P
  K --> P
  L --> P
  M --> P
  N --> P
  P -- no --> D1
  P -- yes --> O
  O --> Q{Milestone exit criteria PASS?}
  Q -- no --> B
  Q -- yes --> R[PM: close evidence + authorize next milestone]
```

## Mandatory gates

### Security
Changes touching auth, authorization, user data, payments, storage, caching, external APIs or databases require `Security Auditor`. Tenant-isolation changes also require `Multi-tenant Security`. Threat modelling and negative tests are mandatory evidence.

### Testing
`Tester` owns the quality verdict. The configured 70% coverage threshold must pass. Required regression tests must pass before completion.

### Architecture
Relevant architecture agents review before implementation where an architecture boundary changes. Accepted ADRs are constraints unless explicitly superseded by a new ADR.

### UX
For M2 critical journeys and other explicitly gated user experiences, `Ergonomics Reviewer` provides the acceptance verdict. Accessibility and mobile ergonomics are not optional polish.

### API/data/operations
API compatibility, migration safety, rollback, backup/restore, observability and operational readiness are gated when applicable.

### Release
`Release Validator` validates the release evidence bundle when assigned. It does not replace Security Auditor, Tester or Architecture authority; it verifies that their required evidence exists and that build/test/coverage/migration/PWA readiness checks pass.

## Separation of duties

- An implementation agent must not approve its own security or quality gate.
- `Agent Developer` cannot unilaterally redefine agent authority or veto rights.
- `Release Validator` cannot waive a failed specialist gate.
- `Marketing Manager` cannot override security, architecture, quality or accessibility constraints.
- The PM cannot convert a specialist FAIL into PASS without the specialist re-reviewing new evidence.

## Loops

- Security FAIL → remediate → Security re-review.
- Tenant-security FAIL → remediate → Multi-tenant Security re-review.
- Test/coverage FAIL → implementer/tester loop.
- Architecture FAIL → design/implementation loop.
- API/data FAIL → contract/data loop.
- UX FAIL → design/implementation loop.
- Release validation FAIL → remediate evidence/implementation → Release Validator re-review.
- Build/lint FAIL → implementer loop.

No gate may be silently waived.

## Milestone protocol

For each milestone from #355:

1. PM verifies entry criteria and scope.
2. PM decomposes work and assigns agents using the responsibility matrix.
3. PM builds a dependency DAG and identifies parallel workstreams.
4. Architecture/domain/contract agents produce required decisions before dependent parallel implementation begins.
5. PM establishes branch and ownership boundaries for parallel work.
6. Implementers execute independent workstreams concurrently where permitted.
7. PM coordinates integration at explicit contract boundaries.
8. Tester and specialist gates collect evidence.
9. Release Validator verifies release readiness when applicable.
10. PM records PASS/HOLD/FAIL and residual risk.
11. Only PASS authorizes the next milestone; the next milestone is re-groomed using evidence from the completed one.

## Checklist

- [ ] Governance docs loaded.
- [ ] PM owns plan and milestone accountability.
- [ ] Specialist authority identified.
- [ ] No agent approves its own work where an independent gate is required.
- [ ] State passed across every handoff.
- [ ] Context is limited to the minimum sufficient information.
- [ ] Canonical documents are referenced rather than unnecessarily copied.
- [ ] No redundant investigations or validations are consuming context.
- [ ] Architecture/contracts established before dependent parallel work.
- [ ] Parallel workstreams have clear ownership and branches.
- [ ] No unsafe shared ownership or unresolved semantic contract conflicts.
- [ ] Security gate applied whenever required.
- [ ] Required architecture/data/API/UX/quality gates identified.
- [ ] Required specialist gates PASS.
- [ ] Release Validator PASS when release readiness is in scope.
- [ ] `npm run lint`, `npm test`, `npm run test:coverage`, `npm run build` pass when applicable.
- [ ] Evidence and residual risks recorded.
- [ ] PM advances only after milestone exit criteria PASS.
