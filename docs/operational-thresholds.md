# Operational Thresholds — Rate Limiting, Abuse Protection & Cost Controls

> SEC-7.4 (#341). This is the **operational threshold documentation** exit
> evidence for the rate-limit / abuse / cost-ceiling work in Epic #337
> (M1 security-foundation). It is the single source of truth for every
> configurable threshold on the backend: **endpoint × limit × scope × env var ×
> default**, plus the AI cost-ceiling table.
>
> Every value is env-tunable; the documented default applies when the env var
> is unset. All fixed-window limiters share the same 60-second window unless
> stated otherwise and degrade open (a limiter store failure lets the request
> through — never a 500).

## 1. Rate-limit matrix

| Endpoint | Surface | Scope | Env var | Default | Keyed on |
|---|---|---|---|---|---|
| Auth — login | brute-force | `auth:login:ip` | `RUNOUT_AUTH_LOGIN_IP_RATE_LIMIT` | 30/min | client IP |
| Auth — login | per-account | `auth:login:code` | `RUNOUT_AUTH_LOGIN_RATE_LIMIT` | 20/min | normalized code |
| Auth — request access | anti-spam | `auth:request` | `RUNOUT_AUTH_REQUEST_RATE_LIMIT` | 10/min | email |
| Auth — me (session validate) | churn | `auth:me` | `RUNOUT_AUTH_ME_RATE_LIMIT` | 60/min | session token |
| Auth — magic-link issue | per-IP | `auth:magiclink:ip` | `RUNOUT_AUTH_MAGICLINK_IP_RATE_LIMIT` | 10/min | client IP |
| Auth — magic-link issue | per-email | `auth:magiclink:email` | `RUNOUT_AUTH_MAGICLINK_RATE_LIMIT` | 5/min | email |
| Auth — magic-link verify | brute-force | `auth:magiclink:verify:ip` | `RUNOUT_AUTH_MAGICLINK_VERIFY_IP_RATE_LIMIT` | 20/min | client IP |
| **Auth — logout** (SEC-7.4) | churn | `auth:logout` | `RUNOUT_AUTH_LOGOUT_RATE_LIMIT` | 60/min | session token |
| **Auth — logoutAll** (SEC-7.4) | per-IP | `auth:logoutAll:ip` | `RUNOUT_AUTH_LOGOUT_ALL_IP_RATE_LIMIT` | 60/min | client IP |
| Admin — writes | per-IP | `admin` | `RUNOUT_ADMIN_RATE_LIMIT` | 120/min | client IP |
| **Admin — writes** (SEC-7.4) | per-account | `admin:account` | `RUNOUT_ADMIN_ACCOUNT_RATE_LIMIT` | 120/min | admin user id |
| **Admin — writes** (SEC-7.4) | overall | `admin:overall` | `RUNOUT_ADMIN_OVERALL_RATE_LIMIT` | 400/min | `all` (fixed) |
| Collection — all | per-user | `collection:<col>` | `RUNOUT_COLLECTION_RATE_LIMIT` | 60/min | user id (demo: IP) |
| **Collection — writes** (SEC-7.4) | sub-limit | `collection:<col>:write` | `RUNOUT_COLLECTION_WRITE_RATE_LIMIT` | 30/min | user id (demo: IP) |
| Reviews — writes | per-identity | `reviews:<kind>` | `RUNOUT_REVIEWS_RATE_LIMIT` | 30/min | user id (demo: IP) |
| Reviews — distinct releases (M3) | per-identity | `reviews-distinct:<kind>` | `RUNOUT_REVIEWS_DISTINCT_LIMIT` | 10/win | user id (demo: IP) |
| **Reviews — reads** (SEC-7.4) | per-identity | `reviews:read` | `RUNOUT_REVIEWS_READ_RATE_LIMIT` | 300/min | user id (demo: IP) |
| Books lookup | per-user | `books:user` | `RUNOUT_BOOKS_RATE_LIMIT` | 60/min | user id (demo: IP) |
| Books lookup | overall | `books:overall` | `RUNOUT_BOOKS_OVERALL_RATE_LIMIT` | 300/min | `all` (fixed) |
| Discogs lookup | per-user | `discogs:user` | `RUNOUT_DISCOGS_RATE_LIMIT` | 30/min | user id (demo: IP) |
| Discogs lookup | overall | `discogs:overall` | `RUNOUT_DISCOGS_OVERALL_RATE_LIMIT` | 60/min | `all` (fixed) |
| **Cover (`/books` + `/discogs`)** (SEC-7.4) | PUBLIC per-IP | `cover:ip` | `RUNOUT_COVER_IP_RATE_LIMIT` | 60/min | client IP (`x-nf-client-connection-ip`, never XFF) |
| Feedback — submissions | per-identity | `feedback` | `RUNOUT_FEEDBACK_RATE_LIMIT` | 5/hr | user id (demo: IP) |
| Payment — checkout | per-IP | `payment:checkout:ip` | `RUNOUT_PAYMENT_CHECKOUT_IP_RATE_LIMIT` | 20/min | client IP |
| Payment — checkout | per-email | `payment:checkout:email` | `RUNOUT_PAYMENT_CHECKOUT_RATE_LIMIT` | 5/min | email |
| Payment — status | per-IP | `payment:status:ip` | `RUNOUT_PAYMENT_STATUS_IP_RATE_LIMIT` | 60/min | client IP |
| **Lending** (SEC-7.4) | per-user write | `lending` | `RUNOUT_LENDING_RATE_LIMIT` | 30/min | user id (demo: IP) |
| **Webhook invalid-signature** (SEC-7.4) | per-IP hard throttle | `webhook:invalidsig:ip` | `RUNOUT_WEBHOOK_INVALID_SIG_RATE_LIMIT` | 20/min | client IP |

> **Cover is public** — it is deliberately unauthenticated (`<img>` tags can't
> send a Bearer header) and per-IP rate-limited *before* `handleCover` so a
> flood never reaches the upstream. The limit is keyed on Netlify's
> `x-nf-client-connection-ip` header (which is not spoofable by a client),
> *never* `x-forwarded-for`.

## 2. 429 contract

All limiter 429s are uniform:

- HTTP **429**, body `{ error, code: 'RATE_LIMIT' }`, header
  `Retry-After: <seconds to next window boundary>`.
- We do **NOT** use the legacy `RATE_LIMITED` code anywhere (SEC-7.4 unified it).
- Upstream-provider 429s surfaced by the books/discogs proxies use a distinct
  **`PROVIDER_RATE_LIMIT`** code (server-side only; the SPA maps it to friendly
  copy) and pass through the upstream `Retry-After` when present, else our own
  `retryAfterSeconds`.

## 3. AI cost-ceiling thresholds (generic primitive — no AI provider wired yet)

`_shared/cost-ceiling.js` exposes `consumeCeiling(store, scope, identity,
{ tokens, usd, limits })`. Deterministic hard-stops:

| Ceiling | Response | Code | Env var | Default |
|---|---|---|---|---|
| Per-request tokens | 413 | `AI_TOKENS_EXCEEDED` | `RUNOUT_AI_PER_REQUEST_TOKENS` | 8,000 |
| Per-request USD | 429 | `AI_COST_LIMIT` | `RUNOUT_AI_PER_REQUEST_USD` | $0.05 |
| Per-user daily requests | 429 | `AI_COST_LIMIT` | `RUNOUT_AI_DAILY_USER_REQUESTS` | 20 |
| Per-user daily tokens | 429 | `AI_COST_LIMIT` | `RUNOUT_AI_DAILY_USER_TOKENS` | 100,000 |
| Per-user monthly USD | 429 | `AI_COST_LIMIT` | `RUNOUT_AI_MONTHLY_USER_USD` | $1.50 |
| Global daily tokens | 429 | `AI_COST_LIMIT` | `RUNOUT_AI_GLOBAL_DAILY_TOKENS` | 2,000,000 |
| Global monthly USD | 429 | `AI_COST_LIMIT` | `RUNOUT_AI_GLOBAL_MONTHLY_USD` | $50 |

- Day window = 24 h; month window ≈ 30 d; both self-heal on rollover
  (reuses the rate-limit window-index pattern).
- Every hard stop audits `ai.cost_limit` with the ceiling name + `userId` /
  `emailHash` only — **never prompts, never PII, never tokens past expiry**.
- The primitive is intentionally **generic**: no AI provider integration,
  prompt handling, model routing, or per-response metering exists yet (deferred,
  #337-gated).

## 4. Abuse smoke signals

| Signal | When | Emitted once per window |
|---|---|---|
| `rate_limit_exhaustion_burst` | same scope+identity 429'd N times | `RUNOUT_RL_EXHAUST_ANOMALY_THRESHOLD` (default 20) |
| `cover_burst` | per-IP cover flood | `RUNOUT_COVER_BURST_THRESHOLD` (default 20) |
| `webhook_invalid_signature_burst` | forged webhook events | threshold 5 |
| `rate_limit.served` | every limiter 429 | per-scope only (no identity/IP/cardinality) |
| `ai.cost_limit` | every AI ceiling hit | ceiling + userId/emailHash |
