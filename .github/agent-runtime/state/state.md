# PM Milestone State

> Compact runtime state. The PM updates this after every milestone decision.
> Portfolio: `ROADMAP.md` · milestones `M1.md`…`M5.md` · teams `teams/`.

## Persistent teams
- SECURITY `teams/security.md` · OFFLINE `teams/offline.md` · COLLECTOR `teams/collector.md`
- DATA `teams/data.md` · PROVIDERS `teams/providers.md` · AI `teams/ai.md` · GROWTH `teams/growth.md`

## Current milestone: M5 — Social & Discovery
- M0–M4 COMPLETE. All PRs merged, no open PRs, all milestones closed.
- M5 launched 2026-08-22. Scope: FEAT-EPIC-8 (#325) — Collector Social & Discovery.
- M5 exit gates: privacy/moderation threat model approved; abuse scenarios tested; social activation/retention metrics defined.

## Active workstreams
- [ ] M5 #326 Collector Profiles & Public Collections — GROWTH (Phase 1)
- [ ] M5 #330 Social Moderation, Privacy & Abuse Controls — GROWTH (Phase 1)
- [ ] M5 #327 Follows & Activity Feed — GROWTH (Phase 2, gated on #326)
- [ ] M5 #328 Likes, Comments, Groups — GROWTH (Phase 3, gated on #326/#327/#330)
- [ ] M5 #329 Discovery Recommendations — GROWTH (Phase 2, gated on #326)

## Completed work
- M0 release baseline
- M1 Security, Reliability & Platform Foundation — complete
- M2 Collector Core Experience — complete
- M3 Generic Collection Platform & Robust Sync — complete
- M4 Differentiation & Intelligent Collection — complete (36 closed)

## Icebox (P3, deferred)
- #163 ARCH-5.2 Observability
- #164 ARCH-5.3 External Integrations Hardening
- #166 ARCH-6.2 Scalability Bottlenecks
- #167 ARCH-6.3 Container Deployment
- #168 ARCH-7.1 Multi-Client Productization
- #386 SEC-EXC netlify-cli dev-only HIGHs (exception)
- #408 react-helmet-async peer mismatch
- #411 SEC-LOW XSS guard residuals
- iOS PBI epics (unassigned, no milestone)

## Next actions
1. Kick off GROWTH team on #326 and #330 in parallel
2. Phase 2 begins after #326 merged
3. Gate each PR with batched architecture/security/tenant-isolation/tester/UX review
4. Track social activation/retention metrics per exit gate
