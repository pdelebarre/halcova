# [RETRO-1.1] Prevent *.test.js from being bundled as a Netlify function

**Origin:** Lessons Learned entry from issue #315 — [FEAT-6.2]
**Team:** DATA / Netlify Backend
**Priority:** P1

## What happened
A `*.test.js` file was placed inside `netlify/functions/` root and got bundled
on deploy, causing a 422 error.

## Root cause
No pre-submit check existed to prevent test files from landing in the functions
root.

## Proposed fix
- Add a CI lint step that fails if any `*.test.js` or `*.spec.js` file exists
  directly under `netlify/functions/`.
- Update developer onboarding docs and copilot-instructions.md to reflect the
  rule.
- Promote rule to `kernel.md §6.1 P1` once implemented.

## Acceptance criteria
- [ ] CI fails fast on `*.test.js` in `netlify/functions/` root
- [ ] `kernel.md §6.1` updated with rule P1 marked ✅
- [ ] `LESSONS_LEARNED.md` RETRO-1.1 entry updated with `TICKET: closed`
