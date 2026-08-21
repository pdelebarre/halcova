# PM Milestone State

> Compact runtime state. The PM updates this after every milestone decision.
> Portfolio: `ROADMAP.md` · milestones `M1.md`…`M4.md` · teams `teams/`.

## Persistent teams
- SECURITY `teams/security.md` · OFFLINE `teams/offline.md` · COLLECTOR `teams/collector.md`
- DATA `teams/data.md` · PROVIDERS `teams/providers.md` · AI `teams/ai.md` · GROWTH `teams/growth.md`

## Current milestone
- Multiple active: M1 (14 open), M2 (15 open), M3 (4 open) — all IN PROGRESS with open backlogs. No milestone declared externally complete. M4/M5/M6 not started.
- Canonical milestone definitions: #355.

## Corrected portfolio view (2026-08-21)
- M1 IN PROGRESS — core security foundation merged; 14 open (AI P0s #303/#304, SEC-EPIC-6 #214, SSRF #217, RES-EPIC-1 #281, ARCH-EPIC-1 #150, sec follow-ups).
- M2 IN PROGRESS — offline-first merged (#289/#292/#159); Collector Core Experience epic #319 core still open (#320/#321/#322/#323/#324) + #158 IndexedDB.
- M3 IN PROGRESS — generic platform core merged (#314/#165/#315/#317/#316); sync #160/#161 + #318 + #268 open (gated on ADR-0019).
- M4/M5/M6 — NOT started (AI-differentiation / social / commerce; distinct from what was mislabeled).

## Active workstreams (READY to dispatch)
- [ ] M1 #303 AI provider abstraction — MERGED (PR #430) · #304 secure LLM config — IMPLEMENTED (branch m1/ai/304, awaiting independent gates)
- [ ] M1 #217 SSRF regression suite — SECURITY
- [ ] M3 #160/#161 sync — gated on accept ADR-0019 first
- [ ] M2 #319 core (#320/#321/#322) — COLLECTOR + UX
- [ ] M2 #158 reconcile scope vs merged #289/#292

## Completed work
- M0 release evidence (PR #362) · Agent Runtime v2 (PR #401)
- M1 core: security #338–#341, offline #157/#162, lookup #283–#293, perf #364–#366, #409 XSS, #342 sign-off, #376/#378/#399
- M2 offline-first: #289/#292/#159 (PRs #420/#421/#422) · ADR-0019
- M3 platform core: #314/#165/#315/#317/#316 (PRs #423–#428) + #429 deploy fix
- Governance: pre-submit verification bar (kernel.md §6.1)

## Blocked / deferred
- #380/#381/#385 (M1 P2 sec) — deferred (API+Data+Security review)
- #386 (netlify-cli dev-only HIGHs) — approved exception, allowlisted
- M3 #160/#161 sync — blocked on ADR-0019 accept
- #158 scope vs #289/#292 — needs reconcile

## Next actions
1. Dispatch M1 #303/#304 (AI) + #217 (SECURITY) — READY
2. Accept ADR-0019 → dispatch M3 #160/#161
3. Dispatch M2 FEAT-EPIC-7 core (#320/#321/#322) to COLLECTOR+UX
4. Reconcile remaining backlog with owners per milestone