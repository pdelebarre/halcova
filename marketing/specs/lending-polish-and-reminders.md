# Spec — Lending polish & borrower reminders

- **Status:** Draft — for product/design review, not yet implemented
- **Owner:** Marketing Manager (handoff to Front End Developer; B5 Phase 2+ needs the Whole Stack Architect)
- **Suggested branch:** `feat/lending-polish` (A5 + B5 Phase 1)
- **Scope:** frontend-only for A5 and B5 Phase 1. B5 Phase 2/3 are flagged as future work with a privacy owner — do not build them in this pass.

---

## Current state (verified in code)

- A loan lives **on the item blob**: `item.lending = { borrower: { name, contact? }, lentOn, dueOn? }`; returns are recorded in `item.lendingHistory` (capped at **10**). Backend: `netlify/functions/lending.js`.
- The borrower **contact** field is stored (optional, trimmed, 240-char cap) but **never surfaced anywhere** — it is captured then dropped from the UI.
- Two surfaces show loans:
  - `LendingControls` (inside the detail sheets) — lend form (name, contact, due date) and status line; two-step "Mark returned".
  - `LoansDashboard` (`App.jsx` global sheet) — every loan across both collections, search (title/artist/borrower) + 4 sort modes, two-step return.
- Overdue is computed client-side by `isOverdue` / `toLocalDate` in `src/utils/lending.js` (day-granularity, local, never throws).
- Lending is premium-gated (`FEATURE_OFF` in the function; `lendingEnabled` / `lendingGate` on the client).

---

## A5 — Lending polish (frontend only)

**A5.1 — Make `borrower.contact` actionable.**
Where a loan row or status line shows the borrower, render the stored contact as
one-tap actions when present. Add a tiny helper (e.g. `src/utils/contact.js`) that
classifies a contact string:

- `tel:` — digits / `+` / spaces → **Call**
- `mailto:` — contains `@` → **Email**
- else → treat as a generic message target (WhatsApp/sms) via `https://wa.me/<digits>` when it parses as a phone number, otherwise hide the tap target.

Show the action in both `LoanRow` (LoansDashboard) and the `LendingControls`
status line. This uses data already stored — no backend change.

**A5.2 — "Remind" button (device-native; doubles as B5 Phase 1).**
A **Remind** button on each loan row + detail-sheet status line. One tap:

1. If `navigator.share` is available → open the share sheet with a pre-filled
   message (`copy.lending.remindMessage(title, dueDate)`).
2. Else → copy the same text to the clipboard and toast `lending.remindCopied`.

Pre-filled message (EN master, localizable):

> "Hey {name} — just checking in on *{title}* I lent you{ on due-date: it was due {date}}. 😊"

Tone: friendly nudge, not a demand. No server, works offline.

**A5.3 — Due-date presets.**
In the `LendingControls` lend form, add three chips next to the due-date input:
**1 week / 2 weeks / 1 month**, which set `dueOn` to today + offset (using the
same local-day math as `toLocalDate`). Keep the free-form date input as the
fourth option. Copy: `lending.due1w` / `lending.due2w` / `lending.due1m`.

**A5.4 — Overdue surfacing.**
- Group `LoansDashboard` rows into **Overdue / Due soon / On loan** (or sort with
  an "Overdue first" toggle already present in the `due` sort — promote it to the
  default). Add an overdue count in the dashboard header when > 0.
- Add an overdue badge on the Toolbar **Loans** button (it already owns the button
  ref and focus restore). Copy: `lending.overdueCount(n)`.

**A5.5 — History cap honesty.**
`lendingHistory` is capped at 10 and silently drops older entries. When an item's
history reaches the cap, show a one-line note in the detail sheet:
*"History keeps the last 10 loans."* — `lending.historyCapNote`. (Optional follow-up:
raise the cap; flagged, not in this pass.)

### Copy keys to add (A5)

| Key | EN copy |
| --- | --- |
| `lending.remind` | `Remind` |
| `lending.remindMessage` (fn) | `Hey {name} — just checking in on “{title}” I lent you{ it was due {date}}. 😊` |
| `lending.remindCopied` | `Message copied — paste it to {name}` |
| `lending.due1w` / `due2w` / `due1m` | `1 week` / `2 weeks` / `1 month` |
| `lending.overdueCount` (fn) | `{n} overdue` |
| `lending.historyCapNote` | `History keeps the last 10 loans.` |
| `lending.contactCall` / `contactEmail` / `contactMessage` | `Call` / `Email` / `Message` |

All keys go in `src/i18n/locales/*.js` (7 locales) under §15 Lending; the
detail-sheet copies also pass through `catalog.copy.lending` in `src/catalog.js`
(records + books) so the `entity` wording stays right.

### Touchpoints (A5)

| File | Change |
| --- | --- |
| `src/components/LoansDashboard.jsx` | Contact actions + Remind in `LoanRow`; overdue grouping/count |
| `src/components/LendingControls.jsx` | Contact actions + Remind; due-date presets; history-cap note |
| `src/components/Toolbar.jsx` | Overdue badge on the Loans button |
| `src/utils/contact.js` (new) | Contact classifier (tel / email / wa) |
| `src/utils/lending.js` | Add `addDays` helper for presets (reuse `toLocalDate`) |
| `src/catalog.js` | `copy.lending.*` additions on both catalogs |
| `src/i18n/locales/*.js` | New `lending.*` keys |

---

## B5 — Reminders (phased; only Phase 1 in this pass)

**Phase 1 — Device-native "Remind" (build now, 0 backend).**
Identical to A5.2. Ships in this pass; no notification channel, no PII change,
no server. This is the whole of B5 for now.

**Phase 2 — Scheduled email reminders (future — needs an ADR).**
Requires an email provider + a scheduled/cron Netlify function + consent flow,
and introduces **PII retention** (borrower contacts). Do not build without:
- a privacy decision (GDPR consent + data-retention policy), and
- a Whole Stack Architect ADR covering the scheduler, provider, and opt-out.

**Phase 3 — Web Push (PWA, future).**
Requires `PushSubscription` persistence, a push service, and iOS caveats (installed
PWA + user gesture; historically flaky on iOS Safari). Lowest priority; do not
build in this pass.

> **Do not** reference email/push in public copy until Phase 2/3 are decided —
> "reminders" today means the in-app/share-sheet **Remind** action only.

---

## Validation flags (blocking)

- **A5.1** — confirm contact classification doesn't misroute non-phone strings
  (e.g. an email should never open a `tel:` link).
- **A5.4** — overdue badge placement on the Toolbar Loans button must not collide
  with the existing focus-restore/aria label.
- **B5 Phase 2/3** — any email/push messaging is blocked on the ADR + privacy owner.

## Acceptance criteria

- A loan with a stored contact shows a working Call/Email/Message action in both
  the dashboard row and the detail sheet.
- The **Remind** action opens the share sheet (or copies + toasts) with a
  pre-filled, localized message; works offline.
- Due-date presets set `dueOn` with local-day math (no UTC drift).
- Overdue loans are visually distinct in the dashboard and surfaced on the Loans
  button.
- History shows the 10-cap note when full.
- No new backend; no email/push strings shipped.

## Out of scope

- Scheduled email, Web Push, backend changes, paywall/lending gate changes,
  gamification.
