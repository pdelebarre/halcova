# Master Portfolio Roadmap

> Compact, PM-owned. Canonical: #355 · ADR-0018 · `docs/agents/responsibility-matrix.md`.
> Team checkpoints: `state/teams/`. Milestone detail: `state/M1.md` … `state/M4.md`.

## Position
- M0 complete. M1/M2/M3 have merged CORE slices but retain OPEN backlog tickets; final-exit criteria per #355 not all met. M4 NOT started. Backlog reconciliation needed before any milestone is declared externally complete.

## Milestones
| Milestone | Focus | Status | Leading teams |
|---|---|---|---|
| M1 — Security, Reliability & Platform Foundation | epic #337 (merged core) — CORE merged; OPEN: #217 SSRF suite (P1), #385/#381/#380 (P2 sec), #411 XSS residual, #408 deps, #214 SEC-EPIC-6 | IN PROGRESS (backlog open) | SECURITY |
| M2 — Offline-first | mirror #289 · outbox #292 · capability #159 merged | IN PROGRESS (backlog open) · OPEN: #158 IndexedDB (P0), #160/#161 sync+OCC (P1), ARCH-EPIC-1 #150 stack | OFFLINE, DATA, SECURITY |
| M3 — Generic Collection Platform | epic #313 core (domain #314 · tenancy #165 · registry #315 · adapters #317 · migrate #316) merged | IN PROGRESS (backlog open) · OPEN: #318 wishlist/lifecycle (P1), #309 GitHub↔feedback | DATA, PROVIDERS, SECURITY |
| M4 — Collector-First Mobile Experience | epic #319 | NOT STARTED (hold pending M1–M3 backlog reconciliation) | — |
| M5+ — Differentiation & growth | social #325 · AI #331 · marketplace #343 · expansion #348 | DORMANT | GROWTH, AI |

## Team map
`state/teams/security.md` · `offline.md` · `collector.md` · `data.md` · `providers.md` · `ai.md` · `growth.md`

## Rules (see ADR-0018)
- Persistent teams; PM assigns next READY issue to the existing team.
- One issue = one branch = one PR (`mN/<team>/<issue>`); human merges.
- Out-of-scope → `OUT OF SCOPE` → return control to PM.
- Multi-milestone parallelism only when dependencies/gates/ownership permit.
