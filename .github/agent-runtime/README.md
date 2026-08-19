# Agent Runtime v2

Compact operational layer for the governed agent team. It reduces token
consumption while preserving every governance, security, architecture and
quality gate defined in the canonical documents.

## Load order

1. `kernel.md` — compact runtime context. **Load this first for every task.**
2. `routing.md` — deterministic specialist routing + dormant-agent rules.
3. `handoff.md` — compressed handoff contract + evidence-cache rules.
4. `validation.md` — incremental validation ladder.
5. `state/state.md` — PM milestone state (template in `state/template.md`).

Load the full governance documents **only when needed** (compiling a DAG,
advancing a milestone, or when the kernel is insufficient):

- `docs/agents/responsibility-matrix.md` — canonical authority model.
- `docs/adr/0014-agent-orchestration-and-governance.md` — governance rationale.
- `.github/skills/agentic-workflow/SKILL.md` — execution protocol (DAG, loops).
- `.github/copilot-instructions.md` — project conventions.
- GitHub #355 — milestone roadmap and exit criteria.

## Single source of truth

| Concern | Canonical source |
|---|---|
| Authority, veto gates, separation of duties | `docs/agents/responsibility-matrix.md` |
| Governance rationale | `docs/adr/0014-agent-orchestration-and-governance.md` |
| Execution protocol (DAG, parallel, loops, milestones) | `.github/skills/agentic-workflow/SKILL.md` |
| Deterministic routing + dormant agents | `.github/agent-runtime/routing.md` |
| Context budgets, handoff, escalation | `.github/agent-runtime/kernel.md` |
| Evidence reuse | `.github/agent-runtime/handoff.md` |
| Incremental validation | `.github/agent-runtime/validation.md` |
| PM milestone state | `.github/agent-runtime/state/state.md` |

When a rule appears in more than one place, the canonical source above wins.
Do not duplicate a rule into an agent file or skill that already references the
canonical source — reference it instead.
