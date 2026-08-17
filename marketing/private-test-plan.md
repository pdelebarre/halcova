# Private Test Plan — Halcova (friends & family, FR · NL · BR · DE)

**Owner:** Marketing Manager + site owner · **Status:** Ready to execute · **Date:** 2026-08-12
**Scope:** **private first** — a closed circle of friends & family from
**France, the Netherlands, Brazil, Germany**. No public launch yet.
**Ref:** `copy-kit-halcova.md`, `private-test-invite.md` (name-check: run a Halcova native-speaker check `[VALIDATE]`).

---

## 1. Why private-first (and why this circle is perfect)

- The app's multi-user model (owner approves members, each gets their own
  Records and/or Books collections) is **exactly** the private-family flow.
- The testers are **native speakers of 6 of the 7 target languages**
  (FR · NL · PT-BR · DE · ES · IT) — **every non-English target is covered
  natively**. The private test **doubles as the native-speaker name check AND
  the localization check** (see `localization-plan.md`).
- Remaining to validate later, before any wider launch: **EN** only (the
  product language — assume fine).

## 2. What the test must answer

1. **Name:** Does "Halcova" sound natural and good in FR/NL/PT-BR/DE/ES/IT?
   (vibe + accidental meaning)
2. **Core flow:** scan → lookup → confirm → add; duplicate detection (the
   "never double-buy" moment).
3. **Retention signal:** do people come back and keep cataloging?
4. **Stability:** any dark-screen/crash (no error boundary) reports.
5. **Language:** the app is being localized (EN default, user-switchable to
   FR/NL/PT-BR/DE/ES/IT). Testers validate that their language reads naturally
   (`localization-dictionary.md` + in-app UI).

## 3. Setup checklist (before invites go out)

- [ ] **Branch:** `chore/rename-halcova` off `main`; implement the Hokan→Halcova
      code rename (wordmark + manifest + docs).
- [ ] **Deploy:** `netlify deploy --build` (never drag-drop `dist`).
- [ ] **Domain:** register a Halcova domain now so the shared link is stable
      `[VALIDATE]` (test can run on the `*.netlify.app` URL meanwhile).
- [ ] **Env:** set `RUNOUT_ADMIN_KEY` in production (no dev fallback).
- [ ] **Codes:** from the admin panel, generate one access code per tester,
      grant **Records and/or Books** per person.
- [ ] **Feedback form:** a 2-minute form (see §6) — create + link it in invites.
      Once the in-app feedback channel ships (epic #74), the form is retired in
      favour of the always-on channel (Settings → Feedback, see §6b).

## 4. Tester roster (fill in)

| Name | Country / lang | Plans granted | Code | Status |
| --- | --- | --- | --- | --- |
| — | FR | ☐ Records ☐ Books | — | ☐ sent |
| — | NL | ☐ Records ☐ Books | — | ☐ sent |
| — | BR | ☐ Records ☐ Books | — | ☐ sent |
| — | DE | ☐ Records ☐ Books | — | ☐ sent |
| — | ES | ☐ Records ☐ Books | — | ☐ sent |
| — | IT | ☐ Records ☐ Books | — | ☐ sent |

> 1–2 testers per country is enough; more if they're keen.

## 5. Onboarding flow (send the invite → walk them through)

1. Open the link → **Sign in with your personal code**.
2. Tap the **Scan** button → scan a barcode from a real record/book they own.
3. Confirm the match → notice the **"already own / other pressing / same
   artist"** flags.
4. Add, then try **search, filter, sort, notes, remove**.
5. (Optional) **Add to home screen** — runs like a native app, works offline.

## 6. Feedback form (2 minutes — questions)

**Name (the important part):**
- Q1: Say "Halcova" out loud. Does it sound natural in your language? (1–5)
- Q2: Does it mean anything odd or rude to you? (free text)
- Q3: Does it feel "cozy + treasure" — a warm place that keeps the things you
  love? (1–5)

**Product:**
- Q4: Did scanning + adding a record/book work smoothly? (1–5, comments)
- Q5: Did the "you already own this" moment feel useful? (1–5, comments)
- Q6: Anything that broke, felt confusing, or sent the screen dark? (free text)
- Q7: Would you use it for your real collection? (Yes / Maybe / No)

**Extras:**
- Q8 (language): Does the app read naturally in your language? (Yes / mostly /
  no — tell us what sounds off)
- Q9: One thing you'd change. (free text)

## 6b. Always-on in-app feedback channel (successor to the form)

Once epic #74 ships, the one-off Google Form in §6 is **retired** and replaced
by the always-on in-app channel (Settings → Feedback + the ErrorBoundary
"Report a problem" button):

- **How members reach us:** Settings → Feedback → toggle **Suggestion** / **Report
  a problem** → optional category + message → **reference id** (`#fb-…`).
- **What the owner sees:** every report in the admin **Feedback inbox** with
  auto-context (route, version, device, timestamp), filterable by status/type,
  with an internal note + delete. This **is** the private-test feedback sink
  going forward — no separate form to maintain.
- **Rate-limit:** 5 submissions/hour per member (starting point — validate in
  T8); feedback is member-only (no anonymous reports).
- **What replaces the form's questions:** Q1–Q3 (the Halcova name check) still
  needs a **one-off form** for the *name* — that's not an app channel. Keep a
  small name-check form for the native-speaker pass; the *product* questions
  (Q4–Q9) become in-app suggestions/bug reports.
- **Keep for the private test:** the name-check form (Q1–Q3) + the onboarding
  walkthrough in §5. Everything product-related flows through the in-app inbox.
- Full copy/tracking: `marketing/feedback-launch-beat.md`.

## 7. What to measure (alongside the form / the in-app inbox)

| Metric | How |
| --- | --- |
| Activation | testers who signed in with their code |
| Cataloging | items added per tester (collection API / admin view) |
| Duplicate use | how often the "already own" flag appears |
| Retention | return visits over 2 weeks |
| Name ratings | Q1/Q3 averages per language |
| In-app feedback | reports submitted via Settings → Feedback (admin inbox) — once epic #74 ships |

## 8. Go / no-go for a wider launch

**Go** when: name OK (Q1 & Q3 ≥ 3) in FR/NL/PT-BR/DE/ES/IT · localized UI reads
naturally (Q8) · no unresolved dark-screen/crash reports · ≥ 1 returning user
per country · core flow confirmed. Then run the trademark/domain gate
(the Halcova legal/domain gate) before scaling beyond the circle.
