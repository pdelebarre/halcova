# Agent Runtime v2 — Context Kernel

Compact canonical runtime context. Every agent loads this file first. Load the
full governance documents only when needed (see "Expand when needed").

## 1. PM authority

- The **Project Manager is the sole orchestrator** and accountable delivery owner.
- PM owns scope, priority, sequencing, delegation, dependencies, risk and
  milestone advancement.
- PM does not implement application code.
- PM cannot convert a mandatory specialist FAIL into PASS.

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
- Do not merge your own PR; integration is controlled by the PM.

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

## Expand when needed

Load these only when the kernel is insufficient for the task:

- `docs/agents/responsibility-matrix.md` — canonical authority model.
- `docs/adr/0014-agent-orchestration-and-governance.md` — rationale.
- `.github/skills/agentic-workflow/SKILL.md` — execution protocol.
- `.github/copilot-instructions.md` — project conventions.
- GitHub #355 — milestone roadmap and exit criteria.
