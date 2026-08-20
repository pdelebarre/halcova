# Halcova — Project Guidelines

Halcova uses a governed multi-agent delivery model. The **Project Manager is accountable for orchestration, integration and milestone advancement**, while specialist agents retain independent technical authority and blocking gates.

## Canonical governance sources

- `docs/agents/responsibility-matrix.md` — responsibilities, authority and veto gates.
- `docs/adr/0014-agent-orchestration-and-governance.md` — governance rationale.
- `.github/skills/agentic-workflow/SKILL.md` — adaptive execution graph, context efficiency and gate loops.
- GitHub #355 — canonical milestone roadmap and exit criteria.

## Agent Runtime v2 (compact operational entry point)

Load `.github/agent-runtime/kernel.md` first for every task. Load the full
governance documents above only when compiling a DAG, advancing a milestone, or
when the kernel is insufficient. The runtime layer:

- `.github/agent-runtime/kernel.md` — authority, gates, budgets, escalation (load first).
- `.github/agent-runtime/routing.md` — deterministic routing + dormant-agent rules + team scope.
- `.github/agent-runtime/handoff.md` — compressed handoff + evidence-cache rules.
- `.github/agent-runtime/validation.md` — incremental validation ladder.
- `.github/agent-runtime/state/state.md` — PM milestone state (template in `state/template.md`).
- `.github/agent-runtime/state/ROADMAP.md` + `state/M1.md`…`state/M4.md` — master portfolio state.
- `.github/agent-runtime/state/teams/<team>.md` — persistent team checkpoints.

Work runs through **persistent teams** (SECURITY, OFFLINE, COLLECTOR, DATA,
PROVIDERS, AI, GROWTH) under the single PM orchestrator — see
`docs/adr/0018-persistent-multi-team-delivery.md`. One issue = one branch = one
PR (`mN/<team>/<issue>`); human retains merge authority.

## Authority rules

- PM cannot convert a mandatory specialist FAIL into PASS.
- Security Auditor blocks security-sensitive completion; Multi-tenant Security blocks tenant-isolation completion.
- Tester owns the required quality/test verdict.
- Relevant architecture/data/API/platform/offline agents own specialist design gates.
- Ergonomics Reviewer blocks defined critical UX/accessibility gates.
- Implementation agents do not approve their own security or quality gates.
- A milestone advances only after its exit criteria and mandatory specialist gates pass.

## Agent operating protocol

### Scope

- Work **only on the assigned GitHub issue** and its acceptance criteria.
- Every ticket belongs to exactly one parent epic.
- Do not opportunistically fix unrelated issues. Create or request a separate issue when scope expands.
- Do not redefine architecture, security authority, milestone scope, or agent responsibilities without PM direction and the required ADR.

### Branch discipline

- **One issue → one implementation branch → one focused PR.**
- Never create, rename, delete or switch branches unless explicitly instructed by the PM.
- Never work directly on `main` for feature/bug implementation.
- Never share a mutable implementation branch with another agent.
- Keep branches short-lived. If work becomes too large, split it into smaller issues rather than creating a long-lived mega-branch.
- Do not create separate branches merely for architecture review, testing, security review or release validation.
- Review agents should normally review the implementation PR and return evidence; they do not create competing implementation branches.
- Do not merge your own PR. Integration/merge is controlled by the PM.

### Parallel execution

- Independent implementation workstreams may run in parallel **only after** required architecture, domain and shared contracts are sufficiently stable.
- Before parallel work, establish ownership boundaries, dependencies, integration points and required gates.
- If two agents would modify the same contract, schema, migration or ownership boundary, serialize that work or have the PM establish an explicit integration plan first.
- Prefer one branch/worktree per independent implementation issue. When running multiple local agents concurrently, use separate Git worktrees so agents cannot switch or overwrite each other's working tree.
- Do not start downstream agents merely to keep them busy; waiting is preferable to redundant context consumption.

### Implementation discipline

- Keep diffs minimal and reviewable.
- Do not silently change API, data, offline/sync, authentication, authorization, storage or other shared contracts.
- If a required architecture or contract decision is missing, stop and report the blocker rather than inventing a competing design.
- Never bypass tests, security controls or acceptance criteria to make a task appear complete.
- Never commit secrets, credentials, local environment files or private generated data.

## Context and token efficiency

- Start from the issue, acceptance criteria, relevant ADRs and directly affected files.
- Search for symbols and references before reading large files or the whole repository.
- Use the **minimum sufficient context** and expand only when evidence requires it.
- Reference canonical documents rather than copying their full contents into prompts.
- Reuse valid prior evidence when the underlying code and assumptions have not changed.
- Do not repeat investigations unless evidence is stale, contradictory or independent verification is explicitly required.
- Return concise handoffs: status, changed files/surfaces, tests/checks, evidence, risks/blockers and next gate.
- Token optimization never justifies skipping security, architecture, testing, accessibility, release or required evidence.
- If context is insufficient for a reliable conclusion, return `NOT VERIFIED`; never guess PASS.

## Completion contract

Before reporting completion:

1. Verify the issue acceptance criteria.
2. Run the narrowest relevant tests/checks first; expand when failures or risk justify it.
3. Report exactly what changed and what was validated.
4. Report unresolved risks/blockers explicitly.
5. Identify the next required specialist gate, if any.
6. Leave merge/integration decisions to the PM.

## Existing project conventions

- **Frontend:** shared collection flow and catalog configuration must remain consistent across records and books.
- **Item shape:** preserve the canonical normalized item model and kind-specific identifiers.
- **Lookup APIs:** normalize external responses inside `src/api/*`, not views.
- **Auth/security:** never leak access codes or admin credentials; security-sensitive changes require threat modeling, negative security tests and the appropriate security review.
- **PWA/offline:** respect the approved offline-first architecture and sync contracts; do not invent local-vs-server consistency semantics in implementation code.
- **Tickets:** follow existing epic/ticket naming, labels and parent-epic conventions.

## Build & test

```bash
npm install --cache "$TMPDIR/npm-cache"
npm run lint
npm test
npm run test:coverage
npm run build
```

Run only the checks relevant to the change first, then the full required suite when the issue/milestone requires it.

## Agent roles

Project Manager: orchestration/integration/milestones. Architecture: Whole Stack, Front End, Data, Platform, Offline, API Contract. Implementation: Front End Developer, Runout Engineer, Catalog Designer, Scanner Builder, Netlify Backend, Sync Engineer. Gates: Tester, Security Auditor, Multi-tenant Security, Ergonomics Reviewer, Release Validator. Design/operations: UI UX Expert, Observability Engineer. Agent system: Agent Developer. Product/GTM: Marketing Manager.

The canonical detailed authority model remains in `docs/agents/responsibility-matrix.md` and `.github/skills/agentic-workflow/SKILL.md`.