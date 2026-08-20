# Agent Runtime v2

Compact operational layer for the governed agent team. It reduces token
consumption while preserving every governance, security, architecture and
quality gate defined in the canonical documents.

## Load order

1. `kernel.md` — compact runtime context. **Load this first for every task.**
2. `routing.md` — deterministic specialist routing + dormant-agent rules + team scope.
3. `handoff.md` — compressed handoff contract + evidence-cache rules.
4. `validation.md` — incremental validation ladder.
5. `state/state.md` — PM milestone state (template in `state/template.md`).
6. `state/ROADMAP.md` + `state/M1.md`…`state/M4.md` — master portfolio state.
7. `state/teams/<team>.md` — per-team checkpoint (persistent teams).

Load the full governance documents **only when needed** (compiling a DAG,
advancing a milestone, or when the kernel is insufficient):

- `docs/agents/responsibility-matrix.md` — canonical authority model.
- `docs/adr/0014-agent-orchestration-and-governance.md` — governance rationale.
- `docs/adr/0018-persistent-multi-team-delivery.md` — persistent team model.
- `.github/skills/agentic-workflow/SKILL.md` — execution protocol (DAG, loops).
- `.github/copilot-instructions.md` — project conventions.
- GitHub #355 — milestone roadmap and exit criteria.

## Single source of truth

| Concern | Canonical source |
|---|---|
| Authority, veto gates, separation of duties | `docs/agents/responsibility-matrix.md` |
| Governance rationale | `docs/adr/0014-agent-orchestration-and-governance.md` |
| Persistent team model (teams, scopes, branch naming) | `docs/adr/0018-persistent-multi-team-delivery.md` |
| Execution protocol (DAG, parallel, loops, milestones) | `.github/skills/agentic-workflow/SKILL.md` |
| Deterministic routing + dormant agents + team scope | `.github/agent-runtime/routing.md` |
| Context budgets, handoff, escalation | `.github/agent-runtime/kernel.md` |
| Evidence reuse | `.github/agent-runtime/handoff.md` |
| Incremental validation | `.github/agent-runtime/validation.md` |
| PM milestone state | `.github/agent-runtime/state/state.md` |
| Master portfolio state | `.github/agent-runtime/state/ROADMAP.md` + `M1.md`…`M4.md` |
| Per-team checkpoint | `.github/agent-runtime/state/teams/<team>.md` |

When a rule appears in more than one place, the canonical source above wins.
Do not duplicate a rule into an agent file or skill that already references the
canonical source — reference it instead.
