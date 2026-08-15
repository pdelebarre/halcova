# Epic — Theme per collection ("One home, two rooms") — Subtask issue bodies

**Owner:** Marketing Manager (coordination) · **Epic:** https://github.com/pdelebarre/halcova/issues/95
**Branch:** `feat/theme-per-collection` (off `main`, never `main`)
**Date:** 2026-08-15 · **Status:** Created, awaiting Phase 0 survey result before T3.

This file is the canonical copy of each subtask's issue body (mirrors the
`epic-user-feedback-subtasks.md` convention). Grounding for all copy:
`marketing/analysis-theme-per-collection.md`, `marketing/survey-theme-rooms.md`,
`marketing/mockups/theme-rooms/` (+ `README.md` contrast table), `src/index.css`,
`src/catalog.js`, `docs/design-redesign.md`.

## Subtask map

| # | Issue | Layer | Title |
| --- | --- | --- | --- |
| T1 | #106 | frontend | Neutral token layer + per-kind accent aliases |
| T2 | #110 | frontend | Catalog theme metadata + theme provider wiring |
| T3 | #104 | frontend | Books room: accent surfaces, ambient tint, scanner reticle ⛔ gated on Phase 0 |
| T4 | #109 | frontend | Contrast & accessibility pass |
| T5 | #102 | tests | Tests: theme helpers + no dark-screen regression |
| T6 | #105 | i18n | i18n: theme strings in 7 locales |
| T7 | #107 | docs | Docs + ADR: per-collection themes |
| T8 | #103 | tests | QA + ergonomics review of both rooms |
| T9 | #108 | marketing | Marketing: per-room screenshots + share assets |

Suggested order: T1 → T2 → (Phase 0 result) → T3 → T4 → T5 → T6 → T7 → T8 → T9.

---

## T1 — Neutral token layer + per-kind accent aliases (#106)

**Epic:** #95 · **Layer:** frontend · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** Introduce a neutral core token layer in `src/index.css` and add **per-kind accent aliases** (`--kind-records-accent`, `--kind-books-accent`), so records keeps today's look exactly and books can gain a room without a breaking visual rewrite. Keep the vinyl-named tokens working as the records aliases.

**Why.** The current tokens are vinyl-named (`--sleeve-black`, `--runout-gold`, …). A per-kind theme needs a neutral base + per-kind accent groups; the analysis (§5.3) scopes this before any accent is applied.

**Files.** `src/index.css` (tokens only — no component changes in this task).

**Acceptance / DoD.**
- `recordsCatalog` uses gold accent = today's look (visual no-op).
- Books accent aliases exist and are placeholder/neutral until T3 picks the Phase 0 color.
- Contrast comments updated per token (`marketing/mockups/theme-rooms/README.md`).
- `npm run lint` + `npm test` + `npm run build` green; no visual diff for records.

---

## T2 — Catalog theme metadata + theme provider wiring (#110)

**Epic:** #95 · **Layer:** frontend · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** Add **theme metadata to the catalog objects** in `src/catalog.js` (`recordsCatalog`/`booksCatalog` gain `theme: { accent, accentText, ambient }` or similar) and wire a small **theme context/provider** so the shared components in `CollectionView.jsx` consume the active kind's accent via CSS variables on the container.

**Why.** The catalog object already parameterizes everything per kind (components, copy, labels) — theme is the natural next layer. Keeping the shared flow untouched means one component set serves both rooms (cohesion requirement).

**Files.** `src/catalog.js` · a new theme context (e.g. `src/theme.jsx`) · `src/CollectionView.jsx` (set the CSS-variable scope) · `src/App.jsx` (provide context).

**Acceptance / DoD.**
- Switching the Records|Books tab swaps the accent scope with no remount/dark-screen risk.
- Records render is pixel-identical to today (gold).
- Defensive coding: theme object optional-chained so a missing field can never throw (no ErrorBoundary).
- `npm run lint` + `npm test` + `npm run build` green.

---

## T3 — Books room: accent surfaces, ambient tint, scanner reticle (#104)

**Epic:** #95 · **Layer:** frontend · **Branch:** `feat/theme-per-collection` (off `main`)
**GATE:** ⛔ **Do not merge before the Phase 0 survey result (#95 Blocking validations 1).**

**What.** Give the **books room** its distinct look per the approved mockups (`marketing/mockups/theme-rooms/`): accent surfaces (active category chips, filter/active states, focus-visible), a subtle **ambient tint** (≤ ~13% top gradient), and a **kind-specific scanner reticle** (ISBN framing for books vs EAN/UPC for records) — same scanner, kind-targeted overlay. Records stays gold/current.

**Why.** This is the actual "room": distinct accent + ambience per kind while the skeleton (header, tabs, toolbar, red Scan FAB, semantic colors) stays identical. The mockups are the source of truth for the accent.

**Files.** `src/components/FilterSheet.css` (+ active-chip pattern), toolbar/search focus styles, `src/components/ScannerModal.jsx` (reticle), ambient background in the collection view.

**Acceptance / DoD.**
- Accent + contrast match the chosen Phase 0 winner and `marketing/mockups/theme-rooms/README.md` (≥4.5:1 text / ≥3:1 UI on `#16130F`; oxblood requires two-tone if chosen).
- Semantic colors (danger/success/"already own") unchanged and identical across rooms.
- Scanner still decodes EAN-13/UPC/ISBN (F-01); reticle change is cosmetic.
- No dark-screen path on tab switch (no ErrorBoundary).
- `npm run lint` + `npm test` + `npm run build` green.

---

## T4 — Contrast & accessibility pass (#109)

**Epic:** #95 · **Layer:** frontend · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** Accessibility pass over the new theme: verify the chosen accent holds **≥ 4.5:1 (text) / ≥ 3:1 (UI)** on the dark `#16130F` base across all surfaces where it's used (chips, focus rings, reticle, ambient), and confirm **semantic colors stay global** (no color-only meaning: banners keep label+icon+text per `design-redesign.md`).

**Why.** The dark theme already documents this discipline (`--danger-bright` note in `src/index.css`). A second room must not lower the bar.

**Files.** `src/index.css` + any accent-using CSS, verified against `marketing/mockups/theme-rooms/README.md` contrast table.

**Acceptance / DoD.**
- Every accent usage passes the gate; any failing usage either gets a lighter text sibling or kraft text (documented).
- No regressions in existing contrast (records unchanged).
- `npm run lint` + `npm test` + `npm run build` green.

---

## T5 — Tests: theme helpers + no dark-screen regression (#102)

**Epic:** #95 · **Layer:** tests · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** Vitest + Testing Library coverage per repo conventions: unit tests for the theme helper/metadata (accent resolution, fallbacks), catalog theme keys on `recordsCatalog`/`booksCatalog`, and a render test that the shared `CollectionView` flow renders both rooms without throwing (the no-dark-screen guard).

**Why.** The app has **no ErrorBoundary** — a theme-switch regression unmounts React to a dark screen. Tests are the guard.

**Files.** `src/theme*.test.js(x)` (or `src/catalog.test.js` additions) + a shared-flow render test.

**Acceptance / DoD.**
- Behavior-first test names; jsdom/localStorage quirks respected.
- `npm test` green; no unrelated coverage drops.
- `npm run lint` + `npm run build` green.

---

## T6 — i18n: theme strings in 7 locales (#105)

**Epic:** #95 · **Layer:** i18n · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** Any new theme-related user-facing strings (e.g. a "room"/theme label if shipped) across the **7 locales** (EN/FR/NL/PT-BR/DE/ES/IT), via `localization-dictionary.md` + the locale files. Keep new strings to a minimum — theming is intentionally near copy-free.

**Why.** Cohesion rule: no user-facing copy hardcoded; everything through `catalog.copy` / i18n keys, native-passed per the localization plan.

**Files.** `src/i18n/locales/*.js` · `marketing/localization-dictionary.md` (if strings added).

**Acceptance / DoD.**
- Zero new hardcoded UI strings.
- If strings added: EN master + 6 locales drafted; `[VALIDATE]` flags for native polish.
- `npm run lint` + `npm test` green.

---

## T7 — Docs + ADR: per-collection themes (#107)

**Epic:** #95 · **Layer:** docs · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** Write the ADR that **reverses the "no color-theme change" non-goal** from `docs/design-redesign.md`, and update `docs/functional.md` (two rooms described) + `docs/technical.md` (token architecture) to match the shipped behavior.

**Why.** The analysis flagged this as a deliberate reversal of a prior decision — it needs an explicit ADR, not an incidental change.

**Files.** New `docs/adr/00XX-per-collection-themes.md` · `docs/functional.md` · `docs/technical.md` · `docs/design-redesign.md` (note the reversal).

**Acceptance / DoD.**
- ADR records decision, alternatives (A status quo / B one-home-two-rooms / C two themes), and the cohesion rules.
- Docs match shipped behavior (no invented details).
- No `src/` changes in this task.

---

## T8 — QA + ergonomics review of both rooms (#103)

**Epic:** #95 · **Layer:** tests · **Branch:** `feat/theme-per-collection` (off `main`)

**What.** QA + ergonomics review of the two rooms (per the `ergonomics-review` skill): dark-screen risk on tab switch, focus management (bottom sheets, chips, scanner), touch targets, contrast in both rooms, PWA/build behavior with the theme scope change.

**Why.** The app has **no ErrorBoundary** and the scanner is precached WASM — theme work must not regress either. A second room must pass the same ergonomic bar as today.

**Files.** Review only (read) + a QA report; findings filed back to T2–T4 if needed.

**Acceptance / DoD.**
- No dark-screen/crash in either room on tab switch, scan, or bottom-sheet open/close.
- Focus visible in both accents; touch targets ≥ 44px unchanged.
- `npm run build` (PWA) green — wasm precache intact.
- Report covers both rooms + records-no-change check.

---

## T9 — Marketing: per-room screenshots + share assets (#108)

**Epic:** #95 · **Layer:** marketing · **Branch:** `feat/theme-per-collection` (off `main`, marketing assets land under `marketing/`)

**What.** Once the rooms ship, produce **per-room marketing assets**: screenshots of the records room (gold) and books room (chosen accent), updated share-card/persona art, and a short campaign beat if the launch is still live.

**Why.** Themed rooms make screenshots and share art feel bespoke per passion — more save-worthy and platform-native on #vinyl and #bookstagram feeds (analysis §3.4).

**Files.** `marketing/` — screenshot set, share-card updates, optional social post(s).

**Acceptance / DoD.**
- All claims trace to shipped behavior; no invented features/metrics/testimonials.
- Uses the real shipped accent/theme (screenshots from the built app).
- No `src/` changes.
