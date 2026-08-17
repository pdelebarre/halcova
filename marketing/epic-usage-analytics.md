# Epic — Opt-in usage analytics & performance dashboards

> **Status:** Draft for GitHub · **Owner:** Project Manager (epic) / Netlify
> Backend + Front End Developer + Scanner Builder (implementation) · **Branch:**
> `feat/usage-analytics` (off `main`, never `main`) · **Paste target:** GitHub
> issue (label `epic`, link all subtasks to it)
> **Subtask issue bodies:** `marketing/epic-usage-analytics-subtasks.md`
> **Based on:** `src/utils/track.js`, `netlify/functions/_shared/repository.js`,
> `repositories/`, `db/migrations/`, `_shared/audit.js`, `_shared/security.js`,
> `_shared/rate-limit.js`, `netlify.toml`, `docs/technical.md` §13 (privacy
> policy), `docs/gamification-phase0.md` §4, and the reflection of the Whole
> Stack Architect, Netlify Backend, Security Auditor and Ergonomics Reviewer
> agents.
> **Builds on:** `marketing/epic-admin-dashboard.md` (the Dashboard tab this
> epic's *visits* + *performance* cards extend).

---

## 1. Why (background)

The companion dashboard epic gives the owner counts that already exist in the
data. But two of the owner's asks — **"number of visits"** and
**"performance information"** — exist nowhere today. There is no endpoint, no
table, and no collection for page views, unique sessions, device/perf timings,
or function latency/error rate.

The intended vehicle already exists but is inert: `src/utils/track.js` is a
clean, **DEFAULT-OFF, first-party** analytics queue (sanitized props, capped at
500 events, never throws) whose `flushEvents()` is a documented **no-op with no
endpoint**. Gamification already emits `gamif_*` events into it. This epic wires
that queue end-to-end — a privacy-first, opt-in telemetry pipeline — and turns
it into an owner-facing *visits* + *performance* dashboard, while explicitly
keeping the "no third-party analytics, opt-in only" promise in `docs/technical.md`
§13.

This is a **security-gated change**: a new authorized endpoint, a public write
surface (ingest), user-data-adjacent telemetry, and storage. Threat modeling +
negative security tests + a Security Auditor review are mandatory (see §6 and
the `security-runbook`).

---

## 2. Scope

### In scope (v1)
- **Client telemetry (opt-in, anonymous):** `session_start`, `page_view`, one
  coarse `perf` app-load event, and scan outcomes (`scan_success` / `scan_fail`).
  Emitted only when the member/visitor has opted in; never for a non-opted user.
- **Flush:** implement `flushEvents()` to POST a bounded batch of sanitized
  queued events to a new first-party endpoint, on an interval (~60s while
  enabled) **and** on `visibilitychange`/`beforeunload` via `sendBeacon` when
  available. Best-effort, never throws, queue persists on failure (existing
  `track.js` guarantees).
- **Server ingest:** new `netlify/functions/analytics.js` with a `POST /ingest`
  that is **public by design** (it must accept anonymous visitors) but
  **re-sanitizes server-side** (client `sanitize()` is not a trust boundary),
  allowlists event names + props, rate-limits per IP, caps batch size + body,
  and writes through the repository seam. **Never trusts the client.**
- **Persistence:** migration `008_analytics.sql` — `analytics_events` (raw,
  short-retention) + `analytics_daily` (precomputed daily rollup) + a
  `users.last_seen_at` column (cheap active-user proxy); plus a `runout-analytics`
  Blobs fallback using **append-only batch keys** (Blobs has no transactions —
  never mutate a shared counter in place).
- **Dashboard read:** `GET /analytics?action=dashboard`, `requireAdmin`-gated,
  returns **aggregate series only** (visits, unique visitors, performance
  percentiles) that the AdminPanel Dashboard tab renders alongside the epic-1
  counts.
- **Read model:** live aggregate for "today" over the indexed raw events + the
  precomputed `analytics_daily` for history (idempotent daily rollup; lazy
  rollup-on-read is fine at this scale).

### Out of scope (v1 — follow-ups)
- Scheduled daily rollup cron + raw-event retention/pruning (v2).
- Sampled web-vitals (LCP/INP) and per-function latency in-app (v2 — v1 uses
  Netlify's native function metrics + `anomaly.js` for function health).
- Full RUM, funnels, per-kind dashboards, raw frame-by-frame scanner timings.
- A separate analytics warehouse (documented as a future trigger, not a build).

---

## 3. Who it serves

| Persona | Need |
| --- | --- |
| Owner (admin) | See how many people are visiting/active, on what devices, and whether the app is healthy (scan success, load time, function errors) — from the admin panel. |
| Member / visitor | Full control: analytics are **off by default**, anonymous, first-party, and privacy-minimal. |

---

## 4. Architecture (mirrors the reviews/feedback Postgres-first + Blobs-fallback pattern)

### 4.1 Telemetry pipeline

```
PWA (track.js queue, opt-in)                       Server
  ─ sanitize() on client ─────────────────────────►
  POST /.netlify/functions/analytics (flush)  ──►  validate + redactFields (defense-in-depth)
                                                    ──► repository seam (getRepository)
                                                          ├─ Postgres: analytics_events + analytics_daily (008)
                                                          └─ Blobs:   append-only batch keys (no in-place counters)
  dashboard (AdminPanel → Dashboard tab) ──GET──►  requireAdmin ──► rollup / live aggregate
```

Key decisions:
- **Client id is a per-installation random UUID** (`localStorage.runout.analyticsId`),
  **not** a user identity — "visits / unique devices" with no PII and no link to
  member identity. It is *not* the session token.
- **Flush auth:** accept a Bearer session token if present (to coarsely gate +
  rate-limit per identity), but **events are anonymous** (client_id + sanitized
  props). Logged-out visitors are still countable for "visits".
- **No-consent floor:** server-side counts (users, logins from `sessions`) are
  always available regardless of opt-in; client telemetry is additive.

### 4.2 Migration `008_analytics.sql` (Postgres-first)
Follow the `reviews`/`feedback` first-class-column convention. **Note the naming
collision:** `db/rls/008_rls.sql` exists in a *separate* RLS runner/namespace —
prefer `008_analytics.sql` in `db/migrations/` and flag the collision in the
ticket (rename to `009` if it causes confusion).

```sql
CREATE TABLE analytics_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  text NOT NULL,               -- per-installation uuid — NOT a user id
  event      text NOT NULL,               -- page_view|session_start|scan_success|scan_fail|perf|gamif_*
  ts         timestamptz NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}', -- sanitized scalar props only
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_day_idx      ON analytics_events (date_trunc('day', ts));
CREATE INDEX analytics_events_event_day_idx ON analytics_events (event, date_trunc('day', ts));

CREATE TABLE analytics_daily (             -- what dashboards read
  day    date NOT NULL,
  metric text NOT NULL,                    -- visits|active_users|page_views|scans|scan_success|scan_fail|perf
  kind   text NOT NULL DEFAULT '',         -- collection dimension; '' = all
  value  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, kind)
);
```
Plus additive `users.last_seen_at timestamptz` (nullable, like 003/004).

### 4.3 Blobs fallback (no transactions)
Store `runout-analytics` with **append-only batch keys** — a new key per flush,
never an in-place counter (avoids the Blobs lost-update race; mirrors how
`reviews-blob.js` stays correct):

```
analytics:day:<YYYY-MM-DD>:<batchUuid> -> { clientId, events: [{event, ts, props}, …] }
```

### 4.4 Persistence seam
`analytics-repo.js` (Postgres) + `analytics-blob.js` (Blobs) behind the existing
`getRepository()` seam so `getRepository().analytics` works on both backends.
Analytics writes are non-auth (best-effort write-through, like items/feedback).

### 4.5 The `analytics` Netlify function
| Method | Endpoint | Auth | Returns |
| --- | --- | --- | --- |
| POST | `/analytics?action=ingest` | Bearer optional; **server-side sanitize + allowlist + rate-limit** | `201 { ok }` / `400` / `413` / `429` |
| GET | `/analytics?action=dashboard` | **`requireAdmin`** | aggregate series (visits, unique, perf) |

Ingest guards (non-negotiable — see §6): enum-allowlist event names + per-event
allowed props, `rejectUnknown`-style unknown-key rejection, drop secret-keyed
props (reuse `redactFields` from `_shared/audit.js`), length-caps + body/batch
caps, per-IP rate limit (`createRateLimiter` + `clientIp`) **and** a total-volume
ceiling, batched writes (a 500-sequential-write flush would blow the ~10s
function timeout). Never log raw bodies — route through `logAudit`/`safeError`
redaction.

### 4.6 Client changes (`src/utils/track.js` + call sites)
- Implement `flushEvents()`: POST a bounded batch (≤100) to
  `/analytics?action=ingest` (same-origin — `connect-src 'self'` in
  `netlify.toml` permits it); on success `clearEvents()`, on failure keep the
  queue. Only flush when `isTrackingEnabled()`; never throw.
- Emit `session_start`, `page_view`, one coarse `perf` (via
  `performance.getEntriesByType('navigation')` → `domContentLoaded`/`load`), and
  `scan_success`/`scan_fail` from `ScannerModal` (outcome only, not per-frame).
- Flush on interval + `visibilitychange`/`beforeunload` (`sendBeacon` when
  available; best-effort).
- **`sanitize()` NIT:** the current `/code|token|key|secret|…/i` regex is
  over-broad (also drops `keyboard`, `monkey`, `author`). Narrow to exact secret
  keys (mirror `SECRET_KEYS` in `_shared/audit.js`) so intended fields like
  `kind` survive. Add a regression test that a benign prop survives.

### 4.7 Performance definition (pragmatic, at this scale)
- **Core (v1):** visits (distinct client_id/day), active users (server-side
  logins + client `session_start`), page views, scan success/failure, one coarse
  client load `perf` event. Function health from **Netlify's native function
  metrics** + existing `anomaly.js` burst detection (consume, don't build a
  per-request logger).
- **Deferred (v2):** web-vitals, per-function latency in-app, funnels.

---

## 5. Ergonomics (owner-facing)

The Dashboard tab (from the companion epic) gains **Visits** and **Performance**
sections: big gold numbers, `tabular-nums`, 2-column grid on ≤375px, `<dl>`
semantics, display-only cards, guarded loading/error/empty states (no
dark-screen). Add a "Last updated" caption and a retry affordance. Respect the
alert-fatigue rule — no live-updating `aria-live` (values change on navigation).
If sparklines are ever added, mark them `aria-hidden` with a text alternative
(v1 = big numbers only).

---

## 6. Security & privacy (MANDATORY GATE)

This change is **gated**: new external surface (public ingest), user-data
telemetry, and storage. From the Security Auditor review, the non-negotiables:

1. **Dashboard read is `requireAdmin`-gated** and returns **aggregates only** —
   never raw IPs, emails, user ids, or client ids; member/demo/forged → 401/403.
2. **Ingest is a public write surface** — it must **re-sanitize server-side**
   (client `sanitize()` is not a trust boundary): enum-allowlist event names,
   allowlisted prop keys, drop `SECRET_KEYS` props + nested/non-primitive values,
   length caps, per-IP rate limit **and** a total-volume ceiling.
3. **PII minimization:** anonymous `client_id` only; never join analytics to
   member identity; never persist raw IP/email; no consent bypass (DEFAULT-OFF;
   flush never fires before opt-in).
4. **Redaction-routed logging:** no raw bodies/codes/tokens/emails in logs.
5. **Retention:** short raw retention + rollup policy (align with
   `docs/technical.md` §13 data classification).

**Negative security tests that MUST ship** (see subtasks): unauth dashboard
401; member/demo/forged 403; unknown event/prop → 400; oversized body/batch →
413; secret-shaped props dropped (server-side, not persisted); nested props
dropped; per-IP rate limit → 429; volume ceiling enforced; redaction verified in
logs; dashboard response has no email/name/ip/code/token.

---

## 7. Definition of Done (epic-level)

- [ ] Opt-in telemetry flows PWA → flush endpoint → Postgres/Blobs for
      `session_start`, `page_view`, `perf`, `scan_*` — and only when opted in.
- [ ] The owner sees **Visits** (page views, unique visitors, active users) and
      **Performance** (load + scan success/error, function health) in the admin
      Dashboard tab.
- [ ] Ingest is server-side-sanitized, allowlisted, rate-limited + capped;
      dashboard is `requireAdmin`-gated and returns aggregates only.
- [ ] No secret/PII ever persisted or logged; consent stays DEFAULT-OFF.
- [ ] All negative security tests ship and pass; **Security Auditor sign-off
      recorded**.
- [ ] All UI localized in the 7 locales; no hardcoded strings.
- [ ] `npm run lint`, `npm test`, `npm run build` pass; coverage ≥ 70%.
