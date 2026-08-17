# Subtasks — Epic: Admin dashboard & pending-request visibility

Paste each section below into its own GitHub issue. Link every issue to the
epic (`marketing/epic-admin-dashboard.md`) and add the suggested labels. Work on
branch `feat/admin-dashboard` (off `main`, never `main`) — see the
`feature-branching` skill. Build this epic **before**
`marketing/epic-usage-analytics.md` (which extends the same Dashboard tab).

Suggested labels: `epic` (the epic itself), `backend`, `frontend`, `i18n`,
`qa`, `security`, `enhancement`, `admin`.

---

## T1 — Backend: `?dashboard=1` counts block on the admin GET

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/admin-dashboard`

**Body**

Extend `netlify/functions/admin.js` so the owner can fetch aggregate dashboard
counts with **no new endpoint and no new data collection** — everything already
exists in the `users` / `requests` / `items` / `feedback` / `reviews` tables.

1. When `GET /admin?dashboard=1`, append a `counts` object to the existing
   response (the plain `GET /admin` payload is unchanged):
   `pendingRequests`, `members { total, active, disabled }`,
   `signups { today, thisWeek, thisMonth, total }`, `plans` (free/premium/
   lifetime/unlimited), `collections { records, books }` (owned item totals by
   kind), `feedback { open, in_progress, done, wontfix, duplicate, total }`,
   `reviews { total, published, pending, hidden }`. (See epic §4.1.)
2. Compute aggregates over the existing repository (`getRepository()`) —
   Postgres SQL when configured, the Blobs fallback otherwise (mirror how the
   admin list already works on both backends).
3. **Aggregates only** — no user ids, emails, names, IPs, codes. `publicUser`
   already strips codes; the counts block must never carry identity fields.
4. The existing `requireAdmin` gate already runs on this endpoint — keep it; do
   **not** weaken it. Verify member/demo/anonymous still get 401/403.

**Acceptance criteria**
- [ ] `GET /admin?dashboard=1` returns the counts block; `GET /admin` (no param)
      is byte-for-byte compatible with today.
- [ ] Counts are correct on Postgres **and** Blobs backends.
- [ ] No identity/PII fields in the response.
- [ ] Endpoint tests: counts shape, 401/403 for non-admin, `?dashboard=1` vs
      plain parity, junk params ignored (never 500).

**DoD:** lint + test pass. Consult the `netlify-collection` + `auth-access`
skills.

---

## T2 — Frontend: Dashboard tab + stat-card system in AdminPanel

**Labels:** `frontend` · **Owner:** Front End Developer · **Branch:** `feat/admin-dashboard`

**Body**

Add a **Dashboard** tab to `src/AdminPanel.jsx` (`members | feedback |
dashboard`) rendering aggregate stat cards from `GET /admin?dashboard=1` (T1).

1. New tab + fetch via `src/api/auth.js` (add `adminDashboard()` mirroring the
   existing `adminList()`); on-theme per epic §4.4: stat cards as a distinct
   surface (`--vinyl-groove-2` + `--line` border), **large gold numbers**
   (`--runout-gold`, 7.65:1), `--jacket-kraft` labels, `--static-grey` captions,
   `font-variant-numeric: tabular-nums`, 2-column grid on ≤375px (never 3),
   ~10–12px gaps.
2. Each stat is a **`<dl>`** (`dt` label + `dd` value) — no `aria-live`.
   Cards are **display-only** (not links) to avoid mis-taps.
3. Guarded async states mirroring the feedback tab: `loading` (`sheet-status`
   or skeleton cards to avoid layout jump), `error` (`sheet-error` + retry),
   `empty` (`sheet-empty`, "No data yet"). Guard every read with `?.`/coercion —
   a malformed count must never dark-screen the PWA (no error boundary).
4. Sections: Pending requests (prominent), Members, Signups, Plans, Collection
   size, Feedback, Reviews.
5. Component tests (Testing Library): tab renders cards, loading → data, error →
   retry, empty state, malformed-count safety (no throw).

**Acceptance criteria**
- [ ] Owner sees every aggregate from §4.1 rendered as scannable cards.
- [ ] No uncaught error / dark screen on any dashboard path.
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `testing` + `ergonomics-review`
skills.

---

## T3 — Frontend: pending-request visibility (avatar, menuitem, Members tab)

**Labels:** `frontend` · **Owner:** Front End Developer · **Branch:** `feat/admin-dashboard`

**Body**

Make pending signups impossible to miss, using the existing badge pattern (the
Feedback tab already renders `{unread > 0 && <span className="admin-badge">}`).

1. `App.jsx` owns a **lightweight pending-count fetch** (not the full
   `adminList`) refreshed on app foreground + a modest ~60s interval, passed to
   `Header`. Respect PWA battery — never poll the full list.
2. **Avatar chip badge** in `Header.jsx` (red `--label-red` with
   `--jacket-kraft` text, mirroring `.admin-badge`), shown **only when count >
   0** (alert-fatigue rule), with a screen-reader-safe `aria-label`
   ("N pending requests").
3. **"Admin panel" menuitem badge** in the avatar menu, same rule/label.
4. **Members-tab badge** inside `AdminPanel` — reuse already-loaded
   `data.requests` (zero extra fetch) and the `.admin-badge` pattern.
5. No modal-on-open / no toast (persistent-until-resolved badge is correct; an
   interstitial would be fatigue).
6. Component tests: badge hidden at 0, shows at N, aria-label correct, decrements
   after an approve.

**Acceptance criteria**
- [ ] Pending count is glanceable from the avatar on every screen.
- [ ] Count stays reasonably fresh without aggressive polling.
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `ergonomics-review` skill.

---

## T4 — i18n: dashboard + badge labels (7 locales)

**Labels:** `i18n`, `marketing` · **Owner:** Marketing Manager (copy) + Front
End Developer (plumbing) · **Branch:** `feat/admin-dashboard`

**Body**

Fill the `admin.*` dashboard keys in `src/i18n/locales/{en,fr,nl,pt-BR,de,es,it}.js`
from the EN baseline using the glossary in `marketing/localization-dictionary.md`.
Copy lives in dictionaries — no hardcoded strings. Keys: tab label, section
labels (Members, Signups, Plans, Collection size, Feedback, Reviews, Pending
requests), card labels + captions, "Last updated", badge aria-labels, loading /
error / empty ("No data yet") strings. Number formatting uses
`toLocaleString(getLocale())`; keep raw counts (no "1.2k" in v1). `src/i18n/index.test.jsx`
enforces key parity — all locales must match.

**Acceptance criteria**
- [ ] All 7 locales complete; EN fallback for anything missing.
- [ ] No hardcoded user-facing strings in the dashboard.
- [ ] i18n key-parity test green.

**DoD:** lint + test pass.

---

## T5 — QA pass, ergonomics + DoD gates + security review

**Labels:** `qa`, `security`, `admin` · **Owner:** Tester + Security Auditor +
Ergonomics Reviewer · **Branch:** `feat/admin-dashboard`

**Body**

End-to-end verification before merge.

1. **Ergonomics pass** (Ergonomics Reviewer): confirm stat cards are
   thumb-reachable, readable on the dark theme, cards are display-only, badges
   show only when > 0, screen-reader labels present, tab arrow-key navigation
   added or the buttons-as-tabs decision documented. Report findings by
   severity; fix HIGH/MAJOR before merge.
2. **Security pass** (Security Auditor): confirm the counts endpoint is
   `requireAdmin`-gated, returns aggregates only (no emails/names/ids/IPs),
   denial-burst anomaly intact, no secret leakage in logs, no PII in the
   response.
3. **QA / gates (Tester):** full flow on dev — signup arrives → badge appears on
   avatar/menuitem/Members tab → approve → badge decrements; Dashboard shows
   correct counts. Then `npm run lint`, `npm test`, `npm run test:coverage`
   (≥70%), `npm run build`.

**Acceptance criteria**
- [ ] No HIGH/MAJOR ergonomics or security findings outstanding.
- [ ] Full flow verified; all gates green; coverage ≥ 70%.
- [ ] Security Auditor sign-off recorded (new read surface over user data).

**DoD:** lint + test + coverage + build pass.

---

## T6 — (Nice-to-have) Home-screen owner widget

**Labels:** `frontend`, `admin` · **Owner:** Front End Developer ·
**Branch:** `feat/admin-dashboard`

**Body**

Optional follow-up (only if it doesn't slip the epic): a **display-only** owner
card below the toolbar / above the FAB showing the pending count + a small
users summary, tapping into Admin → Members. Thumb-reachable (the top-right
avatar is the worst thumb zone). Reuses the `App`-level pending fetch from T3.
Guard all data paths; on-theme styling; localized.

**Acceptance criteria**
- [ ] Owner sees pending count on the home screen without opening any menu.
- [ ] Display-only (no mis-tap); taps through to Admin → Members.
- [ ] No dark-screen on any path.

**DoD:** lint + test + build pass. If it slips, drop it to a follow-up epic — it
must not block T1–T5.
