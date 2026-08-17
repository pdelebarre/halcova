# Feedback channel — copy, launch beat & tracking (epic #74 · T9)

**Owner:** Marketing Manager · **Status:** Draft for review · **Date:** 2026-08-17
**Branch:** `feat/feedback` (off `main`, never `main`) · **Part of:** epic **#74**
In-app feedback · **Issue:** #83 (T9 — Marketing) · **Milestone:** M3 — Listen & stand out
**Grounding:** every claim traces to the real feature (T1–T8): Settings →
Feedback modal, suggestion vs bug, auto-context, reference id (`#fb-…`), owner
triage in the admin inbox, rate-limit, 7-locale copy. **No invented metrics,
pricing, testimonials, or "instant reply" promises.** Anything needing a native
pass or a product/legal check is marked `[VALIDATE]`.

This file is the Marketing deliverable for T9. It is **docs/copy only** — no
app code is edited from here. App copy goes through the `feedback.*` /
`admin.feedback.*` keys (see §1).

---

## 1. In-app copy — EN baseline review & handoff (for T5 / T7)

The EN baseline already shipped with T5 (#82) in `src/i18n/locales/en.js` §19
(`feedback.*`) and §11b (`admin.feedback.*`). This is the Marketing review of
that baseline plus the exact handoff for the Front End Developer and the
localization pass (T7).

### 1.1 The exact keys (hand these to the Front End Developer)

**Member-facing modal — `feedback.*`**

| Key | EN (as implemented) | Notes |
| --- | --- | --- |
| `feedback.title` | Feedback | Also reused for the Settings entry card title |
| `feedback.subtitle` | Suggest an idea or report a problem — we read everything. | The campaign's "We read everything" line; keep identical across UI + launch copy |
| `feedback.typeLabel` | Feedback type | Segmented toggle label |
| `feedback.type.suggestion` | Suggestion | **See revision R1** (asymmetric with `type.bug`) |
| `feedback.type.bug` | Report a problem | Verb phrase — see R1 |
| `feedback.categoryLabel` | What's it about? (optional) | Warm; covers both types |
| `feedback.category.records/books/scanner/auth/billing/games/lending/other` | Records / Books / Scanner / Account / Billing / Games / Lending / Other | Optional chips |
| `feedback.messageLabel` | Your message | — |
| `feedback.messagePlaceholder` | What happened, or what would you love to see? | One placeholder, both types — good |
| `feedback.charCount` | {n} / {max} | Live counter |
| `feedback.contextLabel` | Include app info | Auto-context checkbox (route · version · device) |
| `feedback.contextDetail` | {route} · v{version} · {device} | — |
| `feedback.contextEmpty` | — | Fallback when context is empty |
| `feedback.submit` | Send feedback | — |
| `feedback.submitting` | Sending… | Busy state |
| `feedback.successTitle` | Thanks — we got it. | The confirmation line; on-voice |
| `feedback.successBody` | Reference {ref}. It goes straight to the team — we read everything. | Reference id visible; see R2 |
| `feedback.referenceUnknown` | #fb-… | Fallback id format |
| `feedback.done` | Done | — |
| `feedback.error.generic` | Couldn't send your feedback — check your connection and try again. | Graceful failure |
| `feedback.error.NO_TOKEN` | Sign in to send feedback — the team reads member reports. | Member-only channel |
| `feedback.error.RATE_LIMITED` | You've sent a lot recently — take a breath and try again in a minute. | **See revision R3** (copy vs 5/hour cap) |
| `feedback.error.MESSAGE_TOO_LONG` | That message is too long — keep it under 4000 characters. | Length cap |
| `feedback.error.DEMO_READONLY` | The demo is read-only — sign in to send feedback. | Demo guard |

**Owner-facing admin inbox — `admin.feedback.*`** (internal, never member-facing)

| Key group | EN (as implemented) | Notes |
| --- | --- | --- |
| Tab + unread badge | Feedback · {n} unread | Owner-only |
| Filters | Filter by status / Filter by type · All statuses / All types | — |
| `admin.feedback.status.open/in_progress/done/wontfix/duplicate` | Open · In progress · Done · Won't fix · Duplicate | Triage labels; see R4 |
| `admin.feedback.type.suggestion/bug` | Suggestion · Bug | Short triage forms |
| Detail rows | From {name} · Route / Version / Device / User agent | Auto-context display |
| Note | Admin note · Internal note — only you see this. · Save note · Saved ✓ · Saving… | Owner-only |
| Empty states | No feedback yet — the inbox is quiet. · Nothing matches those filters. | On-voice |
| Delete | Delete report · Delete this feedback report? This cannot be undone. | Two-step confirm |

### 1.2 Tone-fidelity verdict

The baseline is **on-voice and on-brand**: wry, warm, collector-friendly,
matches `copy-kit-halcova.md` §10 and `review-benefits-humor.md` §5. The
"we read everything" motif running from subtitle → success body is deliberate
reinforcement and is exactly what the launch beat (this file §2) mirrors. No
leaked internals (no access codes, no admin/approval mechanics, no rate-limit
numbers in member copy). **Ship it as-is for the wording; apply the revisions
below where they strengthen accuracy.**

### 1.3 Recommended revisions to hand to the Front End Developer

> These are **recommendations, not blockers** — the baseline already meets the
> epic's acceptance criteria. Each is flagged with a reason and a suggested
> replacement string. Front End Developer + native testers (T7) decide whether
> to apply.

- **R1 — Symmetric type toggle.** `feedback.type.suggestion` = 'Suggestion'
  (noun) vs `feedback.type.bug` = 'Report a problem' (verb phrase) are
  asymmetric in a segmented toggle. Recommended pair (both verb phrases):
  - `feedback.type.suggestion` → **'Suggest an idea'**
  - `feedback.type.bug` → 'Report a problem' (unchanged)
  - (Alternative if nouns are preferred: 'Suggestion' / 'Problem'.) The admin
    triage labels (`admin.feedback.type.*` = 'Suggestion' / 'Bug') stay short —
    they're internal.
- **R2 — Reference id prominence.** `feedback.successBody` puts the reference
  after "Reference {ref}." — consider rendering the id as the visual anchor
  (e.g. a chip/line with `#fb-…` in the monospace/gold style used for data on
  the dark theme) so the "you have a receipt" moment lands at a glance. Copy
  unchanged; presentation only. `[VALIDATE]` with FED re: tokens.
- **R3 — Rate-limit copy vs the real cap.** The backend enforces **5
  submissions / hour** (epic §4.3, T3). "…try again in a minute" under-promises
  the wait if the cap was actually hit (a minute won't clear a 5/hour window).
  Recommended softening (accuracy over inventing a number):
  - `feedback.error.RATE_LIMITED` → **'You've sent a lot recently — take a
    breath and try again a little later.'**
  - Confirm against the real `Retry-After` the function returns (T8) before
    shipping a specific time.
- **R4 — `admin.feedback.status.wontfix`.** 'Won't fix' is a fine *internal*
  triage label; it must never surface to members in v1 (no status-change
  notifications exist). Keep internal. If it ever leaks, prefer 'Not right now'
  — note only, no change today.
- **R5 — Do NOT add a roadmap-promise line.** The epic §2 explicitly defers a
  *public roadmap board* and email replies. So no member-facing copy such as
  "your idea will appear on the roadmap" or "we'll email you when it's done" —
  members get a reference id and nothing else promised. The inbox feeds the
  *internal* roadmap (§3.3) — that is a team fact, not a member promise.
- **R6 — Settings entry copy.** Reuse `feedback.title` ('Feedback') for the
  Settings card title and `feedback.subtitle` as the hint line — no new key
  needed. If the FED wants a separate, shorter hint, propose a new key
  `feedback.settingsHint` = 'Suggest an idea or report a problem.' and localize
  it with T7 — but reusing the subtitle keeps the launch message identical.
- **R7 — `feedback.contextLabel`.** 'Include app info' is accurate; optional
  clarity: 'Include app info — helps us fix it'. Keep it short; fine as-is.
  `[VALIDATE]` with FED re: space in the bottom sheet.

### 1.4 Handoff note

- **Front End Developer:** the keys above are already in `en.js` §19/§11b
  (T5 #82). Apply R1–R7 where agreed; no new keys unless R6's `settingsHint`
  is chosen.
- **T7 (localization):** translate `feedback.*` + `admin.feedback.*` from this
  EN baseline for FR/NL/PT-BR/DE/ES/IT using `localization-dictionary.md`; all
  strings `[VALIDATE]` with native testers (per `localization-plan.md`).
  Keep `#fb-…` and the reference format untranslated; keep "we read
  everything" localized as a warm, honest phrase — never a response-time
  promise.

---

## 2. "We read everything" — launch beat (X · Instagram · WhatsApp · newsletter)

### 2.1 Placement in the campaign calendar (no new phase)

Slots into the **existing** `campaign-viral-launch.md` calendar — it does **not**
invent a phase. The beat is **member-facing**, so it can only run once (a)
the epic #74 feature has shipped and (b) members are actually inside the app.
That lands naturally in **Phase 4 — The Open (Day 14+, from Sun 08-30)** and
the early **Phase 5 — The Loop (Day 15+)**.

| Moment | Channel | When | Audience |
| --- | --- | --- | --- |
| **M1 — first-circle "direct line"** | WhatsApp (personal, 1:1) | Phase 4, as the first members onboard (on/after Day 14) | The private friends & family circle who seeded the launch |
| **M2 — public "we read everything"** | X · Instagram (+ Facebook mirror) | Early Phase 5 (from ~Day 16+), once there's a live member base to point at Settings | Followers + new members |
| **M3 — newsletter note** | Newsletter (channel to be stood up — see §4) | First edition after the open (Phase 4+) | Requesters / member list |

The WhatsApp moment comes first and is the highest-trust one — the circle that
reports the first real bugs is the one that makes the inbox truthful. The public
beat reuses the same line so the message is identical in-app and out.

### 2.2 The beat (EN master — copy-bank entries in `campaign-copy-bank.md`)

**M1 · WhatsApp (personal 1:1, after sign-in):**

> You're in. 🏛️ One thing before you start scanning:
> Settings → Feedback, right inside the app. Suggest something, or tell us
> what broke. You'll get a reference number (#fb-…) so we can find it in the
> pile.
> We read everything. It's a small team — but it's a real inbox.
> (No instant replies — just a real one.)

**M2 · X:**

> Every bug report is one we never have to chase. 👀
> In Halcova: Settings → Feedback. Suggest an idea or report a problem —
> you get a reference id, and it lands straight in our inbox.
> We read everything. That's the whole point.
> #Halcova #WhatsInYourHalcova

**M2 · Instagram / Facebook:**

> Your crate has a direct line to us now. 📬
> Settings → Feedback. Tell us what to build — or what broke. Every report
> gets a reference id, so it lands on the right desk.
> We read everything. Small team, real inbox.
> #Halcova #vinyl #bookstagram #recordcollection

**M3 · Newsletter (subject + short body):**

> **Subject:** We read everything.
>
> **Body:**
> Halcova now has an always-on way to reach us: **Settings → Feedback**.
> Suggest an idea or report a problem — whichever it is, you'll get a
> reference number (#fb-…), and your report goes straight to the team's
> inbox, where it genuinely feeds what we build next.
> No instant replies — but everything is read, and everything is triaged.
> Your crate, your shelf, and now a direct line to the people building it.

### 2.3 Beat guardrails

- **"We read everything" is a reading promise, not a response promise.** No
  "we reply within X", no "instant reply", no "you'll get an email" (email
  replies are out of scope for v1 — epic §2).
- **No roadmap seat.** Public copy never promises "your idea will be built" or
  "you'll see it on the roadmap" (no public roadmap in v1). "It feeds what we
  build next" (M3) is the ceiling — the inbox informs the internal backlog, it
  does not guarantee any specific suggestion ships.
- **No leaked internals.** No mention of the admin panel, access codes, statuses
  (`open`/`done`/`wontfix`), rate-limits, or the owner's triage workflow.
- **No invented metrics.** No "N people suggested X", no "we fixed 90% of
  reports", no testimonials — all of those would need real, permissioned data
  first.
- **Localization:** beat stays EN master at launch; localized follow-ups after
  the name-reveal per `copy-kit-halcova.md` §7 — keep at least one situational
  joke per localized post (`review-benefits-humor.md` §5). The phrase "we read
  everything" needs a native pass in FR/NL/PT-BR/DE/ES/IT `[VALIDATE]`.

---

## 3. Tracking — the feedback funnel & KPIs

### 3.1 Funnel (open → submit → reference id)

```
Open feedback modal (Settings entry  OR  ErrorBoundary "Report a problem")
   │  event: feedback_modal_opened { entry: settings|error, type: suggestion|bug }
   ▼
Submit (type + optional category + message, auto-context attached)
   │  event: feedback_submitted { type, category }
   ▼
201 → confirmation with reference id (#fb-…)
   │  event: feedback_reference_seen { ref }
   ▼
Owner triage in the admin inbox
   │  event: feedback_status_changed { id, status }   (internal/owner-side)
   ▼
Closed loop: open → in_progress → done (or wontfix/duplicate), admin note
```

**Event mechanics (real, not invented):** events fire via the existing
first-party `src/utils/track.js` — **default-OFF, opt-in only**, sanitized
(no codes, no barcodes, no nested objects). So funnel events exist **only for
opted-in users**; they are the future-proofing hook, **not** the KPI source.
Per epic #74 §6: **the admin inbox IS the data source** for KPIs today. The
owner tallies from the inbox; the events layer is the upgrade path when an
opt-in flush endpoint exists.

### 3.2 KPI table (from epic #74 §6 — "Measurement (Marketing KPIs)"; "§5" in the GitHub issue body)

| KPI | Definition | Target (launch window) |
| --- | --- | --- |
| Feedback activation | members who submit ≥ 1 report | ≥ 15% of active members |
| Submission rate | reports per 100 session | watch; sanity floor & ceiling |
| Suggestion vs bug mix | split of `type` | expect ~60/40 early |
| Bug → fix time | median time `open` → `done` | < 7 days (inbox makes this visible) |
| Closure loop | share of reports with a status change / admin note | 100% within 14 days (owner workflow) |
| Reference-id reach | submitter saw the confirmation | ~100% (toast + id) |

Targets are **starting points to recalibrate** after the first real data (per
the campaign's own KPI note in `campaign-viral-launch.md` §7) — not invented
promises. Reference-id reach is measured by the FED's T5 test (confirmation
renders on success) and by manual inbox-vs-submission sanity checks.

### 3.3 Where the inbox feeds the roadmap

1. **Triage is the input.** Every report in the admin inbox is read; status
   changes (`open` → `in_progress` → `done` / `wontfix` / `duplicate`) and the
   admin note *are* the internal roadmap signal — no public roadmap board in
   v1 (epic §2).
2. **Surfaced suggestions → backlog candidates.** Repeated suggestions and the
   top `category` chips (records/books/scanner/account/billing/games/lending)
   become candidate backlog items; the Marketing Manager + Project Manager
   review the inbox periodically and promote patterns to tickets. This loop is
   what the epic `marketing/epic-user-feedback.md` §3 "Marketing" persona
   describes — the always-on listening channel feeding the roadmap.
3. **Bugs → fix queue.** A `bug` report with auto-context (route, version,
   device) that reproduces becomes a bug ticket; "Bug → fix time < 7 days" is
   the KPI that makes the loop visible.
4. **No member-facing roadmap.** Members get a reference id, not a status
   tracker (email replies / public roadmap are deferred — never promise them).

### 3.4 UTM for the launch beat

The public social beat is a **how-to CTA inside the app** (Settings → Feedback)
— no link needed on X/IG. The newsletter (M3) may link back to the landing /
request-access page, reusing the campaign UTM scheme with a feedback content tag:

```
https://<halcova-domain>/?utm_source=email&utm_medium=email&utm_campaign=halcova-launch-2026&utm_content=feedback-channel
```

`[VALIDATE]` against the landing-page analytics (#121) before M3 ships.

---

## 4. Claims needing product validation `[VALIDATE]`

1. **Newsletter channel does not exist yet.** M3 is drafted but needs a
   channel/tool decision (no newsletter infra in the repo). Do not send until
   stood up.
2. **"We read everything"** is true in the sense that all member reports land
   in the owner's admin inbox and are triaged — validated by the feature itself
   (T8 QA). It does **not** imply a reply SLA; keep copy free of any response
   time.
3. **Rate-limit copy (R3)** depends on the real `Retry-After` the function
   returns (T3/T8) — confirm before choosing "a minute" vs "a little later".
4. **Localized "we read everything"** needs a native pass (FR/NL/PT-BR/DE/ES/IT)
   before any localized beat ships (per `localization-plan.md`).

---

## 5. Companion files & handoff

| File | What changed / is referenced |
| --- | --- |
| `marketing/feedback-launch-beat.md` | **This file** — copy review, launch beat, funnel + KPI plan (T9 deliverable) |
| `marketing/campaign-copy-bank.md` | Added **"Feedback — 'We read everything'"** section (the beat per channel) |
| `marketing/private-test-plan.md` | §6 now marks the in-app channel as the always-on successor to the one-off form; §7 adds an in-app feedback row |
| `marketing/epic-user-feedback-subtasks.md` | T9 section points here for the KPI/measurement plan (epic §6 / §5) |
| `marketing/epic-user-feedback.md` | Epic source of the KPI table (§6) and scope (§2) — unchanged |
| `src/i18n/locales/en.js` §19/§11b | EN baseline (already shipped in T5 #82) — **not edited from here** |

**Handoffs**
- **Front End Developer:** EN keys + revisions R1–R7 (§1.3). No app-code edits
  from Marketing.
- **T7 localization:** translate `feedback.*` + `admin.feedback.*` from §1.1
  baseline; glossary `localization-dictionary.md`.
- **Project Manager:** launch-beat placement (Phase 4/5 of the campaign
  calendar, §2.1) + newsletter channel decision (§4.1).
