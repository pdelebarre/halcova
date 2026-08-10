---
description: "Run a full ergonomics / UX / usability review of Runout (read-only): touch targets and thumb reach, readability and contrast on the dark theme, feedback/error/loading states, forms, scanner UX, keyboard + screen-reader accessibility, focus in bottom sheets, and installed-PWA behavior. Produces findings by severity — it does not edit code. Triggers: 'review ergonomics', 'UX review', 'usability review', 'accessibility audit', 'how does the app feel', 'mobile UX review', 'touch targets', 'a11y audit'."
name: "Review ergonomics"
argument-hint: "Focus area (e.g. 'scanner flow') or leave blank for a full review?"
agent: "Ergonomics Reviewer"
---
Run a read-only ergonomics review of Runout, using the `ergonomics-review`
skill in `.github/skills/ergonomics-review/` (read its `SKILL.md` and walk
`references/checklist.md`).

## Scope
- Walk the real app in the integrated browser at a **phone viewport (~375×667)**
  and desktop: auth (request → approve → sign in → reload), scan-to-add (scan
  → match picker → scan result → add → toast), manage (detail, edit, delete,
  filter/sort, no-match search), and settings/admin.
- Cover the checklist dimensions: touch & reach, layout & scrolling,
  readability & contrast, feedback & states, forms & input, scanner UX,
  navigation & wayfinding, accessibility, installed-PWA behavior, and
  performance feel.
- If the user named a focus area (e.g. "scanner flow", "mobile touch targets"),
  go deep there and keep the rest to a quick pass.

## Deliverables
- Findings grouped by severity (CRITICAL / MAJOR / MINOR), each with
  component/file, the symptom observed in the browser, why it's an ergonomics
  problem, and a concrete suggested fix.
- Do NOT edit any code — review only.
- End with a one-line verdict and a suggested fix order.
