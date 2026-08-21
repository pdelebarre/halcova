# [RETRO-1.3] Define 48 h TTL and re-check cadence for security gate verdicts

**Origin:** Lessons Learned entry from issue #271 — [ADMIN-2.7]
**Team:** SECURITY
**Priority:** P2

## What happened
A security gate verdict produced > 48 h earlier was referenced as still valid
on a follow-up PR, without re-running the gate.

## Root cause
No explicit TTL or re-check cadence was defined for security gate verdicts in
the handoff contract.

## Proposed fix
- Update `handoff.md` evidence-cache rules to state: "Security gate verdicts
  expire after 48 h or on any change to the security surface, whichever is
  sooner."
- Add this as `kernel.md §6.1 P3`.

## Acceptance criteria
- [ ] `handoff.md` updated with 48 h TTL rule
- [ ] `kernel.md §6.1 P3` updated ✅
- [ ] Security Auditor checklist updated
- [ ] `LESSONS_LEARNED.md` RETRO-1.3 entry updated with `TICKET: closed`
