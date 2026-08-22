# Master Portfolio Roadmap

> Compact, PM-owned. Canonical: #355 · ADR-0018 · `docs/agents/responsibility-matrix.md`.
> Team checkpoints: `state/teams/`. Milestone detail: `state/M1.md` … `state/M4.md`.

## Position
- M0–M4 complete (M1: 40, M2: 19, M3: 9, M4: 36). M5 ACTIVE. M6 in icebox.

## Milestones
| Milestone | Focus | Status | Leading teams |
|---|---|---|---|
| M0 — Stabilize & Release Current Product | launch baseline | COMPLETE | — |
| M1 — Security, Reliability & Platform Foundation | Security foundation + AI provider + SSRF + asset serving + data export + account deletion (40 closed) | **COMPLETE** | SECURITY, AI, DATA |
| M2 — Collector Core Experience | Offline-first #289/#292/#159 + FEAT-EPIC-7 core (#320/#321/#322) + admin analytics (19 closed) | **COMPLETE** | COLLECTOR, OFFLINE, UX, DATA |
| M3 — Generic Collection Platform & Robust Sync | Domain #314 · tenancy #165 · registry #315 · adapters #317 · migrate #316 · sync #160/#161 · wishlist #318 (9 closed) | **COMPLETE** | DATA, PROVIDERS, OFFLINE |
| M4 — Differentiation & Intelligent Collection | AI, duplication, assistant, enrichment (36 closed) | **COMPLETE** | AI, DATA |
| M5 — Social & Discovery | Social features, discovery, moderation (#325–#330) | **ACTIVE** | GROWTH |
| M6 — Commerce & Value Services | Marketplace, valuations, commerce | IN ICEBOX | GROWTH |

## Team map
`state/teams/security.md` · `offline.md` · `collector.md` · `data.md` · `providers.md` · `ai.md` · `growth.md`

## Rules (see ADR-0018)
- Persistent teams; PM assigns next READY issue to the existing team.
- One issue = one branch = one PR (`mN/<team>/<issue>`); human merges.
- Out-of-scope → `OUT OF SCOPE` → return control to PM.
- Multi-milestone parallelism only when dependencies/gates/ownership permit.
