# Backlog grooming — launch-prioritized handoff for the Project Manager

**Groomed:** 2026-08-15 · **By:** Marketing Manager · **Applies to:** repo `pdelebarre/halcova`
**Anchor:** public launch campaign `marketing/campaign-viral-launch.md` — Phase 1 starts **Mon 2026-08-17**; Phase 3 (name reveal) ~**Aug 27–29**; Phase 4 (open) ~**Aug 30+**.
**Labels added on GitHub:** `priority:P0` / `priority:P1` / `priority:P2` / `blocked` (applied to every open ticket).

> Everything below is grounded in the real product and the campaign plan. Anything marked
> `[VALIDATE]` or `[owner decision]` needs the owner before it ships — nothing invented.

---

## 0. Grooming findings (read this first)

1. **The code rename is ALREADY SHIPPED.** The public brand is **Halcova** in code: `index.html`, `vite.config.js`, wordmarks (`Header`, `AuthScreen`, `CreditModal`), `PersonaCard`, and all 8 locale files. `Runout`/`Hokan` survive only as internal names (`RUNOUT_*` env vars, `runout-*` blob stores, DB name). **Do not create or schedule a "rename" dev ticket** — `marketing/README.md` open item 4 is stale and should be ticked off.
2. **The real launch gates are NOT in the backlog** — they were marketing-doc open items. Three were created today as tickets: **#119** (icon with barcode), **#120** (legal/domain/handles), **#121** (landing page + Request access + UTM/analytics). These are the true P0s.
3. **Three gamification tickets were shipped but never closed** — #45, #50, #44 shipped in PR #62 (merged 2026-08-14). Closed in this grooming pass; epic #43's remaining work is #47 (Phase 2) and #49 (Phase 3).
4. **Phase 1–2 of the campaign are name-free and safe to run now** — the app does not need a public URL until Phase 4. This gives ~2 weeks of runway to clear the P0 gates without panic.

---

## 1. Priority map (what the PM should take over)

### 🔴 P0 — Launch blockers (clear before Phase 3 reveal ~Aug 27 / Phase 4 open ~Aug 30)

| Ticket | What | Blocks | Notes |
| --- | --- | --- | --- |
| **#119** | Halcova icon **with barcode element** → PNGs in `public/` (brief `marketing/brief-halcova-icon.md`) | Phase 3 reveal | Dispatch to UI/UX Expert; PWA manifest + apple-touch wiring |
| **#120** | **Legal/domain/handles** check for "Halcova" (trademark EN/FR/NL/PT-BR/DE/ES/IT, `halcova.app`, @halcova handles) | Phase 3 reveal | `[VALIDATE]` — owner decision; `halcova.app` already referenced by mailer + Stripe success URLs |
| **#121** | **Landing page live + Request access + UTM/analytics** | Phase 4 open | Deploy via `netlify deploy --build`; copy in `campaign-landing-page.md`; UTM per channel; count visits+requests; admin approval waves |

### 🔴 P0 — Epic **#84 Activation & lending polish** (the first-run experience launch traffic hits)

| Ticket | What | Priority | Notes |
| --- | --- | --- | --- |
| **#86** | C2 — Token-free first-run tab default | P0 | Cold-start fix; a fresh member's first scan works immediately |
| **#88** | C2 — Empty-state onboarding + records token hint | P0 | First-win onboarding; copy `emptyStep1/2/3`, `noTokenHint` |
| **#89** | C1 — Add & scan next loop + momentum toast | P0 | Bulk cataloging; "scan a stack" is the demo moment |
| **#87** | C1 — Keep the camera warm on iOS | P0 · **blocked** | Gated on device validation (no re-permission flash, no drain) |
| **#85** | C2 — Try-a-sample barcode | P0 · **blocked** | Gated on validation (stable release ID + prevent-save mechanism) |
| **#90** | A5 — Contact actions + Remind button | P1 | Retention (Web Share / clipboard, offline) |
| **#92** | A5 — Due-date presets, overdue surfacing, history note | P1 | |
| **#117** | A5 — On-loan card icon opens the lend card | P1 | Nested-button ban is a hard a11y requirement |
| **#118** | i18n — Loan-icon manage labels | P1 | Depends on #117 copy keys |
| **#94** | Bug — `collectionLabel` interpolation DE/IT | P1 | Small correctness fix; do early (blocks clean DE/IT copy) |
| **#93** | i18n — Wire C1/C2 + A5 keys across 7 locales | P1 · **blocked** | Blocked on native-tester sign-off for 6 non-EN locales |
| **#91** | QA + DoD gates (whole epic) | P1 | Closes epic #84 |

**Epic ordering:** C2 first (`feat/empty-state-onboarding`: #86 → #88), then C1 (`feat/scan-add-loop`: #89, #87), then A5 (`feat/lending-polish`: #94 → #90 → #92 → #117 → #118), i18n across the branches, #91 last.

### 🟠 P1 — Launch-month (first 2–3 weeks after the open)

**Epic #74 — In-app feedback** (the "we read everything" beat + makes `error.reported` truthful). Do in T-order: **#81** T1 DB → **#76** T2 Blobs → **#80** T3 function → **#77** T4 client → **#82** T5 modal → **#75** T6 admin inbox → **#79** T7 i18n → **#78** T8 QA/security → **#83** T9 marketing. Branch `feat/feedback`.

**Epic #95 — Theme per collection ("One home, two rooms")** (supports the "two loves, one place" clue + per-room screenshots #108). T1 **#106** and T2 **#110** are **unblocked and records-identical** (start now); **#104** T3 is **blocked on the Phase 0 survey result** (accent winner not yet decided — mockups exist in `marketing/mockups/theme-rooms/`); then #109 T4 → #102 T5 → #105 T6 → #107 T7 → #103 T8 → #108 T9. Branch `feat/theme-per-collection`.

### 🟡 P2 — Post-launch (next 1–3 months)

**Epic #96 — "Found it here" sightings** (community wave after launch; privacy-sensitive). Entry point **#98** P0 decisions + ADR (grid cell, place-name vs geocoder, map provider, gating, scope, legal) → then T1 **#101** → T2 **#97** → T3 **#100** → T4 **#99** → T5 **#111** → T6 **#113** → T7 **#114** → T8 **#115** → T9 **#116** → T10 **#112**. Branch `feat/wishlist-sightings`. **Not launch-critical.**

**Epic #43 — Halcova Arcade (remaining):** **#47** Phase 2 Crate Digger Quests (P2) · **#49** Phase 3 Social & Seasonal (P2 · **blocked** on product decision re identity/opt-in sharing). Phase 1 already shipped.

**Epic #37 — Scaling Phase 2 (Spring Boot):** P2, long-term infra for ~100k–1M users. **Do not start before launch**; revisit with real traffic numbers. Keep ADR-0002 as the reference.

---

## 2. Suggested take-over plan for the PM agent

1. **This week (before Aug 17 — campaign Phase 1 starts):** dispatch **#119** (icon) and **#120** (legal/domain) so Phase 3 gates are in motion; get owner decision on the legal gate.
2. **Week of Aug 17–23:** run epic **#84** C2 → C1 (activation first), and start **#121** (landing page) so it's deploy-ready before Phase 4. Confirm the native-tester pass for #93 and device validation for #85/#87 in parallel.
3. **Week of Aug 24–30 (Phase 3/4):** clear remaining P0 gates (#121 live), then launch-month P1 epics: **#74** feedback (so the owner can hear from launch traffic) and **#95** theme (T1/T2 unblocked; T3 once the survey lands).
4. **After launch:** P2 — #96 sightings, #43 Phase 2/3, #37 scaling, each gated on the decisions noted above.

**DoD for the PM on each ticket:** the ticket bodies already carry acceptance criteria + DoD (`lint/test/build`, no dark-screen, copy via `catalog.copy`/i18n). Feature work stays on feature branches; never `main`.

---

## 3. Claims needing product validation / owner decisions

- **#120 legal gate** — trademark/domain/handles results are unknown until checked; do not claim "trademarked".
- **#121 landing decision** — separate static landing page vs. the app's existing request-access flow as the landing; owner picks.
- **#104 theme T3 accent** — the Phase 0 survey winner is not yet decided; T3 must not pick a color arbitrarily.
- **#85 sample barcode** — needs a real, stable Discogs release + EAN and an ISBN, plus a prevent-save mechanism.
- **#87 warm camera** — needs iOS device validation evidence recorded in the ticket before merge.
- **#93 / #79 / #115 i18n** — all 6 non-EN locales need native-tester sign-off before they ship (per `marketing/localization-plan.md`).
- **#49 gamification Phase 3** — blocked on a product decision about identity/opt-in sharing; do not implement on assumption.
- **#96 sightings** — every privacy decision is the #98 ADR; no "instant alerts"/exact-location claims anywhere.

---

## 4. Hygiene already done in this pass (GitHub)

- Created **#119, #120, #121** (the missing launch-gate tickets).
- Added `priority:P0/P1/P2` to **all** open epics + subtasks; added `blocked` to #85, #87, #93, #104, #49.
- Closed **#45, #50, #44** (gamification Phase 1, shipped via PR #62) and commented the epic #43.
- **Not done here (deliberately):** no app-code edits; no invented metrics/testimonials; no secrets/access-code/internal details in any copy.
