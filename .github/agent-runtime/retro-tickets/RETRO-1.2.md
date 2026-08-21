# [RETRO-1.2] Enforce SSRF regression suite re-run for every external-proxy PR

**Origin:** Lessons Learned entry from issue #217 — [SEC-6.3]
**Team:** SECURITY
**Priority:** P1

## What happened
SSRF guard was not re-validated before a new external-proxy PR merged, causing
a regression that was caught only by the dedicated regression suite introduced
in #217.

## Root cause
Security gate evidence was reused across a changed proxy surface without
explicitly re-running the SSRF suite.

## Proposed fix
- Add a required CI check label `ssrf-regression-required` that triggers
  automatically on any PR touching `netlify/functions/*proxy*`, `*provider*`,
  or `*external*` paths.
- Document in `kernel.md §6.1 P2` and `handoff.md` evidence-cache rules.

## Acceptance criteria
- [ ] CI label / path-filter triggers SSRF suite automatically on proxy PRs
- [ ] `kernel.md §6.1` P2 updated ✅
- [ ] `handoff.md` evidence-cache section updated to reference SSRF TTL
- [ ] `LESSONS_LEARNED.md` RETRO-1.2 entry updated with `TICKET: closed`
