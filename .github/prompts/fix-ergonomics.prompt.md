---
description: "Fix ergonomics / UX issues in Runout (the follow-up to a review): improve touch targets and thumb reach, readability/contrast, feedback and error states, form and scanner ergonomics, keyboard + screen-reader accessibility, focus in bottom sheets, and installed-PWA behavior — without regressing the app's conventions. Triggers: 'fix ergonomics', 'improve UX', 'make it easier to use', 'fix the UX review', 'improve touch targets', 'better contrast', 'address the ergonomics findings'."
name: "Fix ergonomics"
argument-hint: "Which findings to fix (e.g. 'all MAJOR+', 'scanner retry button') — or paste the review report."
agent: "Runout Engineer"
---
Implement ergonomics / UX fixes in Runout. Use the `ergonomics-review` skill
(`.github/skills/ergonomics-review/`, incl. `references/checklist.md`) as the
spec for what "good" looks like, and fix what the user asked for (or the
findings they pasted / the last review's CRITICAL + MAJOR items).

## Steps
1. Confirm which findings to address (severity threshold, focus area, or the
   pasted report). If none given, run a review first via the `Review
   ergonomics` prompt.
2. For each fix:
   - Change the right layer: `.copy` for wording, CSS/component for touch
     targets, contrast, spacing; component logic for feedback/focus/back
     navigation.
   - Keep conventions: copy in the catalog's `.copy` (see `update-copy`),
     normalize in `src/api/*`, no unguarded render paths (dark-screen risk),
     preserve reduced-motion + `:focus-visible` + safe-area handling.
3. Verify in the integrated browser at a phone viewport (and desktop where
   relevant) that the symptom is gone and nothing else regressed.
4. Run `npm run lint` and `npm test`.

## Deliverables
- What changed per finding (component/file + before → after).
- Browser-verified confirmation the symptom is resolved.
- A note on anything left for later (e.g. deferred MINOR items).
