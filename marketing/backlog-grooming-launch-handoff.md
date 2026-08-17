# Backlog grooming — launch-prioritized handoff for the Project Manager

**Groomed:** 2026-08-15 · **By:** Marketing Manager · **Applies to:** repo `pdelebarre/halcova`
**Anchor:** public launch campaign `marketing/campaign-viral-launch.md` — Phase 1 starts **Mon 2026-08-17**; Phase 3 (name reveal) ~**Aug 27–29**; Phase 4 (open) ~**Aug 30+**.
**Labels added on GitHub:** `priority:P0` / `priority:P1` / `priority:P2` / `priority:P3` / `blocked` (applied to every open ticket; re-groomed 2026-08-15 with the P3 icebox tier).

> Everything below is grounded in the real product and the campaign plan. Anything marked
> `[VALIDATE]` or `[owner decision]` needs the owner before it ships — nothing invented.

---

## 0. Grooming findings (read this first)

1. **The code rename is ALREADY SHIPPED.** The public brand is **Halcova** in code: `index.html`, `vite.config.js`, wordmarks (`Header`, `AuthScreen`, `CreditModal`), `PersonaCard`, and all 8 locale files. `Runout`/`Hokan` survive only as internal names (`RUNOUT_*` env vars, `runout-*` blob stores, DB name). **Do not create or schedule a "rename" dev ticket** — `marketing/README.md` open item 4 is stale and should be ticked off.
2. **The real launch gates are NOT in the backlog** — they were marketing-doc open items. Three were created today as tickets: **#119** (icon with barcode), **#120** (legal/domain/handles), **#121** (landing page + Request access + UTM/analytics). These are the true P0s.
3. **Three gamification tickets were shipped but never closed** — #45, #50, #44 shipped in PR #62 (merged 2026-08-14). Closed in this grooming pass; epic #43's remaining work is #47 (Phase 2) and #49 (Phase 3).
4. **Phase 1–2 of the campaign are name-free and safe to run now** — the app does not need a public URL until Phase 4. This gives ~2 weeks of runway to clear the P0 gates without panic.
5. **Security is now the top priority (owner direction, 2026-08-17).** Seven SEC epics (#175, #185, #193, #201, #207, #214, #228) were filed on 2026-08-17 and are **not yet in any milestone**. The milestone plan (§1.5) has been adapted to put them ahead of every product/marketing epic — identity/session → tenant isolation → API/web → data protection → payments/IR — with only the campaign-dated launch gates (M1) staying ahead of them. Product epics #84, #74, #95 are already closed; #138/#96/#127/#47 move to M6.

## Delivery status (2026-08-15, PM sweep)

P0 code shipped and merged (tickets closed as completed):
- ✅ **#119** icon with barcode — merged via **PR #124** (`feat/halcova-icon`) · *soft gate: Marketing approval of the rendered mark remains for the Phase 3 reveal*
- ✅ **#89** C1 add & scan next — merged via **PR #125** (`feat/scan-add-loop`)
- ✅ **#86** C2 token-free first-run tab + **#88** C2 empty-state onboarding — merged via **PR #126** (`feat/empty-state-onboarding`)

🟡 **#85** try-a-sample — validation resolved, implemented, **in PR #145** (`feat/try-sample-barcode`); merge pending.
🟡 **#87** warm camera — mechanism merged via **PR #125**, but **iOS device validation is still outstanding** (ticket kept open; record no re-permission flash / no drain before closing).

Still open P0 launch gates: **#120** (legal/domain — owner decision) · **#121** (landing page + Request access + UTM — owner deploy) · **merge PR #145** (#85) · **#87** device validation.

---

## 1. Priority map (what the PM should take over)

### 🔴 P0 — Launch blockers (clear before Phase 3 reveal ~Aug 27 / Phase 4 open ~Aug 30)

| Ticket | What | Blocks | Notes |
| --- | --- | --- | --- |
| ~~**#119**~~ ✅ | Halcova icon **with barcode element** → PNGs in `public/` (brief `marketing/brief-halcova-icon.md`) | Phase 3 reveal | **DONE 2026-08-15** — merged via PR #124; Marketing approval of the final mark still pending (soft gate) |
| **#120** | **Legal/domain/handles** check for "Halcova" (trademark EN/FR/NL/PT-BR/DE/ES/IT, `halcova.app`, @halcova handles) | Phase 3 reveal | `[VALIDATE]` — owner decision; `halcova.app` already referenced by mailer + Stripe success URLs |
| **#121** | **Landing page live + Request access + UTM/analytics** | Phase 4 open | Deploy via `netlify deploy --build`; copy in `campaign-landing-page.md`; UTM per channel; count visits+requests; admin approval waves |

### 🔴 P0 — Epic **#84 Activation & lending polish** (the first-run experience launch traffic hits)

| Ticket | What | Priority | Notes |
| --- | --- | --- | --- |
| ~~**#86**~~ ✅ | C2 — Token-free first-run tab default | P0 | **DONE** via PR #126 |
| ~~**#88**~~ ✅ | C2 — Empty-state onboarding + records token hint | P0 | **DONE** via PR #126 |
| ~~**#89**~~ ✅ | C1 — Add & scan next loop + momentum toast | P0 | **DONE** via PR #125 |
| **#87** 🟡 | C1 — Keep the camera warm on iOS | P0 · **blocked** | Impl merged via PR #125; **device validation outstanding** (keep open until recorded) |
| **#85** 🟡 | C2 — Try-a-sample barcode | P0 · **blocked** | Validation resolved; impl in **PR #145** — merge pending |
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

**Epic #138 — Free-tier guidance** (onboarding free-plan note + on-demand near-limit hint; launch-adjacent — the free plan is the entry point): **#139** P0 decisions → **#143** T1 → **#144** T2 → **#141** T3 i18n → **#140** T4 tests → **#142** T5 QA. Branch `feat/free-tier-guidance`.

### 🟡 P2 — Post-launch (next 1–3 months)

**Epic #96 — "Found it here" sightings** (community wave after launch; privacy-sensitive). Entry point **#98** P0 decisions + ADR (grid cell, place-name vs geocoder, map provider, gating, scope, legal) → then T1 **#101** → T2 **#97** → T3 **#100** → T4 **#99** → T5 **#111** → T6 **#113** → T7 **#114** → T8 **#115** → T9 **#116** → T10 **#112**. Branch `feat/wishlist-sightings`. **Not launch-critical.**

**Epic #43 — Halcova Arcade (remaining):** **#47** Phase 2 Crate Digger Quests (P2). Phase 1 already shipped; **#49** Phase 3 moved to **P3** (below).

**Epic #127 — View items grouped by category** (grouped browse, created by the parallel session): **#128** P0 decisions + ADR → **#130** T1 grouping helper → **#137** T2 toolbar Group control → **#134** T3 sectioned render → **#133** T4 ergonomics → **#132** T6 i18n → **#129** T7 docs → **#136** T5 tests → **#131** T8 QA → **#135** T9 marketing. Branch `feat/group-by-category`. ⚠️ Shares the working tree with the P0/P1 work — coordinate merges (touches CollectionView/locales).

### ⚪ P3 — Icebox (no scheduled date; revisit with real numbers/decisions)

- **#37 Scaling Phase 2 (Spring Boot)** — long-term infra for ~100k–1M users; do not start before launch; keep ADR-0002 as reference.
- **#49 Gamification Phase 3 (Social & Seasonal)** — blocked on a product decision about identity/opt-in sharing.

---

## 1.5 Milestones (adapted by the Project Manager, 2026-08-17 — security-first)

> **Priority override:** the seven **SEC epics (#175, #185, #193, #201, #207, #214, #228)** are now the
> top of the queue and outrank every product/marketing epic. The hard launch gates in M1 stay (they are
> campaign-dated), but everything after the open is **security-first**: identity/session → tenant
> isolation → API/web → data protection → payments/IR → then product resumes. Product epics #84, #74
> and #95 are already closed (see §0), so M2/M3 no longer hold product scope.

### M1 — Launch-ready + Security foundations · target **Wed 2026-08-26** (before the Phase 3 reveal)
- **Goal:** every Phase 3/4 gate green **and** the cheap security force-multipliers in place so all later work is reviewed under security rules.
- **Launch scope (hard gates, unchanged):** #120 legal/domain (owner) · #121 landing + Request access + UTM (owner) · merge **PR #145** (#85) · record #87 device validation · i18n sign-off for shipped keys (#93 partial).
- **Security scope (parallel — skill/config only, zero launch risk):** SEC-EPIC-7 governance #222 (mandatory security review gate) → #224 (strengthen multi-tenant skill) → #223 (auditor-skill hardening) → #225 (PWA/offline/Data skill reqs) → #226 (release checklist). SEC-EPIC-5 quick wins #210 (secret scanning, P0) · #208 (dependency/SCA scanning) · #209 (CodeQL/SAST) — enable in **advisory** mode so the launch branch is not blocked mid-campaign.
- **Exit:** reveal + open gates clear; app live on the stable URL; **security review is a mandatory agent gate**; scanning active (advisory).
- **Risks:** owner availability for #120/#121; physical device for #87; keep CI scanning non-blocking during launch.

### M2 — Security: Identity & session hardening · target **Aug 30 – Sep 19** (replaces "Open the doors")
- **Goal:** replace long-lived bearer access codes with server-managed sessions; remove credentials from the browser; eliminate the global admin key.
- **Scope:** SEC-EPIC-1 (#175): #176 replace access-code-as-session (P0) → #177 drop localStorage credentials (P0) → #180 remove prod admin-key fallback (P0) → #181 role-based admin authz (P0) → #184 auth takeover/replay regression tests (P0) → #178 short-lived sessions/rotation → #179 server-side revocation → #182 magic-link hardening → #183 passkeys/SiWA evaluation.
- **Exit:** no credential material in localStorage; sessions short-lived + revocable server-side; no admin-key fallback in prod; admin actions are role-authorized; takeover/replay suite green.
- **Risks:** largest refactor of the program — needs its own branch (`feat/security-identity`), full Tester pass, and touches `src/api/auth.js`, `netlify/functions/auth.js`/`admin.js`, `_shared/*`; never leak codes/keys.

### M3 — Security: Tenant isolation & object authorization · target **Sep 22 – Oct 10**
- **Goal:** guarantee every collection object is accessible only to its owner/authorized tenant, server-side.
- **Scope:** SEC-EPIC-2 (#185): #186 authenticated tenant context (P0) → #187 enforce `owner_id` on every object op (P0) → #189 IDOR/cross-tenant penetration tests (P0) → #190 PostgreSQL row-level security (P0) → #188 eliminate mass assignment → #191 server-side plan/feature authz → #192 offline tenant isolation + account-switching tests.
- **Exit:** tenant identity resolved server-side on every request (never trusted from the browser); `owner_id` enforced on GET/PUT/DELETE + lending/reviews; RLS policies live + tested; IDOR suite green.
- **Risks:** depends on the Postgres data layer (ADR-0002 Phase 1) being authoritative; #190 needs `db/migrations/` policies + migration-safety tests.

### M4 — Security: API/web, data protection & supply-chain completion · target **Oct 13–31**
- **Goal:** harden every endpoint, make Postgres the single authoritative store, and make CI gates blocking.
- **Scope:** SEC-EPIC-3 (#193): #194 schema validation → #195 request/payload size limits → #196 stored-XSS audit → #197 security headers (CSP/HSTS/…) → #198 CSRF for cookie sessions → #199 endpoint-specific rate limits → #200 safe error responses. SEC-EPIC-4 (#201): #202 remove Postgres→Blobs production fallback (P0) → #203 encryption/backup/recovery docs → #205 PWA cache security regression tests → #206 user-data deletion/revocation → #204 data classification/retention. SEC-EPIC-5 remainder: #211 pin GitHub Actions → #213 security CI merge gate (flip to **blocking**) → #212 SBOM per release.
- **Exit:** schema-validated + size-limited + header'd endpoints; no silent PG→Blobs fallback (controlled 503 + alert); PWA caches never hold another tenant's data; SBOM + blocking SAST/secret/dependency gates.
- **Risks:** #198 CSRF depends on the session model from M2; #202 depends on Postgres being fully authoritative (ADR-0002 Phase 1); CI flip can surface findings — plan remediation SLAs.

### M5 — Payments, monitoring & incident response · target **Nov 3–21**
- **Goal:** harden the live payment path and stand up security telemetry + incident readiness.
- **Scope:** SEC-EPIC-6 (#214): #215 Stripe webhook hardening — raw-body signature, event-type validation, idempotency/replay protection (P0) → #216 bind checkout status to authenticated context → #217 SSRF regression suite for the Discogs/Books proxies → #218 security audit events → #219 secret/PII-safe logging policy → #221 incident-response runbook → #220 anomaly detection/alerting.
- **Exit:** webhook verifies signatures on raw bodies + rejects forged/replayed events; checkout status bound to the authenticated user; audit events + IR runbook in place; no secrets/PII in logs.
- **Risks:** needs real Stripe test keys/webhook endpoint; alerting (#220) may need a Netlify log drain — scope with the Netlify Backend agent.

### M6 — Product resumes (post-security) · target **Dec+**
- **Goal:** the product/marketing backlog resumes only after the security program clears.
- **Scope:** Epic #138 Free-tier guidance (remaining #139–#144) · Epic #96 Sightings (#97–#116, start #98 privacy ADR) · Epic #127 Grouped browse (#128–#137) · Epic #43 Phase 2 (#47).
- **Exit:** free-tier guidance live; sightings privacy ADR + feature live; grouped browse shipped; Phase 2 quests shipped.
- **Risks:** shared-tree collisions with #127 (CollectionView/locales); #98 owner/security decisions; **all product work now runs under the M1 security gate**.

### M7 — Icebox (unscheduled)
- **#37 Scaling Phase 2 · #49 Gamification Phase 3** — revisit with real traffic/product decision; no date.

---

## 2. Suggested take-over plan for the PM agent (adapted 2026-08-17 — security-first)

1. **This week (before Aug 17 — campaign Phase 1 starts):** dispatch **#120** (legal/domain) and **#121** (landing) so Phase 3 gates are in motion; get owner decision on the legal gate. Kick off the M1 security foundations in parallel: SEC-EPIC-7 governance (#222 → #224 → #223 → #225 → #226) and SEC-EPIC-5 advisory scanning (#210, #208, #209) — skill/config work, no launch risk.
2. **Week of Aug 17–23:** merge **PR #145** (#85) and record #87 device validation; confirm native-tester pass for #93; keep #121 deploy-ready before Phase 4. Do not start product epics — security is now ahead of them.
3. **Week of Aug 24–30 (Phase 3/4):** clear remaining P0 gates (#121 live), then begin **SEC-EPIC-1** identity/session hardening (#175) on `feat/security-identity` — this is the critical-path security epic and must start as soon as the launch is out.
4. **After launch (security-first):** SEC-EPIC-1 → SEC-EPIC-2 → SEC-EPIC-3 + SEC-EPIC-4 → SEC-EPIC-6 + SEC-EPIC-5 remainder → product resumes (M6). Each security epic is gated on its own review + regression tests; product epics (#138, #96, #127, #47) do not start until the security program clears.

**DoD for the PM on each ticket:** the ticket bodies already carry acceptance criteria + DoD (`lint/test/build`, no dark-screen, copy via `catalog.copy`/i18n). Feature work stays on feature branches; never `main`. Every security ticket additionally requires Security Auditor sign-off and negative regression tests (authz/IDOR/replay where relevant).

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

## 4. Hygiene already done (GitHub)

- Created **#119, #120, #121** (the missing launch-gate tickets); **#85** implemented in **PR #145**.
- Added `priority:P0/P1/P2/P3` to **all** open epics + subtasks (P3 icebox: #37, #49); `blocked` on #85, #87, #93, #104, #49, #141.
- Closed **#119, #89, #86, #88** (shipped) and **#45, #50, #44** (gamification Phase 1) — commented epics #43, #84, #85.
- Aligned the parallel session's new epics **#127** (P2) and **#138** (P1) into the same priority scheme.
- **Not done here (deliberately):** no app-code edits; no invented metrics/testimonials; no secrets/access-code/internal details in any copy.
