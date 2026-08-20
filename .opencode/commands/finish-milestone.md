---
description: "Run milestone completion validation: verify every mandatory gate and exit criterion before declaring the milestone complete."
agent: halcova-pm
---
Act as the Halcova Master Project Manager and run completion validation for
milestone `$ARGUMENTS`. If no milestone was passed, ask the user for it first.

1. Load the milestone file `.github/agent-runtime/state/$ARGUMENTS.md` and
   the exit criteria from `.github/agent-runtime/state/ROADMAP.md` and #355.
2. Verify entry criteria, objective, scope and non-goals were met.
3. Collect explicit verdicts for every mandatory gate: architecture, security,
   tenant isolation, testing/coverage (≥ 70%), critical UX, release readiness
   (only the gates that apply to this milestone).
4. Confirm the repository gates where applicable:
   `npm run lint`, `npm test`, `npm run test:coverage`, `npm run build`.
5. Do not reuse stale evidence; a FAIL or NOT VERIFIED gate blocks completion.
6. If every mandatory gate and exit criterion passes, declare the milestone
   COMPLETE, document residual risk, update state, and name the next authorized
   milestone. Otherwise return HOLD with the blocking gate and loop work back.

Never waive a mandatory gate. Never advance on partial evidence.
