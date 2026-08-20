# ADR-0018: Persistent multi-team delivery model

- **Status:** Accepted
- **Date:** 2026-08-20
- **Related roadmap:** #355
- **Related documentation:** `docs/agents/responsibility-matrix.md`, `.github/agent-runtime/`, `.github/skills/agentic-workflow/SKILL.md`
- **Supersedes:** — (extends ADR-0014; no authority change)

## Context

Halcova's agent runtime (ADR-0014, Agent Runtime v2) activates individual
specialist agents per issue, one handoff at a time:

```text
PM → individual agent → PM → individual agent
```

This loses domain context between issues, encourages re-reading the repository
and the full ADR set for every ticket, and does not express how workstreams
persist across milestones. A milestone can run multiple related workstreams
(e.g. security, offline, providers) that each benefit from a persistent owner
carrying its domain context across a sequence of issues.

## Decision

Introduce a **persistent team layer** between the PM and individual
specialists, without changing the authority model from ADR-0014.

```text
USER
  ↓
MASTER PM
  ↓
persistent specialist teams
  ↓
GitHub issues / branches / PRs
  ↓
MASTER PM
  ↓
human merge / decision
```

The PM remains the sole orchestrator and accountable delivery owner.

### Teams and scope

Each team is persistent across milestones and may implement only issues within
its scope. Specialists inside a team remain **dormant** until a deterministic
trigger activates them (see `routing.md`).

| Team | Scope | Typical specialists |
|---|---|---|
| PM | Master orchestration, sequencing, dependency DAG, conflict resolution, escalation, gates, milestone advancement | Project Manager |
| SECURITY | authentication, authorization, tenant isolation, privacy, security controls, security gates | Security Architect, Security Auditor, Multi-tenant Security, Backend Developer, Tester |
| OFFLINE | PWA, offline shell, local-first persistence, offline auth, offline UX, outbox, reconnect, sync dependencies | Offline Architect, Platform Architect, Frontend Developer, Data Architect, Sync Engineer, Security Auditor, Tester, Ergonomics Reviewer |
| COLLECTOR | scanner, capture, identify, confirm, add, browse, search/filter, mobile collector UX | Frontend Developer, Scanner Builder, UI/UX, Ergonomics Reviewer, Tester |
| DATA | generic collection model, data architecture, repositories, migrations, PostgreSQL/tenancy, provider adapters, scalability | Whole Stack Architect, Data Architect, API Architect, Backend Developer, Security Auditor, Tester |
| PROVIDERS | OpenLibrary, MusicBrainz, Discogs, provider fallback, retry, resilience, OCR fallback, external integration hardening | API Architect, Catalog/Provider specialist, Backend Developer, Scanner Builder, Security Auditor, Tester |
| AI | AI provider abstraction, AI runtime, tool contracts, metadata enrichment, duplicate detection, collection intelligence, assistant | DORMANT until GitHub dependencies (#303/#304) are READY |
| GROWTH | social, discovery, marketplace, collection expansion, feedback/product intelligence | DORMANT until GitHub dependencies (#325/#343/#348) are READY |

`Typical specialists` are conceptual role labels, not new agent definitions.
The concrete agent roster is unchanged (see
`docs/agents/responsibility-matrix.md`). Where a label has no dedicated agent
file, it maps to the closest existing specialist: Security Architect → Whole
Stack Architect (security architecture review); Backend Developer → Netlify
Backend; API Architect → API Contract Reviewer; Catalog/Provider specialist →
Catalog Designer; AI Architect → Whole Stack Architect under ADR-0006.

### Team rules

1. **Persistent, not per-issue.** Do not create a new agent/session for every
   issue. The team keeps its domain context; the PM assigns the next READY
   issue to the existing team.
2. **Scope-bounded.** A team implements only issues in its scope. An issue
   belonging to another team returns `OUT OF SCOPE` and control returns to the
   PM.
3. **PM is the only orchestrator.** Teams do not coordinate with each other
   directly. Team-to-team communication happens through GitHub issue, PR, ADR,
   compact state, and the PM.
4. **GitHub is the handoff bus.** `Issue → branch → PR → review → merge →
   dependency → next issue`. Agent responses carry only concise evidence.
5. **One issue = one branch = one PR.** Branch naming is
   `mN/<team>/<issue>` (e.g. `m1/security/376`, `m1/providers/399`). Never use
   `m1-development`, `development`, or a shared agent branch. Two teams never
   modify the same branch. Nothing is merged automatically; the human retains
   merge authority.
6. **File ownership.** Before parallel activation, identify likely modified
   files. If two teams require the same critical file, serialize and record the
   conflict in PM state.
7. **Dormant specialists.** Activate a specialist only when its trigger
   applies, even inside an active team.

### State

- Team checkpoint: `.github/agent-runtime/state/teams/<team>.md` — only
  `TEAM / CURRENT ISSUE / STATUS / ACTIVE PR / LAST GATE / BLOCKER / NEXT`.
- Master portfolio: `.github/agent-runtime/state/ROADMAP.md` and
  `M1.md` … `M4.md` — owned by the PM, kept compact.

### Multi-milestone parallelism

Milestones are not a strictly serial queue. Multiple milestones may have active
teams when dependencies are satisfied, architecture gates permit it, file
ownership does not conflict, and work does not prematurely consume a blocked
dependency. Blocked downstream functionality is never implemented merely to
increase parallelism.

## Consequences

### Positive

- domain context persists across an issue sequence within a team;
- less repeated repository/ADR reloading per ticket;
- clearer ownership and branch discipline per team;
- a single compact state per team and per milestone.

### Negative

- PM must actively maintain team state and branch ownership;
- risk of scope drift if a team expands its own roadmap (mitigated by the
  `OUT OF SCOPE` rule and PM-only sequencing).

## Governance impact

This ADR extends the execution model from ADR-0014. It does not change the
authority hierarchy, blocking gates, separation of duties, or PM
accountability. `docs/agents/responsibility-matrix.md`, `.github/agent-runtime/`
and `.github/skills/agentic-workflow/SKILL.md` are updated to reference the
team layer.
