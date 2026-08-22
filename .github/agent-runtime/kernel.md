# Agent Runtime v2 — Context Kernel

Compact canonical runtime context. Every agent loads this file first. Load
**only the sections relevant to the current issue** — do not load all state files
every turn.

## Token cost rules (mandatory, all agents)

Every token costs money. Follow these rules on every turn to keep cost in check:

- **Load state files lazily** — read only the milestone state file(s) and team
  checkpoint(s) relevant to the current issue. Do NOT read all M1–M4, all team
  checkpoints, ROADMAP.md, or README.md every turn. If a turn touches M2 and
  SECURITY, read only `M2.md` + `security.md`.
- **Batch gates into one task per PR** — when a PR needs independent review,
  delegate ONE batch task (e.g. "review PR #123 against all applicable gates")
  instead of one task per gate. The gate agent returns per-gate verdicts in a
  single handoff. This eliminates 2–4 task-call overhead per PR.
- **Reference, don't copy** — when delegating to a team or gate, reference the
  issue/ADR/PR by URL. Do not paste full source files, full logs, or entire
  ADRs. Paste only the specific finding or the 3–5 lines that matter.
- **Strip expand-only sections** — do not include the `Expand when needed` list,
  context budgets table, or full gate-trigger table on every turn. Only load them
  when the issue actually triggers one of those gates.
- **Reuse prior evidence** — on a pure-rebase (no logic change), reuse prior gate
  evidence per handoff.md rules. Do not re-run gates that already passed.

## 1. PM authority

- The **Project Manager is the sole orchestrator** and accountable delivery owner.
- PM owns scope, priority, sequencing, delegation, dependencies, risk and
  milestone advancement.
- PM does **not** implement application code.
- PM cannot convert a mandatory specialist FAIL into PASS.

## 2. Responsibility rules

- One accountable role per capability; specialist authority is independent.
- Implementation agents do not approve their own security or quality gates.
- One issue → one implementation branch → one focused PR.
- Branch naming: `mN/<team>/<issue>`. Never `main` for feature work.

## 3. Mandatory approval gates (blocking — trigger-table expands only on request)

Gates cannot be waived. A failed gate loops work back to the implementer.
Gate list: Security Auditor, Multi-tenant Security, Tester, Release Validator,
Architecture (Whole Stack / Front End / Data / Platform / Offline / API),
Ergonomics Reviewer. Trigger conditions per `routing.md`.

## 4. Evidence requirements

- PASS requires execution evidence, not documentation alone.
- Security cannot be approved from docs; testing cannot from code review;
  migration cannot without reconciliation/rollback; UX cannot without journey
  evaluation. If insufficient evidence, return `NOT VERIFIED`.

## 5. Pre-submit verification bar (mandatory, all teams — expand on request)

P1–P8 pre-submit checks per `routing.md` and `LESSONS_LEARNED.md`. Self-verify
with adversarial negatives, real-env execution, and ≥70% coverage on ALL changed
files including new/async modules and deployable directories — BEFORE raising a
PR. On gate FAIL, sweep the defect class in one pass (still independently
re-gated; the sweep does not substitute for re-verification).

## 6. Escalation rules

A failed gate loops back to the implementer. Architecture disagreements escalate
to the Whole Stack Architect. Strategic conflicts require a documented PM
decision / ADR. Security and tenant-isolation verdicts cannot be waived.

## Expand when needed

Load these only when the kernel is insufficient for the task — do NOT load them
by default:
- `docs/agents/responsibility-matrix.md` — full authority model
- `docs/adr/0014-agent-orchestration-and-governance.md` — governance rationale
- `docs/adr/0018-persistent-multi-team-delivery.md` — persistent team model
- `.github/skills/agentic-workflow/SKILL.md` — execution protocol
- `.github/copilot-instructions.md` — project conventions
- `LESSONS_LEARNED.md` — anti-pattern log; source of §5 rules