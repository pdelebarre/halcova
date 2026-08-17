# Subtasks — Epic: Opt-in usage analytics & performance dashboards

Paste each section below into its own GitHub issue. Link every issue to the
epic (`marketing/epic-usage-analytics.md`) and add the suggested labels. Work on
branch `feat/usage-analytics` (off `main`, never `main`) — see the
`feature-branching` skill. Build the companion epic
`marketing/epic-admin-dashboard.md` first (this extends its Dashboard tab).

Suggested labels: `epic` (the epic itself), `backend`, `frontend`, `security`,
`i18n`, `qa`, `privacy`, `enhancement`, `admin`.

---

## T1 — Analytics schema + Postgres repository (migration 008)

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/usage-analytics`

**Body**

Add the first-class Postgres analytics tables, mirroring the `reviews`/`feedback`
pattern (migration + repository with pg-mem tests).

1. `db/migrations/008_analytics.sql`:
   - `analytics_events` — `id bigint identity`, `client_id text NOT NULL`
     (per-installation uuid, **not** a user id), `event text NOT NULL`,
     `ts timestamptz NOT NULL`, `props jsonb NOT NULL DEFAULT '{}'`
     (sanitized scalars only), `created_at`; indexes on
     `(date_trunc('day', ts))` and `(event, date_trunc('day', ts))`.
   - `analytics_daily` — `day date`, `metric text`, `kind text DEFAULT ''`,
     `value bigint DEFAULT 0`, `PRIMARY KEY (day, metric, kind)`.
   - Additive `users.last_seen_at timestamptz` (nullable).
   - ⚠️ Naming: `db/rls/008_rls.sql` exists in a **separate** RLS runner — keep
     `008_analytics.sql` in `db/migrations/` and note the collision; rename to
     `009` if it causes confusion.
2. `netlify/functions/_shared/repositories/analytics-repo.js` — `appendBatch`,
   `queryEvents({ from, to, event? })`, `upsertDaily(day, metric, kind, value)`
   (idempotent), `rollupDaily(day)` (recompute whole day: `DELETE day; INSERT
   SELECT`), `lastSeen` helpers. Allow-list metrics. Unit tests with **pg-mem**
   against the real `008_analytics.sql`.

**Acceptance criteria**
- [ ] Migration applies via `npm run db:migrate` and on pg-mem.
- [ ] Repo methods covered by unit tests (`npm test` green).
- [ ] Daily rollup is idempotent (re-running a day is correct by construction).
- [ ] No `data jsonb` mirror for queryable fields — first-class columns.

**DoD:** lint + test pass. Consult the `netlify-collection` + `testing` skills.

---

## T2 — Analytics Blobs fallback + repository seam

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/usage-analytics`

**Body**

Blobs fallback so analytics work when `DATABASE_URL` is unset or Postgres is
down (mirror `reviews-blob.js` + `repository.js`).

1. `netlify/functions/_shared/analytics-blob.js` — store `runout-analytics`;
   **append-only batch keys** `analytics:day:<YYYY-MM-DD>:<batchUuid>` →
   `{ clientId, events }` (no transactions in Blobs — never mutate a shared
   counter in place; avoids the lost-update race). Ops: `appendBatch`,
   `queryDay(day)`, `rollupDay(day)` (aggregate the day's batch keys on read).
2. `netlify/functions/_shared/repository.js` — expose `analytics` on the
   repository object (`postgres` → T1 repo, `blobs` → this store).
3. Tests in `analytics-blob.test.js` with the in-memory blobs-shaped store:
   append, day query, rollup, empty-day handling.

**Acceptance criteria**
- [ ] Blobs impl mirrors the T1 API surface so the function can switch paths.
- [ ] No in-place counter mutation (append-only).
- [ ] Seam wired with no changes to existing callers; unit tests green.

**DoD:** lint + test pass. Consult the `netlify-collection` skill.

---

## T3 — `analytics.js` Netlify function: ingest (POST) + dashboard (GET)

**Labels:** `backend`, `security`, `privacy` · **Owner:** Netlify Backend ·
**Branch:** `feat/usage-analytics`

**Body**

New function `netlify/functions/analytics.js` (mirror `admin.js` conventions:
`json()`, `readJsonBody`, `createRateLimiter`, `logAudit`).

- **`POST /analytics?action=ingest`** — PUBLIC write surface (must accept
  anonymous visitors), Bearer session optional. **Server-side sanitize is
  MANDATORY (client `sanitize()` is not a trust boundary):**
  - Enum-allowlist event names (`page_view|session_start|scan_success|scan_fail|perf|gamif_*`);
    `rejectUnknown`-style rejection of unknown event names and unknown prop keys
    → `400`.
  - Drop `SECRET_KEYS`-style props (`code|token|key|secret|barcode|isbn|pin|…`)
    and any nested/non-primitive value (reuse `redactFields` from
    `_shared/audit.js`); length-cap strings; accept client `ts` only for
    ordering or server-stamp it.
  - Per-IP rate limit (`createRateLimiter` + `clientIp`) **and** a total-volume
    ceiling; body/batch caps (`readJsonBody` already bounds to 64 KB; use a
    smaller cap for events) → `413`.
  - **Batched writes** (single insert/batch key per flush — 500 sequential
    writes would blow the ~10s function timeout).
  - Never log raw bodies — route through `logAudit('analytics.flush_rejected')` /
    `safeError` redaction.
- **`GET /analytics?action=dashboard`** — **`requireAdmin`-gated**; returns
  **aggregate series only** (page views, unique visitors, active users, scan
  success/error, coarse perf) as `visits`, `performance`, `events` blocks; live
  aggregate for today + `analytics_daily` for history (lazy rollup ok).
- Endpoint tests (mirror `admin.test.js`): **all** negative security tests from
  epic §6 (unauth 401, member/demo 403, unknown event/prop 400, oversized 413,
  secret-shaped props dropped, nested props dropped, rate-limit 429, volume
  ceiling, redaction in logs, no raw email/name/ip/code/token in dashboard).

**Acceptance criteria**
- [ ] Ingest never trusts the client; nothing secret/PII is ever persisted.
- [ ] Dashboard is `requireAdmin`-gated, aggregates only.
- [ ] All negative security tests pass on Postgres **and** Blobs.
- [ ] Security Auditor review passes (record sign-off).

**DoD:** lint + test pass. Consult the `netlify-collection` + `auth-access` +
`security` skills.

---

## T4 — Client: wire `flushEvents()` + emit coarse events

**Labels:** `frontend` · **Owner:** Front End Developer (+ Scanner Builder for
scan events) · **Branch:** `feat/usage-analytics`

**Body**

Make `src/utils/track.js` actually flush, and emit the v1 event set — all
gated on the existing DEFAULT-OFF opt-in.

1. Implement `flushEvents()`: POST a bounded batch (≤100) of queued events to
   `/analytics?action=ingest` (same-origin — `connect-src 'self'` in
   `netlify.toml` permits it), Bearer session if present; on success
   `clearEvents()`, on failure keep the queue (retry next flush). Only flush
   when `isTrackingEnabled()`; **never throw** (no error boundary).
2. Flush on an interval (~60s while enabled) **and** on
   `visibilitychange`/`beforeunload` via `sendBeacon` when available
   (best-effort, offline-safe).
3. Emit: `session_start` (on opt-in session), `page_view` (on route change),
   one coarse `perf` load event (via `performance.getEntriesByType('navigation')`
   → `domContentLoaded`/`load`), and `scan_success`/`scan_fail` from
   `src/components/ScannerModal.jsx` (outcome only, never per-frame).
4. **`sanitize()` NIT:** narrow the over-broad `/code|token|key|…/i` regex to
   exact secret keys (mirror `SECRET_KEYS`) so benign props like `kind` survive;
   add a regression test that a benign prop survives.
5. Client id: per-installation `localStorage.runout.analyticsId` uuid (not a
   user identity).
6. Tests (mirror `track.test.js`): flush success clears queue, failure keeps
   queue, never throws, no flush before opt-in, sanitize narrows correctly,
   sendBeacon path.

**Acceptance criteria**
- [ ] Events flush only when opted in; nothing secret leaves the client.
- [ ] Never throws / never dark-screens the PWA.
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `testing` + `barcode-scanning`
skills (for the scan events).

---

## T5 — Frontend: Visits + Performance cards in the Dashboard tab

**Labels:** `frontend`, `i18n` · **Owner:** Front End Developer ·
**Branch:** `feat/usage-analytics`

**Body**

Extend the Dashboard tab (from `marketing/epic-admin-dashboard.md`) with the
analytics read model from T3.

1. `src/api/analytics.js` — `getDashboard()` (Bearer admin session) returning
   the `visits` / `performance` / `events` blocks; error `code` passthrough,
   never throws uncaught. Tests with mocked `fetch`.
2. New **Visits** section (page views, unique visitors, active users — big gold
   numbers, `tabular-nums`, `<dl>` semantics, 2-column grid on ≤375px,
   display-only cards) and a **Performance** section (scan success/error rate,
   coarse load time, function-health note). "Last updated" caption + retry
   affordance.
3. Guarded loading / error / empty states mirroring the feedback tab; guard
   every read with `?.`/coercion (no error boundary — never dark-screen).
4. If any card shows a non-authoritative / low-opt-in figure, show a small
   caption (e.g. "opt-in" / "estimate") so the owner reads it correctly.
5. Component tests: cards render, loading → data, error → retry, empty state,
   malformed-data safety.

**Acceptance criteria**
- [ ] Owner sees Visits + Performance from the admin panel.
- [ ] No uncaught error / dark screen on any analytics path.
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `testing` + `ergonomics-review`
skills.

---

## T6 — i18n: analytics dashboard labels (7 locales)

**Labels:** `i18n`, `marketing` · **Owner:** Marketing Manager (copy) + Front
End Developer (plumbing) · **Branch:** `feat/usage-analytics`

**Body**

Add `admin.*` analytics keys to `src/i18n/locales/{en,fr,nl,pt-BR,de,es,it}.js`
from the EN baseline (glossary in `marketing/localization-dictionary.md`): section
labels (Visits, Performance), card labels + captions (Page views, Unique
visitors, Active users, Scan success rate, Avg load), "opt-in"/"estimate"
captions, "Last updated", loading / error / empty strings. Number formatting via
`toLocaleString(getLocale())`; keep raw counts. `src/i18n/index.test.jsx`
enforces key parity.

**Acceptance criteria**
- [ ] All 7 locales complete; EN fallback for anything missing.
- [ ] No hardcoded user-facing strings.
- [ ] i18n key-parity test green.

**DoD:** lint + test pass.

---

## T7 — Security gate: threat model, negative tests, Security Auditor sign-off

**Labels:** `security`, `qa` · **Owner:** Security Auditor + Tester ·
**Branch:** `feat/usage-analytics`

**Body**

Formal security gate for this gated epic (new external surface + user-data
telemetry + storage).

1. **Threat model** (Security Auditor) covering: unauthenticated dashboard 401;
   member/demo/forged 403; ingest as a public write surface (secret/PII
   injection, storage-fill/cost DoS, junk-event pollution, forged
   visits/performance, forged client timestamps); PII minimization (anonymous
   client_id, no raw IP/email); redaction-routed logging; retention.
2. **Negative security tests** (Tester) — the full suite from epic §6, run on
   Postgres **and** Blobs; verify no secret/PII ever persisted or logged.
3. **Sign-off:** Security Auditor must record an explicit PASS (with any
   residual findings by severity) before the epic is declared done. No HIGH/MEDIUM
   findings outstanding.
4. Confirm `npm run lint`, `npm test`, `npm run test:coverage` (≥70%),
   `npm run build` all pass.

**Acceptance criteria**
- [ ] Threat model documented; all negative tests green on both backends.
- [ ] Security Auditor PASS recorded.
- [ ] All gates green; coverage ≥ 70%.

**DoD:** lint + test + coverage + build pass.

---

## T8 — (Follow-up) Rollup scheduling + raw-event retention

**Labels:** `backend`, `privacy` · **Owner:** Netlify Backend ·
**Branch:** `feat/usage-analytics`

**Body**

Post-v1 hardening (do not block T1–T7).

1. Idempotent **daily rollup** via a scheduled Netlify function (cron) —
   recompute each day from raw events (`DELETE day; INSERT SELECT`) rather than
   incremental accumulation.
2. **Retention/pruning** for `analytics_events` (raw log, e.g. 90 days) aligned
   with `docs/technical.md` §13 data classification; keep `analytics_daily`
   (the dashboard's source) indefinitely.
3. Optional: sampled web-vitals and, only if wanted, in-app per-function
   latency (else rely on Netlify's native function metrics).
4. Tests: rollup idempotency + retention pruning.

**Acceptance criteria**
- [ ] Daily rollup runs automatically and is correct by construction.
- [ ] Raw events are pruned per the retention policy; daily aggregates retained.
- [ ] Tests green.

**DoD:** lint + test pass. Consult the `netlify-collection` + `pwa-offline`
skills.
