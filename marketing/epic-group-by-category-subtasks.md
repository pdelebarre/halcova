# Subtasks — Epic: "View items grouped by category"

Paste each section below into its own GitHub issue. Link every issue to the
epic (`marketing/epic-group-by-category.md`) and add the suggested labels.
Work on branch `feat/group-by-category` (off `main`, never `main`) — see the
`feature-branching` skill.

> **Created on GitHub 2026-08-15:** epic **#127**, subtasks **#128–#137**
> (numbers assigned at creation; each body below is linked to the epic).

Suggested labels: `enhancement` (the epic itself), `frontend`, `tests`, `i18n`,
`docs`, `marketing`; add `priority:P2` per the launch-grooming convention.

Grounding for all copy: `src/catalog.js` (`browseAxes`: records `genre`, books
`category`; `genreLabel`), `src/CollectionView.jsx` (flat grid/list over
`visibleItems`; browse path `runout.browse.<kind>`; `SectionHeader` reuse),
`src/components/Toolbar.jsx`, `src/utils/browse.js` (`binCounts`, `itemInBin`),
`docs/functional.md` (F-11 genre/category filter).

## Subtask map

| # | Issue | Layer | Title |
| --- | --- | --- | --- |
| P0 | #128 | product | Decisions + ADR: grouping axis, section order, "Other" bucket, sticky headers |
| T1 | #130 | frontend/tests | Pure grouping helper `groupByAxis` in `src/utils/browse.js` + unit tests |
| T2 | #137 | frontend | Toolbar "Group" control + browse-state persistence (`runout.browse.<kind>`) |
| T3 | #134 | frontend | Sectioned render in `CollectionView` (SectionHeader + Grid/ListView, jump-to-category) |
| T4 | #133 | frontend/a11y | Ergonomics & accessibility pass (sticky headers, touch targets, focus, no dark screen) |
| T5 | #136 | tests | Render regression: grouped mode for records AND books, grid + list |
| T6 | #132 | i18n | i18n: `group.*` strings in 7 locales |
| T7 | #129 | docs | Docs + ADR: grouped view in functional/technical + ADR-0005 |
| T8 | #131 | tests/ergonomics | QA + ergonomics review of both rooms |
| T9 | #135 | marketing | Marketing: grouped-view screenshots + copy for the campaign/ASO |

Suggested order: P0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9.

---

## P0 — Product decisions + ADR (#128)

**Epic:** #127 · **Layer:** product · **Owner:** Project Manager +
Front End Architect · **Branch:** `feat/group-by-category`

**Body**

Resolve the open decisions in epic §3 before implementation starts. Record a
short ADR under `docs/adr/0005-group-by-category.md` (next free number after
`0004-wishlist-sightings.md` if present).

1. **Axis** — v1 groups by the kind's category axis only: records `genre`,
   books `category` (recommended). A general multi-axis picker is a follow-up.
2. **Section order** — A–Z by category (matches `AisleSheet`/`binCounts`
   convention), count-desc, or follow the active sort. Recommend **A–Z with
   counts on the header**.
3. **"Other" bucket** — always visible at the end with its count (recommended)
   vs hidden. Items with no genre/category must never vanish.
4. **Collapsible sections** — v1 **non-collapsible** (recommended).
5. **Within-section order** — the active sort applies inside each section
   (recommended).
6. **Sticky section headers** — decide in T4 (a11y/touch-target trade-off).
7. **Interaction with an active aisle/filter** — grouping re-arranges the
   filtered list; a single-category result shows one section (recommended).
8. **Saved views** — confirm a grouped view is *not* savable in v1 (existing
   saved-views feature untouched).

**Exit:** ADR signed off; every decision tagged *decided* so T1–T9 can proceed.

---

## T1 — Pure grouping helper `groupByAxis` + unit tests (#130)

**Epic:** #127 · **Layer:** frontend/tests · **Owner:** Front End
Developer · **Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

Add a pure, side-effect-free grouping helper in `src/utils/browse.js` (the
`binCounts`/`itemInBin` home — per the `testing` skill, pure logic lives in
`src/utils`):

```js
groupByAxis(items, axis) -> [{ value, count, items }]
```

1. Uses the catalog `axis.value(item)` seam (records `genre`, books
   `category`). An item with several values appears in **each** of its
   sections (mirrors `binCounts`).
2. Items with **no / blank** value go to a single **"Other"** bucket, appended
   last (epic §3.3). No item may vanish.
3. Section order per the P0 decision (recommended A–Z by value, "Other" last).
4. Does **not mutate** the input array; works on an empty list (`[]`).
5. `binCounts` / `itemInBin` stay unchanged.

**Files.** `src/utils/browse.js` · `src/utils/browse.test.js`.

**Acceptance criteria**
- [ ] `groupByAxis` returns ordered sections with counts; multi-value items
      appear in every matching section.
- [ ] Blank/missing values land in "Other", last; empty input → `[]`.
- [ ] No input mutation; `npm test` green.

**DoD:** lint + test pass. Consult the `testing` skill.

---

## T2 — Toolbar "Group" control + browse-state persistence (#137)

**Epic:** #127 · **Layer:** frontend · **Owner:** Front End
Developer · **Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

Add the **"Group"** control to `src/components/Toolbar.jsx` (off | by category,
next to the sort control — no new modal/sheet) and wire a `groupBy` state
through `src/CollectionView.jsx`:

1. `groupBy` state (`null | 'category'`) seeded from and persisted to
   `runout.browse.<kind>` (the browse path — same pattern as `sortBy`,
   `activeFormats`, `activeAisle`), so the mode survives reload and works
   offline, per kind (records vs books independent).
2. Toolbar copy via `catalog.copy.group` / i18n (`group.*` keys — see T6);
   no hardcoded strings.
3. The control is hidden when it can't apply (e.g. collection empty / demo
   read-only view is fine — grouping is purely presentational).

**Files.** `src/components/Toolbar.jsx` (+ CSS) · `src/CollectionView.jsx`.

**Acceptance criteria**
- [ ] Toggling Group on/off updates the view without a remount or dark-screen
      risk (no ErrorBoundary in the app).
- [ ] Mode persists per kind across reloads/offline.
- [ ] Zero hardcoded UI strings (copy via `catalog.copy`/i18n).

**DoD:** lint + test + build pass. Consult the `netlify-collection` skill only
if the browse-path persistence touches storage helpers.

---

## T3 — Sectioned render in `CollectionView` (#134)

**Epic:** #127 · **Layer:** frontend · **Owner:** Front End
Developer · **Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

When `groupBy === 'category'`, render the (already-filtered/sorted) visible
list as **category sections** instead of one flat grid/list:

1. Reuse `SectionHeader` (`src/components/SectionHeader.jsx`) — kicker = the
   axis label (`Genre` for records / `Category` for books), title = the
   category value, count on the right. Wrap each section in
   `<section aria-labelledby={id}>` (the Floor pattern).
2. Render items under each header with the existing `Grid` / `ListView`
   (both view modes must work). Within-section order = the active sort (P0).
3. **"Other" bucket** last (P0). Sections with zero visible items never render
   a broken/empty block — they simply don't appear (or show a per-section
   empty line if P0 decides).
4. **Jump-to-category**: a compact index row / chips near the top (like the
   aisle chips) so long grouped views aren't a scroll marathon; keyboard + aria
   labelled (see T4).
5. Composes with search/filter/aisle — grouping is a presentation layer over
   `visibleItems`; a single-category aisle simply shows one section (P0 §7).

**Files.** `src/CollectionView.jsx` · `src/components/SectionHeader.css` (if
needed) · new section CSS in `src/App.css`.

**Acceptance criteria**
- [ ] Grouped view renders for records (Genre) and books (Category), grid +
      list, with search/filters/aisle active — **never throws** (no
      dark-screen path).
- [ ] Section headers are reachable by screen reader (`aria-labelledby`);
      jump-to-category works.
- [ ] No item is lost — uncategorized items visible under "Other".

**DoD:** lint + test + build pass. Consult the `testing` + `ergonomics-review`
skills.

---

## T4 — Ergonomics & accessibility pass (#133)

**Epic:** #127 · **Layer:** frontend/a11y · **Owner:** Front End
Developer + Ergonomics Reviewer · **Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

Accessibility/ergonomics pass over the grouped view:

1. **Section headers** — touch target ≥ 44px; sticky-vs-scroll decision from
   P0 §6 recorded; headers must not trap focus or block the jump-to-top
   control.
2. **Jump-to-category** — keyboard-operable, visible focus, `aria-label` per
   category (no color-only meaning).
3. **Contrast** — header text, counts, and chips ≥ 4.5:1 text / ≥ 3:1 UI on
   the dark `#16130F` base (the `--danger-bright` discipline in
   `src/index.css`).
4. **Screen reader** — section structure announced (`aria-labelledby`),
   counts announced or `aria-hidden` where decorative.
5. **No dark-screen regression** — grouped mode never throws on toggle, tab
   switch, or large collections.

**Files.** Grouped-view CSS · `src/CollectionView.jsx` (focus management) ·
verified against `marketing/mockups/theme-rooms/README.md` contrast table.

**Acceptance criteria**
- [ ] Ergonomics Reviewer signs off the grouped view (touch/keyboard/contrast/
      SR).
- [ ] No regressions in the flat grid/list modes.
- [ ] `npm run lint` + `npm test` + `npm run build` green.

**DoD:** per the `ergonomics-review` skill (read-only review + this fix pass).

---

## T5 — Tests: render regression, both rooms (#136)

**Epic:** #127 · **Layer:** tests · **Owner:** Tester ·
**Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

Vitest + Testing Library coverage per repo conventions (see `testing` skill):

1. **Render tests** for `CollectionView` in grouped mode: records (Genre
   sections) and books (Category sections), grid **and** list, with an active
   search/filter — assert sections render and **no throw** (the app has no
   ErrorBoundary — a throw is a dark screen).
2. **"Other" bucket** — items with no genre/category still render.
3. Helper coverage for `groupByAxis` lives in T1's unit tests; here the focus
   is the component wiring + browse-state persistence (`runout.browse.<kind>`
   seeded correctly).

**Files.** `src/CollectionView.test.jsx` (or a new `src/groupBy.test.jsx`)
· `src/utils/browse.test.js` (T1 additions).

**Acceptance criteria**
- [ ] Behavior-first test names; jsdom/localStorage quirks respected.
- [ ] `npm test` green; no unrelated coverage drops.
- [ ] `npm run lint` + `npm run build` green.

**DoD:** per the `testing` skill.

---

## T6 — i18n: `group.*` strings in 7 locales (#132)

**Epic:** #127 · **Layer:** i18n · **Owner:** Front End Developer +
native testers · **Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

Any new user-facing strings (Group toggle, axis label, "None"/off, the "Other"
bucket, jump-to-category aria labels) as `group.*` keys in
`src/i18n/locales/en.js` (master) + `catalog.copy` (records
`genre`-flavored / books `category`-flavored), then the **7 locales**
(EN/FR/NL/PT-BR/DE/ES/IT) via `marketing/localization-dictionary.md` (glossary
notes for the genre/category distinction). `[VALIDATE]` native pass before
ship.

**Files.** `src/i18n/locales/*.js` · `src/catalog.js` (copy bridge) ·
`marketing/localization-dictionary.md`.

**Acceptance criteria**
- [ ] Zero new hardcoded UI strings.
- [ ] EN master + 6 locales drafted; `[VALIDATE]` flags for native polish.
- [ ] `npm run lint` + `npm test` green.

**DoD:** per the `localization-plan.md` (native sign-off before ship).

---

## T7 — Docs + ADR (#129)

**Epic:** #127 · **Layer:** docs · **Owner:** Front End Architect ·
**Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

Write the ADR decided in P0 (`docs/adr/0005-group-by-category.md`) and update
`docs/functional.md` (grouped view + F-11 "filter by genre/category" extension:
grouping is the visible counterpart) and `docs/technical.md` (the
`groupByAxis` helper, the `runout.browse.<kind>.groupBy` state key, and the
"presentation-layer over visibleItems" rule).

**Files.** New `docs/adr/0005-group-by-category.md` · `docs/functional.md` ·
`docs/technical.md`.

**Acceptance criteria**
- [ ] ADR records decision + alternatives + the no-backend-change rule.
- [ ] Docs match shipped behavior (no invented details).
- [ ] `npm run lint` green.

**DoD:** docs-only task; no app-code edits.

---

## T8 — QA + ergonomics review of both rooms (#131)

**Epic:** #127 · **Layer:** tests/ergonomics · **Owner:** Tester +
Ergonomics Reviewer · **Branch:** `feat/group-by-category`

**Body**

Part of epic **#127 — "View items grouped by category"**.

End-to-end QA + ergonomics review of the grouped view in **both** rooms:

1. Records: Genre sections; Books: Category sections — grid + list, with
   search/filters/aisle/sort active; "Other" bucket present.
2. Large collections: many sections → jump-to-category still responsive, no
   jank on scroll, no layout thrash from sticky headers.
3. iOS Safari + offline (grouping is client-side — must work with no network).
4. DoD gates: `lint`/`test`/`build` green; no dark-screen path; copy via
   `catalog.copy`/i18n.

**Files.** Manual QA checklist + any fixes on the feature branch.

**Acceptance criteria**
- [ ] Both rooms pass; findings recorded as review comments, fixed on-branch.
- [ ] Ergonomics Reviewer sign-off (see `ergonomics-review` skill).

**DoD:** whole epic closes only when this passes.

---

## T9 — Marketing: grouped-view screenshots + copy (#135)

**Epic:** #127 · **Layer:** marketing · **Owner:** Marketing Manager ·
**Branch:** `feat/group-by-category` (assets only; no app-code edits)

**Body**

Part of epic **#127 — "View items grouped by category"**.

Once T3/T8 ship, produce **factual** marketing assets grounded in the shipped
behavior (no invented features/metrics):

1. **Screenshots** — a "your crate, but organized" grouped view (records by
   Genre, books by Category), dark `#16130F` + gold aesthetic; coordinate with
   the theme epic's per-room screenshots (T9 of epic #95 / #108) so both sets
   match.
2. **Copy bank** — grouped-view lines for the campaign/ASO (e.g. the
   record-store-in-your-pocket framing) in `marketing/campaign-copy-bank.md` +
   `marketing/copy-kit-halcova.md`, EN master + translation notes.
3. **Store listing** — where it strengthens the ASO screenshot set, list it in
   the app-store listing copy.

**Acceptance criteria**
- [ ] Assets only claim what the app does (verified against the shipped build).
- [ ] No internal details (no access codes/admin key/implementation internals).
- [ ] Handoff notes to Front End Developer for any `catalog.copy` keys if copy
      is meant to ship in-app.

**DoD:** per the Marketing Manager output format (deliverables under
`marketing/`).
