# Subtasks — Epic: In-app feedback (suggestions & bug reports)

Paste each section below into its own GitHub issue. Link every issue to the
epic (`marketing/epic-user-feedback.md`) and add the suggested labels. Work on
branch `feat/feedback` (off `main`, never `main`) — see the `feature-branching`
skill.

Suggested labels: `epic` (the epic itself), `backend`, `frontend`, `i18n`,
`qa`, `marketing`, `security`, `enhancement`.

---

## T1 — Feedback database schema + Postgres repository

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/feedback`

**Body**

Add the first-class Postgres table for user feedback (suggestions + bug
reports), mirroring the `reviews` feature exactly (migration `005_reviews.sql`
+ `repositories/reviews-repo.js`).

1. `db/migrations/006_feedback.sql` — the `feedback` table from the epic §4.1:
   `id`, `type` (`suggestion`|`bug`), `category`, `message` (1–4000 chars,
   CHECK), `author_id`, `author_name`, `url`, `app_version`, `user_agent`,
   `status` (`open`|`in_progress`|`done`|`wontfix`|`duplicate`), `admin_note`,
   `created_at`, `updated_at`; indexes `(status, created_at DESC)` and
   `(author_id)`. Must run on real Postgres **and** pg-mem.
2. `netlify/functions/_shared/repositories/feedback-repo.js` — CRUD:
   `createFeedback`, `listFeedback({ status?, type? })` (newest-first),
   `updateFeedback(id, { status?, adminNote? })`, `deleteFeedback(id)`,
   `deleteByAuthor(authorId)` (member-delete cascade). Allow-list status/type
   (junk → no-op, never 500). Server-assigned uuid ids; junk `id` never 500s.
3. Tests in `feedback-repo.test.js` against pg-mem with the real
   `006_feedback.sql` (mirror `reviews-repo.test.js`): create, edit, list
   filters, status transition, delete, deleteByAuthor, junk-id safety.

**Acceptance criteria**
- [ ] Migration applies cleanly via `npm run db:migrate` and on pg-mem.
- [ ] Repo methods all covered by unit tests (`npm test` green).
- [ ] No `data jsonb` mirror — fields are first-class columns (reviews principle).

**DoD:** lint + test pass. Consult the `netlify-collection` and `testing` skills.

---

## T2 — Feedback Blobs fallback store + repository seam

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/feedback`

**Body**

Blobs fallback so the app keeps working when `DATABASE_URL` is unset or
Postgres is down (mirror `reviews-blob.js` + `repository.js`).

1. `netlify/functions/_shared/feedback-blob.js` — store `runout-feedback`;
   layout `fb:<id>` → feedback object, plus an `index:open` enumeration for
   the inbox; `createFeedback`, `listFeedback`, `updateFeedback`,
   `deleteFeedback`, `deleteByAuthor`. Same allow-lists / clamping as T1
   (`asStatus`, `asType`, message clamp). Note the documented lost-update race
   (Blobs has no transactions) — Postgres is the system of record.
2. `netlify/functions/_shared/repository.js` — expose `feedback` on the
   repository object (`postgres` → T1 repo, `blobs` → this store), matching
   `users`/`items`/`lookupCache`.
3. Tests in `feedback-blob.test.js` with the in-memory blobs-shaped store
   (mirror `reviews-blob.test.js`): CRUD, enum index, deleteByAuthor.

**Acceptance criteria**
- [ ] Blobs impl mirrors the T1 API surface so the function can switch paths.
- [ ] Seam wired with no changes to existing callers.
- [ ] Unit tests green.

**DoD:** lint + test pass. Consult the `netlify-collection` skill.

---

## T3 — `feedback.js` Netlify function (submit + admin CRUD, auth, rate-limit)

**Labels:** `backend`, `security` · **Owner:** Netlify Backend · **Branch:** `feat/feedback`

**Body**

New function `netlify/functions/feedback.js` (mirror the conventions of
`admin.js` / `collection.js`: `json()`, `bearer()`).

| Method | Auth | Body / params | Returns |
| --- | --- | --- | --- |
| POST | Bearer code (member) **or** admin key | `{ type, category?, message, url?, appVersion? }` | `201 { id, … }` |
| GET | admin key | `?status=&type=` | `{ items }` |
| PATCH | admin key | `{ id, status?, adminNote? }` | updated item |
| DELETE | admin key | `?id=` | `204` |

Guards:
- Author derived **server-side** from the session (never from the body);
  `author_name` from the user record.
- Rate-limit submissions with the existing `_shared/rate-limit.js` (e.g. 5 /
  hour per user; 429 + `Retry-After`).
- Allow-list `type`/`category`/`status`; `message` trimmed + capped 4000.
- Never log or return access codes / the admin key / `code_hash`.
- Admin endpoints require the admin key (like `admin.js`).
- Endpoint tests (mirror `admin.test.js` style): member submit 201, admin
  list/filter/update/delete, 401/403 paths, rate-limit 429, junk input never
  500s.

**Acceptance criteria**
- [ ] All four operations work against Blobs **and** Postgres backends.
- [ ] Rate-limit enforced; abuse cannot flood the inbox.
- [ ] No secret leakage (Security Auditor reviews).

**DoD:** lint + test pass. Consult the `netlify-collection` + `auth-access` skills.

---

## T4 — Client API module `src/api/feedback.js`

**Labels:** `frontend` · **Owner:** Front End Developer · **Branch:** `feat/feedback`

**Body**

Client module mirroring `src/api/auth.js` / `src/api/collection.js`:
`submitFeedback({ type, category, message, url, appVersion })`,
`listFeedback({ status?, type? })`, `updateFeedback({ id, status?, adminNote? })`,
`deleteFeedback(id)`. Bearer header from the session (`getAccessCode()`),
error `code` passthrough, offline/non-200 handled gracefully (no dark-screen —
the UI must show a friendly error, never throw uncaught).

Tests with mocked `fetch` (mirror `collection.test.js` / `auth.test.js`):
success shapes, 4xx/5xx mapping, missing code → `NO_TOKEN`-style code,
invalid JSON.

**Acceptance criteria**
- [ ] All four functions call the right endpoint/method/headers.
- [ ] Errors carry a `code` and never throw uncaught.
- [ ] Tests green.

**DoD:** lint + test pass. Consult the `testing` skill.

---

## T5 — FeedbackModal + entry points (Settings, ErrorBoundary) + EN keys

**Labels:** `frontend` · **Owner:** Front End Developer · **Branch:** `feat/feedback`

**Body**

The user-facing form — on-theme (`#16130F` + gold tokens from `src/index.css`),
bottom-sheet pattern like the other modals.

1. `src/components/FeedbackModal.jsx` (+ `.css`): segmented
   **Suggestion / Report a problem** toggle, optional category chips (records /
   books / scanner / account / billing / other — localized), message textarea
   with live char counter (max 4000), optional auto-context row (route + app
   version + device, pre-checked), submit via `src/api/feedback.js` (T4), then
   a confirmation state with the **reference id** ("Thanks — we got it.
   #fb-…"). Loading/error states included; no unguarded data paths.
2. **Settings entry:** add a "Feedback" card in
   `src/components/SettingsModal.jsx` that opens the modal.
3. **ErrorBoundary entry:** in `src/components/ErrorBoundary.jsx`, replace the
   static `error.reported` note with a **"Report a problem"** button that opens
   the modal pre-filled `type=bug` + current route/version. **This makes the
   existing `error.reported` copy truthful** — verify with a test that the
   button appears on the crash card.
4. `src/App.jsx` — own `feedbackOpen` state + mount the modal (mirror
   `settingsOpen` / `creditOpen`).
5. Add **EN baseline** `feedback.*` keys to `src/i18n/locales/en.js` (copy from
   Marketing dictionary — see `marketing/epic-user-feedback-subtasks.md` T7);
   missing keys in other locales fall back to EN (never throw).
6. Component tests (Testing Library): open from Settings, submit success →
   reference id, error state, char counter, ErrorBoundary → pre-filled bug.

**Acceptance criteria**
- [ ] A member can submit from Settings in < 30 s and sees a reference id.
- [ ] Crash card "Report a problem" actually submits a bug report.
- [ ] No uncaught errors / dark screen on any feedback path.
- [ ] Tests green; EN baseline keys in place for T7.

**DoD:** lint + test + build pass. Consult the `testing` + `ergonomics-review`
skills.

---

## T6 — Admin feedback inbox

**Labels:** `frontend` · **Owner:** Front End Developer · **Branch:** `feat/feedback`

**Body**

Give the owner a triage inbox in `src/AdminPanel.jsx` (mirror the existing
requests/members sections and the `Switch`/section styling).

1. New **Feedback** tab: list newest-first via `src/api/feedback.js` (T4);
   filter by status (`open`/`in_progress`/`done`/`wontfix`/`duplicate`) and
   type; **unread count badge** on the tab.
2. Expand an item → message, type/category, author, and the auto-context
   (route, app version, device, timestamp).
3. Actions: change status (chips or select), add/edit an **admin note**
   (persisted via PATCH), **delete** (two-step confirm like member delete).
4. Loading/error/empty states; guards so a malformed item never crashes.
5. Component tests: list + filters, status change persists, note save, delete
   confirm, badge count.

**Acceptance criteria**
- [ ] Owner can triage every report end-to-end from the admin panel.
- [ ] Admin-only — members can never list the inbox (enforced server-side in T3;
      UI simply never offers it).
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `testing` skill.

---

## T7 — Localize feedback UI (7 locales)

**Labels:** `i18n`, `marketing` · **Owner:** Marketing Manager (copy) + Front
End Developer (plumbing) · **Branch:** `feat/feedback`

**Body**

Fill the `feedback.*` dictionary in `src/i18n/locales/{fr,nl,pt-BR,de,es,it}.js`
from the EN baseline (T5) using the glossary in
`marketing/localization-dictionary.md`. Copy lives in dictionaries — no
hardcoded strings. Keys to cover: modal title/subtitle, type toggle labels,
category names, textarea label + placeholder + char counter, auto-context row,
submit / submitting / success (+ reference id), error, admin tab labels
(statuses, filters, note, delete).

Note the tone: wry, warm collector voice (see `marketing/copy-kit-halcova.md`
+ `review-benefits-humor.md`). All strings `[VALIDATE]` with native testers
before the branch ships (per `marketing/localization-plan.md`).

**Acceptance criteria**
- [ ] All 6 non-EN locales complete; EN fallback for anything missing.
- [ ] No hardcoded user-facing strings in the feedback components.
- [ ] Dictionaries validated by native speakers (can be in parallel with T8).

**DoD:** lint + test pass.

---

## T8 — QA pass, DoD gates + security review

**Labels:** `qa`, `security` · **Owner:** Tester + Security Auditor ·
**Branch:** `feat/feedback`

**Body**

End-to-end verification of the whole feature before merge.

1. Full flow on dev: member submits suggestion + bug → confirmation id →
   owner sees both with context in the admin inbox → status change → note →
   delete. Repeat on the Blobs backend (no `DATABASE_URL`) and Postgres.
2. Edge cases: 4000-char message, whitespace-only, junk type/category/status,
   junk id, rapid-fire submits (rate-limit 429), member tries the admin
   endpoints (403), ErrorBoundary report path, offline submit (graceful
   failure, no dark screen).
3. Member-delete cascade: deleting a member removes their feedback (Blobs +
   Postgres).
4. Security review: no access codes / admin key logged or returned; input
   sanitized; no PII beyond the session.
5. Confirm `error.reported` copy is now truthful.
6. Gates: `npm run lint`, `npm test`, `npm run build` all green.

**Acceptance criteria**
- [ ] Every checklist item passes on both backends.
- [ ] No dark-screen / uncaught-error regression anywhere in the flow.
- [ ] Security review sign-off.

---

## T9 — Marketing: feedback channel copy + launch/tracking

**Labels:** `marketing` · **Owner:** Marketing Manager · **Branch:** `feat/feedback`

**Body**

Package the feature for members and for the launch.

1. **In-app copy** — the `feedback.*` EN baseline and tone for T5/T7
   (suggestion vs bug wording, confirmation line with reference id, admin
   status labels). Hand the exact keys to the Front End Developer; don't edit
   app code.
2. **"We read everything" launch moment** — a short social/newsletter beat
   (X · Instagram · WhatsApp · newsletter) telling members how to reach the
   team from Settings, aligned with the `campaign-viral-launch.md` calendar;
   copy bank entries in `campaign-copy-bank.md`.
3. **Tracking** — define the feedback funnel (open modal → submit → reference
   id), the KPI table from the epic §6, and where the inbox feeds the roadmap.
4. Add the feedback channel to `marketing/private-test-plan.md` as the
   always-on successor to the one-off form.

**Acceptance criteria**
- [ ] Copy bank + launch beat drafted; EN feedback strings handed off.
- [ ] KPI/measurement plan documented in this epic §6.
- [ ] No invented metrics or promises (no "instant reply" claims).

> **T9 deliverable:** `marketing/feedback-launch-beat.md` — the EN copy review
> + exact `feedback.*` / `admin.feedback.*` key handoff (§1), the "We read
> everything" launch beat + copy-bank entries (`campaign-copy-bank.md` §2), the
> feedback funnel + KPI table from epic §6 (§3), and the always-on successor to
> the private-test form (`private-test-plan.md` §6b). Docs/copy only — no app
> code.

---

## Creation order (paste into GitHub)

1. Create the **epic** issue (body = `marketing/epic-user-feedback.md`), label `epic`.
2. Create **T1 → T9** issues in order, each linked to the epic ("Epic: In-app feedback").
3. Assign owners per the table in the epic §8; add the `needs-planning` label
   until T1–T3 are scoped by Netlify Backend.
