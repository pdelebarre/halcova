# Epic — Admin dashboard & pending-request visibility

> **Status:** Draft for GitHub · **Owner:** Project Manager (epic) / Netlify
> Backend + Front End Developer (implementation) · **Branch:** `feat/admin-dashboard`
> (off `main`, never `main`) · **Paste target:** GitHub issue (label `epic`, link
> all subtasks to it)
> **Subtask issue bodies:** `marketing/epic-admin-dashboard-subtasks.md`
> **Based on:** `src/AdminPanel.jsx`, `netlify/functions/admin.js`,
> `netlify/functions/_shared/users.js`, `src/App.jsx`, `src/Header.jsx`,
> `src/index.css` (design tokens), the `auth-access` + `ergonomics-review`
> skills, and the reflection of the Netlify Backend, Ergonomics Reviewer,
> Whole Stack Architect and Security Auditor agents.
> **Companion epic:** `marketing/epic-usage-analytics.md` (adds *visits* and
> *performance* dashboards on top of this one — build this first).

---

## 1. Why (background)

The admin panel (`src/AdminPanel.jsx`) already lets the owner approve pending
signup requests, manage members, and triage feedback. But there are two real
gaps the owner keeps hitting:

1. **Pending requests are invisible until the panel is opened.** The only admin
   entry is a "Admin panel" item inside the avatar menu; the pending count
   (`pending = data.requests.filter(... === 'pending')`) exists only inside the
   Members tab. The owner has **no glanceable signal** — a signup can sit
   waiting while the owner has no reason to open the menu at all. The core ask
   ("the admin should see there are pending requests") is currently unanswerable
   without proactively opening a submenu.
2. **There are no dashboards.** The owner has no overview of the app: how many
   users, active vs disabled, signups over time, plan mix, collection size,
   feedback/review volume. Every number requires reading the raw list.

The good news: **all of the dashboard *counts* already exist in Postgres** (the
`users` / `requests` / `items` / `feedback` / `reviews` tables behind the
`repository.js` seam) and the admin GET already returns `{ requests, users }`.
This epic surfaces that data ergonomically and makes pending requests
impossible to miss — **with zero new data collection**. (True *visits* and
*performance* need the companion opt-in analytics epic.)

---

## 2. Scope

### In scope (v1)
- **Pending-request visibility, three surfaces** (complementary, never a modal
  on open):
  1. A **badge on the avatar chip** (shown only when count > 0) — the owner's
     glance point on every screen.
  2. A **badge on the "Admin panel" menuitem** in the avatar menu.
  3. A **pending badge on the Members tab** inside the panel (reuse the existing
     `.admin-badge` pattern the Feedback tab already uses).
  All three are driven by a lightweight pending-count fetch owned by `App` (not
  the full `adminList`), refreshed on app foreground + a modest interval, so the
  badge stays fresh without polling aggressively.
- **A new Dashboard tab** in `AdminPanel` (`members | feedback | dashboard`)
  with ergonomic stat cards showing **aggregate counts only**:
  members (total / active / disabled), signups (today / week / month / total),
  plan mix (free / premium / lifetime / unlimited), collection size
  (records / books owned), pending requests, and feedback / review volume.
- **Backend:** a `?dashboard=1` counts block added to the existing admin GET
  (already `requireAdmin`-gated) so the frontend gets aggregates in one call —
  no new endpoint needed for v1 counts.
- Guarded loading / error / empty states, on-theme styling, i18n across the
  7 locales.

### Out of scope (v1 — follow-ups)
- **Visits, unique sessions, performance, scan reliability** → the companion
  epic `marketing/epic-usage-analytics.md`.
- Home-screen owner widget (nice-to-have; see §4.5).
- Charts / sparklines / drill-downs (v1 = big numbers only, per ergonomics).
- Aggregating rate-limit / anomaly counters as metrics (they are transient
  security signals, not durable usage data).

---

## 3. Who it serves

| Persona | Need |
| --- | --- |
| Owner (admin) | Never miss a pending signup; get a one-glance health read of the app (users, growth, plans, collection size) without reading raw lists. |

---

## 4. Architecture (mirrors the existing admin/feedback patterns)

### 4.1 Backend — counts block on the existing admin GET
`netlify/functions/admin.js` GET already runs `requireAdmin(req)` and returns
`{ requests, users }`. Add an opt-in `?dashboard=1` query param that appends a
`counts` object — all aggregates computed in SQL over the existing tables (the
pending count is already derived in-memory from `listRequests()`). No new
table, no new collection.

```jsonc
{
  "requests": [...], "users": [...],            // existing payload unchanged
  "counts": {
    "pendingRequests": 3,
    "members": { "total": 12, "active": 11, "disabled": 1 },
    "signups": { "today": 1, "thisWeek": 4, "thisMonth": 9, "total": 12 },
    "plans": { "free": 9, "premium": 2, "lifetime": 1, "unlimited": 0 },
    "collections": { "records": 214, "books": 87 },
    "feedback": { "open": 5, "in_progress": 2, "done": 8, "wontfix": 1, "duplicate": 0, "total": 16 },
    "reviews": { "total": 40, "published": 36, "pending": 2, "hidden": 2 }
  }
}
```

Rules: **aggregates only** (no user ids, no emails, no IPs — data minimization),
`requireAdmin`-gated (member/demo/anonymous → 401/403), and the plain
`GET /admin` payload stays unchanged when `?dashboard=1` is absent so the
existing Members tab keeps working.

### 4.2 Frontend — Dashboard tab in `src/AdminPanel.jsx`
A third tab alongside `members` / `feedback`. Stat cards are **display-only**
(not navigation) so they don't invite mis-taps. Each stat is a `<dl>` (`dt`
label + `dd` value) for screen readers — **no** `aria-live` (values change on
navigation, not in place). Reuse the existing guarded async conventions
(`loading` → `sheet-status` or skeletons; `error` → `sheet-error` + retry;
`empty` → `sheet-empty`).

### 4.3 Pending-request visibility
- `App.jsx` owns a **lightweight pending-count fetch** (`GET /admin?dashboard=1`
  or a dedicated cheap call) passed down to `Header`, refreshed on app
  foreground + ~60s interval (never the full `adminList` — PWA battery).
- Badge on the **avatar chip** and the **"Admin panel" menuitem**, shown only
  when count > 0 (alert-fatigue rule), each with a screen-reader-safe
  `aria-label` like the existing feedback badge (`admin.feedback.unread`).
- Badge on the **Members tab** inside the panel (reuses already-loaded
  `data.requests`; zero extra fetch).

### 4.4 Design tokens / styling
On the dark `#16130F` theme from `src/index.css`: stat cards as a distinct
surface (`--vinyl-groove-2` + `--line` border, like `.admin-row`), **large
numbers in `--runout-gold`** (7.65:1 contrast), labels in `--jacket-kraft`,
captions in `--static-grey`, `font-variant-numeric: tabular-nums` so counts
don't jitter; a **2-column grid on ≤375px (never 3)**, ~10–12px gaps; generous
section spacing so cards read as a dashboard, not a list.

### 4.5 Home-screen owner widget (nice-to-have, follow-up)
A display-only card for the owner (below the toolbar, above the FAB) with the
pending count + a small users/visits summary, tapping into Admin → Members.
Thumb-reachable (top-right avatar is the worst thumb zone). If included, add a
ticket; otherwise leave for later.

### 4.6 i18n
All new labels ("Pending approvals", "Users", "Visits", "Performance", "Last
updated", card labels) go through `t()` and are added to **all** locale files
(`src/i18n/index.test.jsx` enforces key parity and will fail otherwise). Numbers
format with `toLocaleString(getLocale())`; keep raw counts (no "1.2k" in v1).

---

## 5. Security & privacy

- Dashboard reads are **`requireAdmin`-gated** (owner-only) — reuse the exact
  gate `admin.js` already uses; member/demo/forged → 401/403, and a denial burst
  already fires an `admin_denial_burst` anomaly.
- The counts response is **aggregates only** — never raw emails, names, user
  ids, IPs, or codes (data minimization). `publicUser` already strips `code` /
  `code_hash`.
- **No new data collection in this epic** — it only reads existing tables, so
  the consent/privacy surface is unchanged.
- Guard every new render path with `?.`/coercion (no error boundary — a
  malformed stat must never dark-screen the PWA).

---

## 6. Measurement (owner-value KPIs)

| KPI | Definition | Target |
| --- | --- | --- |
| Pending-request time-to-approve | median time `pending` → `approved` | falls materially once the badge exists |
| Unattended requests | requests still `pending` after 48h | trends down (badge visibility) |
| Dashboard adoption | owner opens Dashboard tab | most sessions |
| Read clarity | counts scannable at a glance | no dark-screen, no mis-taps |

---

## 7. Definition of Done (epic-level)

- [ ] The owner can see pending requests from the avatar chip, the Admin
      menuitem, and the Members tab — without opening the panel.
- [ ] A Dashboard tab shows member/signup/plan/collection/feedback/review
      aggregates, sourced from existing data with **no new collection**.
- [ ] All dashboard reads are `requireAdmin`-gated and return aggregates only.
- [ ] Guarded loading/error/empty states; no uncaught error / dark screen on any
      dashboard path.
- [ ] All UI is localized in the 7 locales; no hardcoded strings.
- [ ] `npm run lint`, `npm test`, `npm run build` pass; coverage clears the
      70% threshold.
