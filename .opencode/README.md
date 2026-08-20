# Halcova — OpenCode Agent Structure (v1.18.18)

The sole orchestration surface for operating Halcova from OpenCode. The human
talks only to the **Master Project Manager** (`halcova-pm`); the PM delegates
implementation to seven persistent specialist teams and independent review to
six gate subagents, all through GitHub issues, branches and PRs.

```
USER → MASTER PM → implementation teams + independent gates → GitHub issues/PRs → MASTER PM → USER
```

## Layout

```
. (repo root)
├── opencode.json              # default agent = halcova-pm
├── AGENTS.md                  # global kernel (auto-loaded by OpenCode)
└── .opencode/
    ├── agents/
    │   ├── halcova-pm.md           # PRIMARY orchestrator (user-facing)
    │   ├── security-team.md        # SUBAGENT · implementation
    │   ├── offline-team.md         # SUBAGENT · implementation
    │   ├── collector-team.md       # SUBAGENT · implementation
    │   ├── data-team.md            # SUBAGENT · implementation
    │   ├── providers-team.md       # SUBAGENT · implementation
    │   ├── ai-team.md              # SUBAGENT · implementation (dormant)
    │   ├── growth-team.md          # SUBAGENT · implementation (dormant)
    │   ├── security-auditor.md     # SUBAGENT · gate (read-only)
    │   ├── multi-tenant-security.md # SUBAGENT · gate (read-only)
    │   ├── architecture-reviewer.md # SUBAGENT · gate (read-only)
    │   ├── tester.md               # SUBAGENT · gate (tests only)
    │   ├── ergonomics-reviewer.md  # SUBAGENT · gate (read-only)
    │   └── release-validator.md    # SUBAGENT · gate (read-only)
    └── commands/
        ├── go.md              # execute maximum safe parallel work
        ├── status.md          # concise portfolio status
        ├── review.md          # coordinate gates for a PR
        └── finish-milestone.md # milestone completion validation
```

## Quick start

1. Open this repo in OpenCode: `opencode /Users/pdelebarre/dev/halcova`
2. Select the **halcova-pm** primary agent (it is the configured default).
3. Use the slash commands or plain instructions:
   - `/status` — portfolio snapshot
   - `/go` — run all safe parallel work
   - `/review 123` — coordinate gates for PR #123
   - `/finish-milestone M1` — milestone completion validation
   - Plain commands: "Initialize", "Run M1"…"Run M4", "Pause security",
     "Resume offline", "Review PR #123", "Finish M1"

The PM reads GitHub state and the compact state files under
`.github/agent-runtime/state/`, assigns READY issues to teams, delegates via
OpenCode subagent (task) calls — in parallel when safe — and reports back.

## Capability assessment (OpenCode 1.18.18)

| Capability | Status | Notes |
|---|---|---|
| PM → team delegation | SUPPORTED | `mode: subagent` team agents invoked via the `task` tool |
| Parallel workers | SUPPORTED | multiple `task` calls in one turn; parallelize only independent issues |
| Persistent workers | NOT SUPPORTED | subagents are stateless per call; persistence comes from state files + GitHub |
| Specialist delegation | SUPPORTED | 7 team subagents + 6 gate subagents; specialists stay dormant until triggered |
| Background execution | NOT SUPPORTED | no long-lived background agents; all work is synchronous within a PM turn |
| Worker result collection | SUPPORTED | each worker returns the compressed handoff block; PM folds it into state |

**Consequence of stateless workers:** the "GitHub is the handoff bus" model is
mandatory. State lives in `.github/agent-runtime/state/` and GitHub, never in
agent memory. The PM re-reads state each turn; this is by design, not a
limitation to work around.

## Team responsibilities

- **SECURITY** — authentication, authorization, tenant isolation, privacy,
  security controls, security gates, security regression testing.
- **OFFLINE** — PWA/offline shell, offline auth, local-first persistence,
  offline UX, outbox, reconnect, synchronization foundations.
- **COLLECTOR** — scanner, capture, identify, confirm, add, browse,
  search/filter, collector mobile UX.
- **DATA** — generic collection model, collection-type registry, persistence,
  APIs, migrations, tenancy, scalability.
- **PROVIDERS** — OpenLibrary, MusicBrainz, Discogs, provider abstraction,
  fallback, retry, lookup resilience, OCR fallback, external integration.
- **AI** (dormant) — LLM provider abstraction, AI runtime, tool contracts,
  metadata enrichment, duplicate detection, collection intelligence, assistant,
  image recognition, AI cost controls.
- **GROWTH** (dormant) — social, discovery, marketplace, collection expansion,
  feedback intelligence, growth features.

## PM authority (immutable)

The PM owns roadmap, milestones, prioritization, dependency DAG, team
assignment, parallelization, conflict resolution, gates, escalation and
milestone completion. The PM does **not** implement product code and **cannot**
override a mandatory security FAIL, an architecture rejection, failed tests or
a release-gate failure. Implementation teams never approve their own work.

## Independence of gates

Mandatory gates (architecture, security, tenant isolation, testing, UX, release)
are run by **dedicated gate subagents**, never by the team that implemented the
change:

| Gate | Subagent |
|---|---|
| Architecture | `architecture-reviewer` |
| Application security | `security-auditor` |
| Tenant isolation | `multi-tenant-security` |
| Quality/coverage | `tester` |
| Critical UX/a11y | `ergonomics-reviewer` |
| Release readiness | `release-validator` |

After an implementation team returns a PASS handoff with a PR, the PM
determines the required gates from `.github/agent-runtime/routing.md` and
delegates them directly — in parallel when their prerequisites are satisfied.
A FAIL loops work back to the implementer. The implementing team never
self-approves; `security-team` never approves its own security gate.

## Limitations (actual OpenCode constraints only)

1. **No persistent workers** — subagents reset between calls; all durable state
   must be written to files/GitHub (enforced above).
2. **No background agents** — no agent keeps running while the PM does something
   else; "parallel" means multiple subagent calls within one PM turn, not
   concurrent daemons.
3. **Single-turn delegation depth** — team and gate subagents do not spawn
   further subagents (`task` is enabled only on the PM); orchestration stays one
   level deep under the PM.
4. **GitHub tooling** — OpenCode has its own GitHub integration; where a team
   needs GitHub reads/writes, the PM (which holds `bash`) uses the `gh` CLI.
