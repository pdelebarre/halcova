# Agent Runtime v2 — Context Kernel

Compact canonical runtime context. Every agent loads this file first. Load the
full governance documents only when needed (see "Expand when needed").

## VELOCITY (updated weekly by PM)

| Metric | Value |
|---|---|
| Issues closed this week (7-day rolling) | 20 |
| Rolling 7-day average | 20 issues/week |
| P0/P1 share of closed issues | ~75 % |
| Open backlog | 93 issues |
| Estimated weeks to clear P0/P1 | ~4–5 weeks |
| Pace alert threshold | < 10 issues/week → PM escalates |
| Unplanned tickets spawned by remediation loops | track weekly |

> PACE ALERT fires when rolling 7-day velocity drops below 10 issues/week OR
> when remediation-spawned tickets (RETRO/SEC follow-ups) exceed 30 % of
> closed issues in the same week.

---

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

## 6.1 Pre-submit verification bar (mandatory, all teams)

These checks must pass before any PR is raised. Failures are hard blocks.

| # | Check | Owner |
|---|---|---|
| P1 | No `*.test.js` / `*.spec.js` inside `netlify/functions/` root | Front End Dev / Netlify Backend |
| P2 | SSRF regression suite re-run for any PR touching an external API proxy | Security Auditor |
| P3 | Security gate verdict < 48 h old (or re-run if surface changed) | Security Auditor |
| P4 | No shared branch between two active teams | PM |
| P5 | No self-approval of security or tenant-isolation gates | PM / Security |
| P6 | Migration rollback script present for any schema change | Data Architect |
| P7 | `LESSONS_LEARNED.md` consulted for patterns matching this ticket's domain | All implementers |
| P8 | New import from `netlify/functions/_shared/` verified against target's exports — unit-test mocking can hide missing exports | Front End Dev / Netlify Backend |

> Rules are sourced from `LESSONS_LEARNED.md`. When a RETRO ticket is closed,
> the resolved rule is promoted here by the Agent Developer.


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
- `LESSONS_LEARNED.md` — append-only anti-pattern log; source of RETRO tickets and §6.1 rules.

