---
name: ergonomics-review
description: "Review Halcova ergonomics and UX: mobile touch targets, readability, feedback, forms, scanner ergonomics, keyboard/screen-reader support, focus, safe areas and PWA behavior. Use for ergonomics, UX review, usability, accessibility audit or mobile UX. Read-only and may provide a blocking critical-UX verdict."
---
# Ergonomics Review

This skill evaluates human factors: comfort, discoverability, error prevention,
mobile reach, readability and accessibility. It is read-only and produces
findings for the implementer.

## Governance

Load `docs/agents/responsibility-matrix.md` and `.github/skills/agentic-workflow/SKILL.md` for milestone work.

The `Ergonomics Reviewer` is a **blocking gate for explicitly defined critical
user journeys**, especially M2's collector loop. The PM cannot convert a
CRITICAL UX/accessibility FAIL into PASS. Non-critical polish remains advisory.

## Review method

1. Run the real app at phone (~375×667) and desktop viewports.
2. Walk the actual critical flows.
3. Probe `references/checklist.md`.
4. Verify every finding in the browser.
5. Map critical findings to the relevant acceptance criterion.

## Severity

- CRITICAL — blocks core flow, inaccessible critical action, or unusable phone/iOS behavior.
- MAJOR — significant friction, mis-taps, unreadable text or meaningful a11y barrier.
- MINOR — polish.

## Gate output

For milestone-gated reviews report:
- findings and evidence;
- affected acceptance criteria;
- remediation recommendation;
- residual risks;
- explicit **UX VERDICT: PASS / FAIL / NOT VERIFIED**.

A CRITICAL failure blocks completion until re-review confirms remediation.
