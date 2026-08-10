---
name: ergonomics-review
description: "Review Runout's ergonomics and UX: touch targets and thumb reach, readability and contrast on the dark #16130F theme, feedback/error/loading states, form and scanner ergonomics, keyboard/screen-reader support, focus management in bottom sheets, and installed-PWA behavior (safe areas, back navigation, offline). Use for 'ergonomics', 'UX review', 'usability', 'accessibility audit', 'does this feel good to use', 'mobile UX', 'touch targets', 'contrast'. Read-only — reports findings, does not edit code."
---
# Ergonomics Review

Ergonomics here means **human factors**: how comfortable, discoverable, and
error-proof Runout is to actually use — thumb reach on a phone, readability on
the dark theme, clear feedback, and accessibility. This skill is read-only: it
produces findings, not edits.

## When to Use
- The user asks to review or improve the UX/ergonomics/usability of the app.
- Before shipping a UX change, or after adding a new flow (auth, a new
  collection kind, a new sheet).
- When someone reports the app "feels off", hard to use, or unreadable.

## What's Already Handled (don't re-flag these)
Runout already does these well — check they haven't regressed, but don't list
them as issues:
- `prefers-reduced-motion` honored (`index.css`, `ScannerModal.css`,
  `EmptyState.css`).
- Visible `:focus-visible` outline in `--runout-gold` (`index.css`).
- Safe-area insets (`--safe-top`/`--safe-bottom`) on sheets, the FAB, and the
  toast; `.app-main` clears the FAB.
- Bottom sheets (`sheet-overlay`/`sheet` in `styles/shared.css`) with
  thumb-reachable action buttons; `role="dialog"` + `aria-modal`.
- Aria labels on icon buttons, tabs (`aria-pressed`), search/sort controls.
- Empty / no-results / loading / error states everywhere (`EmptyState`,
  `MatchPicker`, `ScanResult`, `AuthScreen`).
- Duplicate-detection banners (`ScanResult` tones good/owned/caution).
- Camera permission + failure messaging (`ScannerModal`).
- Form niceties: `inputMode="numeric"`, `autoCapitalize="off"` on the code
  field, `required` on manual-add title.

## Review Method
1. **Run the real app**: `npm run dev` (or reuse a running server) and open it
   in the integrated browser at a **phone viewport** (~375×667) AND desktop.
   Camera flows need HTTPS or `localhost`.
2. **Walk the real flows**, not just the code:
   - Auth: request access → (admin) approve → sign in → session persists on
     reload.
   - Scan-to-add: scan a code → match picker → scan result → add → toast →
     item appears.
   - Manage: open a detail, edit notes, delete; filter/sort; search no-match.
   - Settings + Admin panel (with the admin key).
3. **Probe the checklist** in
   [references/checklist.md](./references/checklist.md) — it's grounded in the
   actual components and CSS (colors, breakpoints, sheets, FAB, toolbar).
4. **Verify each finding in the browser**, not just by reading code. For each
   issue, note the component/file, the real symptom, and a concrete fix.

## Reporting (read-only)
Report findings grouped by severity, in this shape:

```
## Severity
- CRITICAL — blocks the core flow (scan → add), or unusable on a phone/iOS
- MAJOR — significant friction, mis-taps, unreadable text, or a11y barrier
- MINOR — polish: spacing, wording, micro-feedback

## Findings (one per item)
- **Component/file** — symptom (seen in browser) · why it's an ergonomics
  problem · suggested fix.
```

DO NOT edit code. Return the report; the user (or the Runout Engineer) decides
what to fix. See `.github/prompts/review-ergonomics.prompt.md` and
`.github/prompts/fix-ergonomics.prompt.md`.
