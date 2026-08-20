# Master Portfolio Roadmap

> Compact, PM-owned. Canonical: #355 · ADR-0018 · `docs/agents/responsibility-matrix.md`.
> Team checkpoints: `state/teams/`. Milestone detail: `state/M1.md` … `state/M4.md`.

## Position
- M0 complete · M1 in progress (security gate #342 pending) · M2–M4 gated downstream.

## Milestones
| Milestone | Focus | Status | Leading teams |
|---|---|---|---|
| M0 — Stabilize & Release Current Product | launch baseline | COMPLETE | — |
| M1 — Security, Reliability & Platform Foundation | epic #337 security + offline #157/#162 + providers #283–#293 + perf #364–#366 | IN PROGRESS (gate) | SECURITY, OFFLINE, PROVIDERS |
| M2 — Offline-first | mirror #289 · outbox #292 · sync #160/#161 | GATED (M1) | OFFLINE, DATA, SECURITY |
| M3 — Generic Collection Platform | epic #313 (domain #314 · registry #315 · migrate #316 · adapters #317) | GATED (M1/M2) | DATA, PROVIDERS, SECURITY |
| M4 — Collector-First Mobile Experience | epic #319 (home #320 · add/scan #321 · detail #322 · search #323 · UX gate #324) | GATED | COLLECTOR, UX, SECURITY |
| M5+ — Differentiation & growth | social #325 · AI #331 · marketplace #343 · expansion #348 | DORMANT | GROWTH, AI |

## Team map
`state/teams/security.md` · `offline.md` · `collector.md` · `data.md` · `providers.md` · `ai.md` · `growth.md`

## Rules (see ADR-0018)
- Persistent teams; PM assigns next READY issue to the existing team.
- One issue = one branch = one PR (`mN/<team>/<issue>`); human merges.
- Out-of-scope → `OUT OF SCOPE` → return control to PM.
- Multi-milestone parallelism only when dependencies/gates/ownership permit.
