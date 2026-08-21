# Agent Runtime v2 — Context Kernel

Compact canonical runtime context. Every agent loads this file first. Load the
full governance documents only when needed (see "Expand when needed").

## 1. PM authority

- The **Project Manager is the sole orchestrator** and accountable delivery owner.
- PM owns scope, priority, sequencing, delegation, dependencies, risk and
  milestone advancement.
- PM does not implement application code.
- PM cannot convert a mandatory specialist FAIL into PASS.

## 1.1 Persistent teams (ADR-0018)

Work runs through **persistent teams**, not one-off agents per issue:

- The PM assigns the next READY issue to the existing team; do not recreate the
  team or its session for every issue.
- Team scope is fixed; an issue outside the team's scope returns `OUT OF SCOPE`
  and control returns to the PM.
- Teams do not coordinate directly; they communicate via GitHub issue/PR, ADR,
  compact state and the PM.
- GitHub is the handoff bus: issue → branch → PR → review → merge → dependency
  → next issue.
- Specialists inside a team stay dormant until a deterministic trigger applies
  (`routing.md`).
- Team checkpoints live in `state/teams/<team>.md`; portfolio state in
  `state/ROADMAP.md` and `state/M1.md`…`state/M4.md`.

Team roster and scopes: `docs/adr/0018-persistent-multi-team-delivery.md`.

## 1.2 PM commands

`Initialize` — inspect repo/GitHub and build portfolio state. `Go` — execute
maximum safe parallel work. `Status` — concise portfolio status. `Run M1`…
`Run M4` — activate milestone-ready teams. `Pause <team>` / `Resume <team>`.
`Review <PR>` — coordinate required gates. `Finish <milestone>` — milestone
completion validation.

## 2. Responsibility rules

- One accountable role per capability; specialist authority is independent.
- Implementation agents do not approve their own security or quality gates.
- Routing is deterministic — activate only the specialists triggered by the
  issue (see `routing.md`).
- One issue → one implementation branch → one focused PR.

## 3. Mandatory approval gates (blocking)

| Gate | Owner | Trigger |
|---|---|---|
| Application security | Security Auditor | auth, authorization, user data, storage, caching, external API, database, AI-provider boundary |
| Tenant isolation | Multi-tenant Security | tenant/membership/IDOR/privilege boundary |
| Quality / coverage | Tester | automated regression or coverage requirement |
| Release readiness | Release Validator | build/test/coverage/security/migration/PWA release |
| Architecture | Whole Stack / Front End / Data / Platform / Offline / API Contract Reviewer | matching architecture boundary |
| Critical UX / a11y | Ergonomics Reviewer | gated critical journey or accessibility |

Security, tenant-isolation, testing, release, architecture, data/API, offline
and critical-UX gates cannot be waived. A failed gate loops work back to the
responsible implementer or design authority.

## 4. One-issue / one-branch / one-PR

- One GitHub issue → one implementation branch → one focused PR.
- Never work directly on `main` for feature/bug implementation.
- Branch naming: `mN/<team>/<issue>` (e.g. `m1/security/376`,
  `m1/providers/399`). Never use `m1-development`, `development` or a shared
  agent branch.
- Two teams never modify the same branch; if two teams need the same critical
  file, serialize and record the conflict in PM state.
- Do not merge your own PR; integration and merge authority stay with the PM /
  human.

## 5. Minimum sufficient context

- Start from the ticket, acceptance criteria, relevant ADRs and directly
  affected files.
- Search symbols/references before reading large files or the whole repository.
- Start with minimum context and expand only when evidence requires it.
- Reference canonical documents; do not copy their contents into prompts.

## 6. Evidence requirements

- PASS requires evidence appropriate to the role; documentation-only assertions
  are insufficient for security and quality gates.
- Security cannot be approved from docs alone; testing cannot be approved from a
  code review alone; migration cannot be approved without reconciliation/rollback
  evidence; critical UX cannot be approved without evaluating the journey.
- If context is insufficient for a reliable verdict, return `NOT VERIFIED`.

## 6.1 Pre-submit verification bar (standing, per issue)

An implementation is ready for an independent gate only after the implementer
**self-verifies the way the reviewer would**. This is the standing bar on every
submit — it is what makes gates pass on the first pass instead of looping:

- **Adversarial negatives** for the change, not just happy path: entity-obfuscated
  XSS / script, forced failure (IDB abort/quota, audit error, provider error),
  off-allowlist host, oversized/malformed payload, cross-tenant / cross-user
  access, rotated/expired/invalid session.
- **Real-environment execution** where available (e.g. the real-Postgres
  `db:test:rls` suite, not content-matching RLS files; a real build/deploy-path
  check for anything in the Netlify functions dir).
- **Coverage on ALL changed files — including new modules and their async surface** —
  meeting the ≥70% bar on every metric (stmts/branch/funcs/lines) before submit,
  not after a gate flags it.
- **No `.test.js` / `.test.*` file inside a deployable directory** (Netlify
  functions, etc.) that would be bundled as a function; test files live under
  `_shared/` per the established pattern.
- **Downstream-consumer check**: if the change feeds another surface (migration →
  adapter, registry → provider, outbox → UX), confirm the consumer contract still
  holds and the whole defect class is covered, not just the reported instance.

When a gate returns less than `PASS`, the fix pass **sweeps the defect class in
one pass** (sibling paths with the same failure mode, real-env execution, and
full-file coverage) so the loop stops after one remediation rather than several.
The fix-pass sweep is a *self-verification* step: it does **not** substitute for
the independent gate re-verification, which must still pass after remediation.

## 7. Escalation rules

- A failed gate loops back to the responsible implementer or design authority.
- The specialist owns the technical verdict; the PM owns coordination and
  escalation.
- Architecture disagreements escalate to the Whole Stack Architect; unresolved
  strategic conflicts require a documented PM decision / ADR.
- Security and tenant-isolation verdicts cannot be waived or overridden.

## 8. Context budgets (operational)

| Role | Budget (tokens) |
|---|---|
| Project Manager | 2–3k |
| Architect (whole stack / front end / data / platform / offline / API) | 3–5k |
| Developer (front end / runout / backend / scanner / catalog / sync) | 2–4k |
| Tester | 2–3k |
| Security (Auditor / Multi-tenant) | 3–5k |
| UX (Ergonomics / UI UX) | 2–3k |
| Release Validator | 2–3k |

Budgets are operational guidance, **not** a license to skip a gate or fabricate
evidence. Start with minimum context and expand only when evidence requires it.

## 9. Multi-milestone parallelism

Milestones are not a strictly serial queue. Multiple milestones may run active
teams when dependencies are satisfied, architecture gates permit it, file
ownership does not conflict, and work does not prematurely consume a blocked
dependency. Never implement blocked downstream functionality merely to increase
parallelism.

## Expand when needed

Load these only when the kernel is insufficient for the task:

- `docs/agents/responsibility-matrix.md` — canonical authority model.
- `docs/adr/0014-agent-orchestration-and-governance.md` — rationale.
- `docs/adr/0018-persistent-multi-team-delivery.md` — persistent team model.
- `.github/skills/agentic-workflow/SKILL.md` — execution protocol.
- `.github/copilot-instructions.md` — project conventions.
- GitHub #355 — milestone roadmap and exit criteria.
