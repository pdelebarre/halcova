---
name: testing
description: "Halcova's Vitest + Testing Library workflow and independent quality gate: what and where to test, behavior-first tests, coverage, regression evidence and milestone verification. Use for testing, QA, coverage, failing tests or release gates."
---
# Testing

Runout tests with **Vitest + Testing Library** (jsdom environment). This skill is also the procedure used by the `Tester` agent for its independent quality gate.

## Governance

Load `docs/agents/responsibility-matrix.md` and `.github/skills/agentic-workflow/SKILL.md` for milestone/release work.

The `Tester` owns the quality verdict. The Project Manager owns delivery
accountability but cannot declare a gated ticket complete when required tests,
regression evidence or coverage fail. A FAIL loops back to the implementer and
must be re-tested.

## When to Use
- Add/extend tests for features, catalog kinds or providers.
- Fix a failing test or reproduce a bug.
- Verify a milestone exit criterion.
- Establish regression evidence before release.

## Setup

- Config: `vitest.config.js` — jsdom, globals, setup and v8 coverage.
- Commands: `npm test`, `npm run test:coverage`.

## Test scope

Test pure logic, API normalization with mocked fetch, `useCollection`, catalog
contracts and critical user behavior. Never hit real Discogs/Google Books APIs
in unit tests.

## Coverage gate

All four configured metrics — statements, branches, functions and lines — must
be at least **70%**. Never lower the threshold to make a milestone green.

## Required milestone evidence

For milestone work, report:
- tests added/changed;
- regression scenarios covered;
- `npm test` result;
- `npm run test:coverage` result and all four metrics;
- known gaps and residual risk;
- explicit **QUALITY VERDICT: PASS / FAIL / NOT VERIFIED**.

Security-sensitive changes must also include the negative security tests required
by the Security Auditor; Tester verifies their execution but does not replace the
security verdict.

## Verification

`npm test` is green, coverage clears 70%, and `npm run lint` remains clean before
quality PASS where those gates apply.
