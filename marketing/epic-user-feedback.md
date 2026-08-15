# Epic — In-app feedback: suggestions & bug reports

> **Status:** Draft for GitHub · **Owner:** Marketing Manager (channel + copy) /
> Project Manager (epic) · **Branch:** `feat/feedback` (off `main`, never `main`) ·
> **Paste target:** GitHub issue (label `epic`, link all subtasks to it)
> **Subtask issue bodies:** `marketing/epic-user-feedback-subtasks.md`
> **Based on:** `docs/functional.md`, `docs/technical.md`, the `reviews`
> feature (feat/reviews — the architectural precedent), `src/catalog.js`,
> `src/AdminPanel.jsx`, `src/components/ErrorBoundary.jsx`.

---

## 1. Why (background)

Members currently have **no way to report a suggestion or a bug inside the
app**. The only feedback path is the one-off private-test Google Form
(`marketing/private-test-plan.md` §6), which dies after the test circle. Once
the app opens to the public launch, the owner is blind to what members hit:
crash paths, confusing flows, and feature ideas all land nowhere.

There is one embarrassing truth in the current code that this epic fixes:
`ErrorBoundary.jsx` renders `error.reported` — *"This error has been
reported."* — but `componentDidCatch` only `console.error`s. **Nothing is
actually reported.** After this epic, that copy is true.

The goal: a low-friction, always-on, on-brand channel where any signed-in
member can (a) **suggest an idea** or (b) **report a problem**, and the owner
can triage everything in the existing admin panel — plus, in the same motion,
make the crash screen truthful.

---

## 2. Scope

### In scope (v1)
- Signed-in members + the owner can submit a **suggestion** or a **bug report**
  from inside the app (Settings → Feedback; and the ErrorBoundary crash card).
- Submission captures the user's message plus **auto-context** (current route,
  app version, device/user-agent, timestamp) so bug reports are actionable.
- Every report is stored server-side (Postgres first-class + Blobs fallback,
  exactly the `reviews` pattern) and shows up in the **admin panel inbox** for
  triage: filter, mark status (`open` → `in_progress` → `done` /
  `wontfix` / `duplicate`), add an internal admin note, delete.
- Submitter gets an instant confirmation with a **reference id**
  ("Thanks — we got it. #fb-xxxx").
- Abuse protection: auth on every request, rate-limit, length caps.
- All UI copy localized across the 7 supported locales (EN/FR/NL/PT-BR/DE/ES/IT).

### Out of scope (v1 — follow-ups)
- Screenshots / file attachments on reports.
- Public roadmap board where members see their suggestion adopted.
- Email auto-reply / notifications to the submitter when status changes.
- Anonymous (non-signed-in) submissions — feedback is only for members.

---

## 3. Who it serves

| Persona | Need |
| --- | --- |
| Collector member | Report a bug they hit / suggest an idea in < 30 seconds, from anywhere in the app, and know it was received. |
| Owner (admin) | One inbox to triage everything: no more DMs + WhatsApp + email scattering; see context (version/route/device) so a bug is reproducible. |
| Marketing | A real, always-on listening channel to feed the roadmap, and a "shape Halcova" story for the launch (see subtask T9). |

---

## 4. Architecture (mirrors the `reviews` feature)

### 4.1 Data model — new migration `db/migrations/006_feedback.sql`

First-class table (same design principle as `005_reviews.sql` — real columns,
CHECK constraints, no `data jsonb` mirror). Feedback is **not public** (unlike
reviews): it is private to the author + the owner.

```sql
CREATE TABLE feedback (
  id          uuid PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('suggestion','bug')),
  category    text NOT NULL DEFAULT 'other',   -- records|books|scanner|auth|billing|games|lending|other
  message     text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  author_id   text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  url         text NOT NULL DEFAULT '',        -- route where the report was made
  app_version text NOT NULL DEFAULT '',
  user_agent  text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open',    -- open|in_progress|done|wontfix|duplicate
  admin_note  text NOT NULL DEFAULT '',        -- owner-only
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_status_idx ON feedback (status, created_at DESC); -- inbox sort
CREATE INDEX feedback_author_idx  ON feedback (author_id);              -- member-delete cleanup
```

### 4.2 Persistence seam (reviews pattern)
- `netlify/functions/_shared/repositories/feedback-repo.js` — Postgres repo
  (CRUD: `createFeedback`, `listFeedback({status,type})`, `updateFeedback`
  (status/adminNote), `deleteFeedback`, `deleteByAuthor` for member-delete
  cleanup). Unit tests with **pg-mem** against the real `006_feedback.sql`
  (mirror `reviews-repo.test.js`).
- `netlify/functions/_shared/feedback-blob.js` — Blobs fallback store
  (mirror `reviews-blob.js`; store `runout-feedback`, keys `fb:<id>` + an
  `index:open` enumeration). Unit tests with the in-memory blobs-shaped store.
- `netlify/functions/_shared/repository.js` — expose `feedback` on the
  repository object (`backend === 'postgres' ? feedback-repo : feedback-blob`),
  matching how `users`/`items`/`lookupCache` are wired.

### 4.3 API — new function `netlify/functions/feedback.js`
Mirror the function conventions (`json()`, `bearer()`, action/method dispatch —
follow the existing style of `admin.js`/`collection.js`).

| Method | Endpoint | Auth | Body / params | Returns |
| --- | --- | --- | --- | --- |
| POST | `/api/feedback` | Bearer code (member) **or** admin key | `{ type, category?, message, url?, appVersion? }` | `201 { id, … }` (sanitized) |
| GET | `/api/feedback` | admin key | `?status=&type=` | `{ items: […] }` |
| PATCH | `/api/feedback` | admin key | `{ id, status?, adminNote? }` | updated item |
| DELETE | `/api/feedback` | admin key | `?id=` | `204` |

Guards:
- **Rate-limit** submissions with the existing `_shared/rate-limit.js`
  (`rateLimitKey(scope, identity)`, `nextCounter`) — e.g. 5 submissions / hour
  per user; 429 + `Retry-After` on exceed.
- **Sanitize**: `type`/`category`/`status` against allow-lists (junk values
  never 500, mirror `asStatus` in reviews), `message` trimmed + capped at 4000
  chars, author derived **server-side from the session** (never trusted from
  the body), `author_name` from the user record.
- **Never log or return** access codes / the admin key / `code_hash`.

### 4.4 Client
- `src/api/feedback.js` — `submitFeedback`, `listFeedback`,
  `updateFeedback`, `deleteFeedback` (mirror `src/api/auth.js` / `collection.js`:
  Bearer header, error `code` passthrough). Unit tests with mocked `fetch`.
- `src/components/FeedbackModal.jsx` — bottom sheet, on-theme (`#16130F` +
  gold tokens from `src/index.css`): segmented **Suggestion / Report a problem**
  toggle, optional category chips, message textarea with live char counter,
  optional auto-context line (route + app version + device, pre-checked), and a
  submit → "Thanks — we got it. #fb-…" confirmation state.
- Entry points:
  - **Settings** (`src/components/SettingsModal.jsx`) — a "Feedback" card/link.
  - **ErrorBoundary** (`src/components/ErrorBoundary.jsx`) — a
    "Report a problem" button on the crash card that opens the modal pre-filled
    with `type=bug` + current route/version. **This makes the existing
    `error.reported` copy truthful.**
- `src/App.jsx` — own `feedbackOpen` state + modal mount (mirror
  `settingsOpen` / `creditOpen`).
- `src/AdminPanel.jsx` — a **Feedback** tab: list (status/type filters), expand
  item → message + auto-context + author, status actions, admin note, delete,
  unread count badge.

### 4.5 i18n
- Add `feedback.*` keys to `src/i18n/locales/en.js` as the **baseline** (T5),
  then fill FR/NL/PT-BR/DE/ES/IT from the Marketing dictionary (T7). Copy
  lives in the catalog/dictionaries — never hardcoded in components.

---

## 5. Security & privacy

- Every request authorized (Bearer code / admin key). Admin read/update/delete
  is admin-key only.
- Feedback is user-generated content: treat as untrusted input, allow-list +
  length-cap + escape on render (dark-screen safety, no error boundary —
  guard every new data path with `?.`).
- Store the minimum: author id/name, message, auto-context. **No** access
  codes, no extra PII beyond what the session already holds.
- **Member deletion must cascade** — remove the member's feedback (like
  reviews' `deleteByAuthor` / `deleteUserCollections`).
- Rate-limit + caps to prevent spam/abuse of the inbox.

---

## 6. Measurement (Marketing KPIs)

| KPI | Definition | Target (launch window) |
| --- | --- | --- |
| Feedback activation | members who submit ≥ 1 report | ≥ 15% of active members |
| Submission rate | reports per 100 session | watch; sanity floor & ceiling |
| Suggestion vs bug mix | split of `type` | expect ~60/40 early |
| Bug → fix time | median time `open` → `done` | < 7 days (inbox makes this visible) |
| Closure loop | share of reports with a status change / admin note | 100% within 14 days (owner workflow) |
| Reference-id reach | submitter saw the confirmation | ~100% (toast + id) |

Tracking hooks: an app event `feedback_submitted { type, category }` can be
added later via the analytics layer; for now the admin inbox IS the data source.

---

## 7. Definition of Done (epic-level)

- [ ] A member can submit a suggestion and a bug report from Settings; the
      owner sees both in the admin inbox with full context.
- [ ] The ErrorBoundary "Report a problem" path actually reports (and the
      `error.reported` copy becomes true).
- [ ] Every report is persisted (Postgres when configured, Blobs otherwise)
      and survives reload.
- [ ] Admin can filter, change status, add a note, and delete reports.
- [ ] All feedback UI is localized in the 7 locales; no hardcoded strings.
- [ ] Auth on every call, rate-limit enforced, member-delete cascades,
      no secret leaks (checked by Security Auditor).
- [ ] `npm run lint`, `npm test`, `npm run build` all pass.
- [ ] Branch `feat/feedback` → PR (never `main`).

---

## 8. Subtasks (linked issues)

| # | Title | Files | Owner |
| --- | --- | --- | --- |
| T1 | Feedback database schema + Postgres repository | `006_feedback.sql`, `repositories/feedback-repo.js` (+ pg-mem tests) | Netlify Backend |
| T2 | Feedback Blobs fallback store + repository seam | `_shared/feedback-blob.js`, `repository.js` (+ tests) | Netlify Backend |
| T3 | `feedback.js` Netlify function (submit + admin CRUD, auth, rate-limit) | `netlify/functions/feedback.js` (+ tests) | Netlify Backend |
| T4 | Client API module | `src/api/feedback.js` (+ mocked-fetch tests) | Front End Developer |
| T5 | FeedbackModal + entry points (Settings, ErrorBoundary) + EN keys | `src/components/FeedbackModal.*`, `SettingsModal.jsx`, `ErrorBoundary.jsx`, `App.jsx`, `en.js` (+ tests) | Front End Developer |
| T6 | Admin feedback inbox | `AdminPanel.jsx` (+ tests) | Front End Developer |
| T7 | Localize feedback UI (7 locales) | `src/i18n/locales/*.js`, dictionary | Marketing Manager (+ copy) |
| T8 | QA pass + DoD gates + Security review | e2e flow, edge cases, coverage, lint/test/build | Tester + Security Auditor |
| T9 | Marketing: feedback channel copy + launch/tracking | `marketing/` (this epic, dictionary, launch content) | Marketing Manager |

**Sequencing:** T1 → T2 → T3 → T4 → T5 (+T7 copy in parallel once EN keys land)
→ T6 → T8 → T9. T1–T3 are independent of the UI and can start immediately.

---

## 9. Claims needing product validation

1. **`error.reported` is currently false** — the ErrorBoundary claims errors
   are reported when nothing is reported. This epic must make it true (or the
   copy must change). Flagged for the implementer + QA.
2. Screenshots/attachments and email replies are explicitly deferred — do not
   promise them in copy.
3. Rate-limit numbers (5/hour) are a starting point — validate against real
   usage in T8.
