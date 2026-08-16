# Spec — Free-tier guidance: onboarding + on-demand

- **Status:** Draft — for product/design review, not yet implemented
- **Owner:** Marketing Manager (handoff to Front End Developer)
- **Suggested branch:** `feat/free-tier-guidance`
- **Scope:** frontend only. No backend changes. All copy ships through `catalog.copy` / i18n — this document names the keys and touchpoints; it does not edit `src/` or `netlify/`.

---

## 1. Ground truth — what "free" actually is (verified in code)

Free tier is the plan `'free'`. Everything below must trace to these facts, or be
flagged `[VALIDATE]`.

| Fact | Source |
| --- | --- |
| The free plan caps **owned** items at **10 per collection** — Records and Books are counted separately. | `PLAN_LIMITS.free` (default 10, `RUNOUT_FREE_LIMIT`); `FREE_PLAN_CAP = 10` in `CollectionView.jsx`. **PO-confirmed 2026-08-15.** |
| The server is authoritative; the client cap only shapes the counter and disables the add UI. | `netlify/functions/_shared/plans.js` `planLimitFor()` |
| **Wishlist wants never count** toward the cap. Converting a wishlist item to owned **does** consume one spot (delta +1). | `netlify/functions/collection.js` lines 58–123 |
| Free members get the full flow: scan / search / manual add / cover OCR, duplicate detection, notes, filters, sort, stats, browse/aisles, saved views, PWA install + offline. | `docs/functional.md` feature inventory F-01 → F-26 |
| **Not** in free: uncapped cataloging and **Lending** (borrower, due dates, history) — both are Premium. | `paywall.reason.cap.body`, `paywall.reason.feature.body` |
| Records lookups need a personal **Discogs token**; Books lookups (Google Books) need none. First-run already routes new members to Books. | `docs/functional.md` §1; `App.jsx` C2.1 (#86) |
| Paid plans (`premium` / `lifetime` / `unlimited`) are uncapped and include lending. Consumer-facing name in copy is **"Premium"**, one-time. | `PAID_PLANS` in `App.jsx`; `paywall.priceLine` |

---

## 2. Design principles for free-tier guidance

1. **Never surprise with a wall.** The cap is stated upfront and approached
   gently *before* it's hit — the hard stop at 10 must feel expected, not punitive.
2. **Non-blocking by default.** Guidance never blocks the first win (the first
   scan/add). A paywall opens only when a *real action* is blocked (cap / lending).
3. **One truthful message per moment**, in the collector voice ("your crate" /
   "your shelf"). No invented metrics, prices, or scarcity claims.
4. **The cap is value-framing, not a threat.** "Your first 10, free forever"
   reads as a gift; "only 10 items" reads as a limit. Lead with the former.
5. **Onboarding and on-demand share the same words**, so the counter the user
   sees later is instantly recognizable from the note they saw on day one.

---

## 3. Requirements — onboarding (first run, empty state)

**Current state:** `EmptyState` renders `emptyTitle`, the three `emptySteps`,
`emptyTagline`, a Scan button, the records `noTokenHint` (after a
`SERVER_NO_TOKEN` signal), cover-scan + manual ghosts, and the "Try a sample"
path. It says **nothing about the free plan**.

| ID | Requirement | Behavior | Copy |
| --- | --- | --- | --- |
| **O-1** | State the free offer once, non-blocking, on first run | For free-plan members only, render a single quiet line under the steps/tagline (owner, paid, and demo visitors never see it). It must not require dismissal and must not cover the Scan button. | `plan.onboardNote` → *"Free plan: up to 10 per collection — no card, no expiry."* |
| **O-2** | Keep the guaranteed first win available | "Try a sample" stays reachable for free members on both tabs (no lookup, no token, no network). Existing keys unchanged. | `catalog.trySample*` (exists) |
| **O-3** | Make the token situation legible | Records: keep `noTokenHint` under Scan after a failed lookup. Books: no hint (token-free). First-run tab routing to Books stays (#86). | `catalog.noTokenHint` (exists) |
| **O-4** | Set the Lending expectation before it's discovered as an error | The first time a free member opens any item's detail sheet, the Lending control must already read as a *Premium* affordance (gated, upgrade CTA), not appear broken. | `paywall.reason.feature.*` (exists) |
| **O-5** | No paywall during onboarding unless a real action is blocked | The modal must never auto-open on first load; it opens only from the FAB-at-cap, a `PLAN_LIMIT` rejection, the Lending gate, or an explicit Upgrade tap. | — |

**Rule:** onboarding copy lives in the catalog `.copy` (crate vs shelf wording) or
i18n — never hardcoded in `EmptyState`.

---

## 4. Requirements — on-demand (while using the app)

**Current state:** a plan banner shows `plan.freeCounter` ("{count} of {cap}
items added") plus an Upgrade button; at 10/10 it adds `plan.atLimitHint` and the
FAB becomes gated (`plan.limitFab`) and opens the paywall (`reason: 'cap'`).
A server `PLAN_LIMIT` rejection fires `plan.limitToast` + the same paywall.
The Lending gate opens the paywall (`reason: 'feature'`).

| ID | Requirement | Behavior | Copy |
| --- | --- | --- | --- |
| **D-1** | Always-visible, accurate counter for free members | Keep `plan.freeCounter` (owned count, not the filtered view; wishlist excluded). Absent for owner/paid/demo. Add an accessible `aria-label` that includes "Free plan". | `plan.freeCounter` (exists) |
| **D-2** | **Approach the cap, don't just hit it (new)** | At **cap − 2 and cap − 1** (8 and 9 of 10), show a non-blocking near-limit hint in the plan banner — a function key so pluralization is safe. No modal, no toast; it replaces nothing, it *precedes* the at-limit hint. | `plan.nearLimitHint` → *"1 spot left on the free plan"* / *"2 spots left on the free plan"* |
| **D-3** | A clear, single hard stop at the cap | At 10/10: counter reads 10/10, `plan.atLimitHint` shows, FAB gated with `plan.limitFab` → paywall (`reason: 'cap'`). No doomed add is ever attempted client-side. | `plan.atLimitHint`, `plan.limitFab` (exist) |
| **D-4** | Server-rejection safety net | Any `PLAN_LIMIT` from the server (stale client, wishlist→owned convert at cap) shows `plan.limitToast` and opens the paywall (`reason: 'cap'`). | `plan.limitToast` (exists) |
| **D-5** | Lending is legibly Premium | Free member taps Lending in a detail sheet → paywall (`reason: 'feature'`). Never a generic error. | `paywall.reason.feature.*` (exists) |
| **D-6** | Voluntary upgrade is always one tap away | The plan-banner Upgrade button opens the paywall (`reason: 'upgrade'`, or `'expired'` when `planStatus === 'expired'`). | `paywall.*` (exists) |
| **D-7** | Wishlist is unlimited and must feel like a free gift | `[VALIDATE]` — optional. Wishlist empty state may add one factual line: wants are unlimited and don't use a spot. Flagged because it risks hoarding; keep it strictly factual if shipped. | `wishlist.freeNote` (new, optional) |

---

## 5. Copy keys

### New keys (to add)

| Key | Kind | Where | EN master | Notes |
| --- | --- | --- | --- | --- |
| `plan.onboardNote` | i18n | all 8 locales | `Free plan: up to 10 per collection — no card, no expiry.` | Rendered only for free members. "Per collection" matters (10 records **and** 10 books). |
| `plan.nearLimitHint` | catalog `.copy` function | both catalogs | `(remaining) => remaining === 1 ? '1 spot left on the free plan' : remaining + ' spots left on the free plan'` | Mirrors the `addedCount` function-override pattern; i18n `plan.nearLimitHint` is the fallback. |
| `plan.counterLabel` | i18n | all 8 locales | `Free plan: {count} of {cap} items added` | Accessible `aria-label` for the counter. `[VALIDATE]` with a11y reviewer. |
| `wishlist.freeNote` | catalog `.copy` | both catalogs | `Wants are unlimited and don't use a spot on your plan.` | **Optional** — `[VALIDATE]` (see D-7). |

### Existing keys to keep unchanged (reference)

- `plan.freeCounter`, `plan.atLimitHint`, `plan.limitToast`, `plan.limitFab`
- `paywall.title/body/cta/secondary/priceLine`, `paywall.reason.{cap,feature,upgrade,expired}.*`
- `catalog.emptyStep1/2/3`, `catalog.noTokenHint`, `catalog.trySample`, `catalog.trySampleNote`, `catalog.trySampleBadge`, `catalog.trySampleCta`

### Translation / localization notes

- All 6 non-EN locales (`de`, `es`, `fr`, `it`, `nl`, `pt-BR`) **require
  native-tester sign-off** before they ship, per `marketing/localization-plan.md`.
  The EN master is translation-ready; ship the EN master first, then the pass.
- "spot" is colloquial EN — hand translators a glossary note suggesting a
  natural collector equivalent per language (e.g. "place" / "Platz" / "lugar"),
  not a literal translation.
- "no card, no expiry" must be checked per locale for payment-language
  conventions; do not claim anything about payment that a locale's users would
  read as a legal promise — keep it conversational.

---

## 6. Touchpoints (Front End Developer — do not edit app code in this pass)

| File | Change |
| --- | --- |
| `src/CollectionView.jsx` | Render `plan.nearLimitHint` at cap−2 / cap−1 inside the plan banner; wire `plan.counterLabel` aria-label; render `plan.onboardNote` (or pass a flag) when the collection is empty. |
| `src/components/EmptyState.jsx` | Render the free-plan note under the steps for free members (new prop, guarded like `noToken`). |
| `src/components/PaywallModal.jsx` | No change — already parameterized by `kind` + `reason`. |
| `src/catalog.js` | New `.copy` keys on **both** `recordsCatalog` and `booksCatalog` (function override for `nearLimitHint`; strings for the rest). |
| `src/i18n/locales/*.js` | New `plan.*` keys in all 8 locales; `wishlist.freeNote` if D-7 ships. |
| `src/__tests__/free-tier-ux.test.jsx` | Add cases: near-limit hint at 8 and 9, absent at 7 and 10; onboard note only for free members; counter aria-label. |
| `src/__tests__/empty-state-onboarding.test.jsx` | Add case: onboard note renders for free, absent for owner/demo. |

---

## 7. Journey map (the two moments in one glance)

| Moment | User needs to know | Today | Proposed | Key |
| --- | --- | --- | --- | --- |
| First open, empty crate/shelf | "What do I do, and what's free?" | 3 steps + Scan; no mention of the plan | + one quiet free-plan line under the steps | `plan.onboardNote` |
| First scan fails (records) | "Why can't I scan?" | Token hint after `SERVER_NO_TOKEN` | unchanged | `catalog.noTokenHint` |
| 8 or 9 of 10 owned | "I'm nearly full — what happens?" | counter only, then a hard stop | + non-blocking "N spots left" | `plan.nearLimitHint` |
| 10 of 10 owned | "I'm full — how do I keep going?" | counter + hint + gated FAB → paywall | unchanged | `plan.atLimitHint` / `plan.limitFab` |
| Server rejects an add | "Why didn't that save?" | toast + paywall | unchanged | `plan.limitToast` |
| Taps Lending | "Why is this locked?" | paywall (feature) | unchanged | `paywall.reason.feature.*` |
| Taps Upgrade | "What does it cost?" | paywall (upgrade) | unchanged | `paywall.reason.upgrade.*` |

---

## 8. DoD (for the Front End Developer)

- `npm run lint && npm test && npm run build` green; updated tests in
  `free-tier-ux.test.jsx` and `empty-state-onboarding.test.jsx`.
- All new copy ships through `catalog.copy` / i18n — zero hardcoded strings.
- No dark-screen risk: every new render path guarded (`Array.isArray`, optional
  chaining, fallback strings) like the existing `emptySteps` / `noToken` guards.
- No secrets / access codes / internal implementation details in any user-facing copy.
- Feature branch (`feat/free-tier-guidance`), never `main`.

---

## 9. Claims needing product validation / owner decisions

- **✅ Confirmed (PO, 2026-08-15): the cap is per collection** — 10 records AND
  10 books, counted separately. The copy may say "up to 10 per collection" in
  public. Resolved.
- **✅ Confirmed (owner, 2026-08-16, via #139): "no card, no expiry".** Keep the
  wording — the free plan has no expiry and no payment. Do not promise anything
  about payment in other locales that reads as a legal guarantee.
- **✅ Confirmed (owner, 2026-08-16, via #139): Plan naming.** Keep consumer copy
  on "Premium" (one-time). Internal enums (`premium` subscription, `unlimited`
  grandfathered) unchanged.
- **✅ Confirmed (PM decision on owner delegation, 2026-08-16, via #139): Near-limit
  thresholds.** Keep the two-step **8 and 9 of 10** (cap−2 / cap−1, `FREE_PLAN_NEAR_LIMIT
  = 2`) — chosen by the PM from the owner's "between 8 and 12" band; already shipped
  in PR #148.
- **✅ Confirmed (owner, 2026-08-16, via #139): Wishlist free note (D-7) — SHIP.**
  Not yet implemented — tracked as ticket "Free-tier guidance T6" (epic #138).
- **✅ Confirmed (owner, 2026-08-16, via #139): Counter aria-label wording.** Keep
  `plan.counterLabel` ("Free plan: {count} of {cap} items added") — ergonomics pass OK.
