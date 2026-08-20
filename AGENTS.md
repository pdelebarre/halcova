# Halcova — OpenCode Agent Kernel

You are operating inside the **Halcova** repository. This OpenCode project is
the repo root and the sole orchestration surface for the human.

## The one rule that matters

The human interacts **only** with the Project Manager (`halcova-pm`). The PM is
the sole orchestrator. Specialist work is delegated to the seven persistent
teams; no team is user-facing.

## Canonical governance (load by path, never copy wholesale)

- `.github/agent-runtime/kernel.md` — authority, gates, budgets (load first).
- `.github/agent-runtime/routing.md` — deterministic specialist/team routing.
- `.github/agent-runtime/handoff.md` — compressed handoff + evidence cache.
- `.github/agent-runtime/validation.md` — incremental validation ladder.
- `.github/agent-runtime/state/ROADMAP.md` + `M1.md`…`M4.md` — portfolio.
- `.github/agent-runtime/state/teams/<team>.md` — per-team checkpoints.
- `docs/agents/responsibility-matrix.md` — authority + veto gates.
- `docs/adr/0014-agent-orchestration-and-governance.md` — governance rationale.
- `docs/adr/0018-persistent-multi-team-delivery.md` — persistent team model.
- `.github/copilot-instructions.md` — project conventions.

## Persistent teams (ADR-0018)

| Team | Scope | Status |
|---|---|---|
| SECURITY | auth, authorization, tenant isolation, privacy, security controls/gates, security regression | active |
| OFFLINE | PWA/offline shell, offline auth, local-first persistence, offline UX, outbox, reconnect, sync foundations | active |
| COLLECTOR | scanner, capture, identify, confirm, add, browse, search/filter, mobile UX | active |
| DATA | generic collection model, registry, persistence, APIs, migrations, tenancy, scalability | active |
| PROVIDERS | OpenLibrary, MusicBrainz, Discogs, provider abstraction, fallback, retry, OCR fallback | active |
| AI | LLM abstraction, AI runtime, tool contracts, enrichment, duplicate detection, assistant, image recognition, cost controls | DORMANT |
| GROWTH | social, discovery, marketplace, collection expansion, feedback intelligence | DORMANT |

A DORMANT team is not assigned work until its GitHub dependencies are READY.

## Independent gate subagents (review only)

| Gate | Subagent | Trigger |
|---|---|---|
| Architecture | `architecture-reviewer` | matching architecture boundary |
| Application security | `security-auditor` | auth/authz/user data/storage/cache/external API/DB/AI boundary |
| Tenant isolation | `multi-tenant-security` | tenant/membership/IDOR/privilege boundary |
| Quality/coverage | `tester` | regression or coverage requirement |
| Critical UX/a11y | `ergonomics-reviewer` | gated critical journey or accessibility |
| Release readiness | `release-validator` | build/test/coverage/security/migration/PWA release |

Gate subagents are read-only reviewers invoked only by the PM. An
implementation team never approves its own work.

## Hard rules (never violate)

1. One issue = one branch = one PR. Branch: `mN/<team>/<issue>`. Never work on
   `main` for feature/bug work. Never use a shared branch.
2. Never merge automatically — the human retains merge authority.
3. Teams never coordinate directly; communication flows through GitHub
   issue/PR, ADR, compact state and the PM.
4. An out-of-scope issue returns `OUT OF SCOPE`; a team never expands its own
   roadmap.
5. A mandatory FAIL from a security, tenant-isolation, architecture, testing,
   release or critical-UX gate cannot be converted to PASS by the PM or by any
   implementer.
6. Implementation agents never approve their own security or quality gate.
7. Minimum sufficient context: read only the issue, its acceptance criteria,
   relevant ADRs and directly affected files. Never the whole repo, never
   unrelated agents, never full logs, never pasted source in delegation.
8. Every specialist handoff uses the exact block in
   `.github/agent-runtime/handoff.md`:

```text
STATUS: PASS | FAIL | HOLD | NOT VERIFIED
ISSUE:
PR:
DECISION:
EVIDENCE:
RISKS:
NEXT:
```

9. Reuse prior evidence only when the code surface, ADR and dependencies are
   unchanged; otherwise re-run the gate. `NOT VERIFIED` is valid; never infer
   PASS.
