# ADR-0003: Monetization & self-serve access — replacing manual admin approval with a paywall

- **Status:** Proposed (for review) — consolidated by the Project Manager
- **Date:** 2026-08-14
- **Contributors:** Marketing Manager, Whole Stack Architect, Front End Architect
- **Branch for implementation:** `feat/self-serve-paid-access` (not `main`)
- **Supersedes/extends:** ADR-0001 (free tier, `PLAN_LIMITS`), ADR-0002 (phased scaling)

---

## The problem

Today every member must be manually approved by the owner: a visitor calls
`requestAccess` → the owner approves in `AdminPanel` → `admin.js` mints a
`RU-XXXX-XXXX-XXXX` code. That is O(1) admin effort **per user** and does not
scale. This decision replaces the approval bottleneck with **self-serve access
gated by payment**, while keeping the passwordless Bearer access-code auth and
per-user store isolation exactly as they are.

---

## Recommendation (one paragraph)

**Hybrid monetization: a one-time "Lifetime" purchase as the hero offer, with a
low-cost Annual plan as the budget alternative — both unlock the same "Premium"
tier.** Access becomes self-serve: sign up with an **email magic link**
(passwordless, no admin approval) → free tier (10 items/collection) → hit the
cap → paywall → Stripe Checkout → access code issued automatically on the
payment webhook. Google/Apple sign-in are optional later; Facebook is out of
scope. The admin panel stays only as a manual override, never as the only path
to access.

---

## 1. The model (Marketing Manager)

**Why hybrid, one-time first.** Halcova is a utility with a burst-then-idle
usage pattern: you scan a crate in an afternoon, then browse/search forever.
A monthly subscription reads as "paying for nothing" in quiet months. Collectors
buy hobby tools impulsively in small amounts and openly resent subscription
fatigue. "Buy once, own it" converts best for this audience. A modest annual
plan keeps a recurring-revenue path for real ongoing costs (shared Discogs/
Google Books quotas, storage, hosting) without making subscription the default.

### Tier structure (grounded in shipped features only)

| | Free | Premium |
|---|---|---|
| Records + books cataloging, scan, wishlist, notes, stats, saved views, browse | ✅ | ✅ |
| Items per collection | **10 each** | **Unlimited** |
| Lending (who borrowed what, due dates, history) | — | ✅ |

Nothing is invented: the 10-item cap already exists (`PLAN_LIMITS.free`),
lending already exists (`features.lending`). Features that are free today
(notes, stats, saved views, wishlist) stay free — paywalling them would read as
a downgrade and break trust.

### Pricing (proposal — to validate, not fact)

| Offer | Price (proposal) | Notes |
|---|---|---|
| Free | $0 | 10 items/collection |
| Annual | **$19/year** (intro $14) | ≈ $1.58/mo; the budget option |
| Lifetime | **$49 one-time** (launch $29) | Hero offer; "3 years of yearly" anchor |

- **No monthly plan** at launch — reduces churn noise and SCA/3DS friction.
- Anchor on a hobby object ("less than a used LP / a hardback"), never a SaaS line item.
- Never call it a "lifetime subscription" — say "one-time" / "forever".

### Paywall placement

1. **At the 10-item cap (primary)** — the user is actively trying to add item #11.
2. **When enabling lending** — the lend action leads with the lending benefit.
3. **A soft "Upgrade" row in Settings** — never an interstitial or a signup paywall.
   The free tier must feel like a welcome, not a trial countdown.

### International & localization

- **NL/DE/FR/ES/IT/PT-BR lean one-time**; US/UK/AU tolerate subscription. PT-BR
  is one-time only with high price sensitivity — price locally (PIX near-mandatory).
- Localize paywall copy in all 7 locales; EU prices **VAT-inclusive** (Stripe Tax
  or a merchant-of-record); local methods matter: iDEAL (NL), SEPA/giropay (DE),
  PIX (BR).
- In EU markets pair "lifetime" with "one-time purchase — no auto-renewal".

### Launch sequencing

- **Phase 0:** keep the private test free; **grandfather** all current members to
  `unlimited` (ADR-0001 already recommends this).
- **Phase 1:** public launch — paywall for new signups only; legacy members untouched.
- **Phase 2:** offer legacy members a voluntary founder price ($29) as a thank-you.

---

## 2. Architecture (Whole Stack Architect)

### 2.1 Pieces

Stripe Checkout (hosted page — zero PCI scope) plus **two** new Netlify
functions, leaving `auth`/`admin`/`collection` untouched:

| New piece | Role |
|---|---|
| `netlify/functions/payment.js` | Client-facing: create Checkout/Billing-Portal sessions, poll completion. |
| `netlify/functions/billing.js` | Stripe **webhook only**, signature-authenticated; materializes entitlements. |
| `netlify/functions/_shared/entitlements.js` | Plan/feature resolution, `PLAN_LIMITS`, `applyEntitlement()`. |
| `netlify/functions/_shared/stripe.js` | Stripe helpers + HMAC verification; owns `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. |

### 2.2 Sequence — no admin in the loop

```mermaid
sequenceDiagram
    autonumber
    participant V as Visitor
    participant P as payment.js
    participant B as billing.js (webhook)
    participant I as runout-identity Blobs
    participant ST as Stripe

    V->>P: POST {action:'checkout', plan, name, email}
    P->>I: get-or-create pending request (dedupe by email)
    P->>ST: create Checkout Session (client_reference_id = request id)
    ST-->>P: {url}
    P-->>V: {url}
    V->>ST: pay (off our infra)
    ST->>B: checkout.session.completed (Stripe-Signature)
    B->>B: verify HMAC signature; reject invalid
    B->>I: create user {plan, planExpiresAt, features.lending, code=generateAccessCode(), billing ids}
    B-->>ST: 200 ack
    V->>P: poll {action:'status', sessionId} after redirect
    P-->>V: {status:'complete', user, code} → session starts
```

- The user record exists **before** checkout as a pending `request:<id>`, so the
  webhook always has a stable identity to attach the entitlement to.
- The access code is generated **only after** payment (webhook or reconcile).
- The `status` poll is the self-healing path for webhook lag/missed delivery;
  both the webhook and the reconcile path are idempotent.

### 2.3 Entitlement model

`user.plan`: `'free' | 'premium' | 'lifetime' | 'unlimited'`
(`unlimited` = grandfathered private-test value; uncapped, no expiry).

```
PLAN_LIMITS = {
  free: Number(env.RUNOUT_FREE_LIMIT ?? 10), // config-driven
  premium: null, lifetime: null, unlimited: null,
}
```

New nullable fields on `user:<id>` (additive, no migration):
`planExpiresAt`, `planChangedAt`, `stripeCustomerId`, `stripeSubscriptionId`,
`stripeCheckoutSessionId`. `normalizeUser` defaults them; old records read cleanly.

Lending is derived: `effectiveFeatures(user).lending = features.lending || plan ∈
{premium, lifetime, unlimited} || role === 'admin'` — keeps the admin's manual
override while making lending included in any paid plan.

Subscription lifecycle (server-side): `checkout.session.completed` → issue code;
`customer.subscription.updated` → sync expiry; `subscription.deleted` →
downgrade to `free` (items kept — cap only blocks new adds);
`invoice.payment_failed` → keep entitlements until period end, offer the
Billing Portal.

### 2.4 API contract

- `payment.js`: `POST {action:'checkout'}` → `{url, sessionId}`; `POST
  {action:'status'}` → `{status, user?, code?}`; `POST {action:'portal'}` →
  `{url}`. Plan is mapped to a **server-side** price via env
  (`STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_LIFETIME`) — the client never sends an
  amount. `owner`/`demo` are rejected 403.
- `billing.js`: Stripe-only, no Bearer auth; `200 {received:true}` fast ack.
- New error codes: `PAYMENT_REQUIRED` (403), `PAYMENT_INCOMPLETE` (409),
  `PLAN_LIMIT` (403, now with an `upgrade` hint), `PRICE_UNKNOWN` (400),
  `CHECKOUT_FAILED` (502).
- New client `src/api/payment.js` mirroring the existing `handle()` error-code
  pattern; `src/api/auth.js` gains `completeSelfServe(sessionId)`.

### 2.5 Security

- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are server-only, never in the
  SPA bundle or `publicUser`, never logged.
- `billing.js` verifies the raw body over `Stripe-Signature` (HMAC-SHA256,
  constant-time) — never `req.json()` first; bad signature → 400.
- Idempotency keyed on `stripe:session:<id>` / `stripe:subscription:<id>` →
  `userId` indexes (same O(1) pattern as ADR-0002's planned `code:<normalized>`).
- `publicUser` is extended to also strip `stripeCustomerId`,
  `stripeSubscriptionId`, `stripeCheckoutSessionId` (keeping `plan`,
  `planExpiresAt`, `features`, `collections`). The generated code is returned
  once over HTTPS to the session owner; the webhook never echoes it.
- `RUNOUT_ADMIN_KEY`, `OWNER_ID`, `RUNOUT_DEMO_CODE` are unchanged.

### 2.6 Migration & reversibility

Grandfather private-test members (already `unlimited`); no backfill required.
Rides ADR-0002 Phase 0 (fields + functions only; the only addition is the O(1)
Stripe idempotency indexes). Phase 1 adds columns to `users`; Phase 2 moves
`/payment` + `/billing` behind the reverse proxy with the same contract.
Rollback: remove the two functions + env vars, revert `PLAN_LIMITS`, map any
`premium`/`lifetime` → `unlimited` so nobody gets capped.

---

## 3. Front end (Front End Architect)

- One new **`PaywallModal`** (bottom sheet, mirroring `SettingsModal`) mounted at
  `App.jsx`; `CollectionView` reports *why* it's blocked (`reason` + `kind`), it
  never decides *what* to render.
- **`me()` is the single source of truth for plan state.** New flat optional
  fields (`plan`, `planStatus`, `planExpiresAt`) flow through `publicUser`.
  After checkout redirect, poll `me()` until paid, then close + toast.
- Kind-specific copy lives in each catalog's **`.copy.paywall`** (crate vs
  shelf); generic billing/legal copy lives in `i18n`.
- Trigger points: FAB at cap, `PLAN_LIMIT` 403 on add/convert, lend affordance
  (`PAYMENT_REQUIRED`), Settings "Plan" row, expired plan. `DEMO_READONLY` is
  unchanged and never surfaces the paywall.
- Ergonomics: bottom-sheet thumb reach, ≥44px targets, `#16130F` contrast,
  focus trap + `Esc` restore, `role="dialog"`, `aria-live`, loading/error/success
  states, safe-area for installed PWA, and `location.assign` (not `window.open`).
- **Dark-screen safety (no error boundary):** guard every new field and
  `copy.paywall` with optional chaining + fallbacks; validate `reason` and the
  checkout `url` before use; the modal can never throw at render.

### Two implementation prerequisites the front end surfaced

1. **Fix `useAuth.refresh` before wiring the poll.** Today `me()` throwing
   (offline) is conflated with `me()` returning `null` (logged out), so an
   offline poll would `setSession(null)` and dump the user to `AuthScreen`.
   Only clear the session on `null` (revoked/disabled); keep the cached session
   on a thrown network error.
2. **Close the wishlist-conversion cap bypass.** `handleConvertToOwned` uses
   `update` (uncapped server-side) but grows the owned count. Server-side, treat
   `{ wishlist: false }` on a `free` plan as an add for cap purposes.

---

## 4. Reconciliation & decisions (Project Manager)

1. **Plan-enum naming** — Architect used `premium`; Front End used `plus`.
   **Adopt `premium`** as the canonical value (matches Marketing's "Premium" tier).
2. **Self-serve signup method — RESOLVED (2026-08-14): email magic link.**
   New users sign up with their email and receive a one-time magic link (or
   emailed code) that proves identity and auto-issues the `RU-` access code —
   no admin approval. **Google/Apple sign-in are optional later** (only if
   signup friction appears); **Facebook is out of scope** (off-brand, heavy
   SDK, privacy backlash). Every method still lands on the same Bearer access
   code + session underneath.
3. **Payment provider / VAT** — Architect defaults to Stripe Checkout (owner
   remits VAT) with **Paddle/Lemon Squeezy as the merchant-of-record fallback**;
   Marketing leans MoR for the EU + BR launch (VAT/OSS, iDEAL/SEPA/PIX).
   **Owner decision required**, but the `payment.js`/`billing.js` boundary is
   provider-agnostic either way.
4. **Pricing** — $29/$49 lifetime and $19 annual are **proposals to validate**
   with a small private-test survey across the 7 markets before any public copy
   quotes a number.

---

## What must be preserved (non-negotiable)

- Bearer access-code auth (no passwords); code still `RU-XXXX-XXXX-XXXX` via
  `generateAccessCode()`, exchanged through `login`.
- Per-user store isolation (`storeNameFor`) and the owner's legacy stores
  (`runout-collection` / `runout-library`).
- Item shape + duplicate detection (`findRelated`) — the paywall must not alter
  the "never rebuy" path.
- Server is authoritative for the cap; `PLAN_LIMITS` / `FREE_PLAN_CAP` stay in sync.
- PWA/offline behavior (precached shell + scanner `.wasm`); checkout is the only
  network-required step.
- Secret rules: never log/leak access codes or `RUNOUT_ADMIN_KEY`; `publicUser`
  stays the only path to the client.

---

## Implementation breakdown (delegate when the owner signs off)

| # | Task | Owner |
|---|---|---|
| 1 | Decide pricing + payment provider (Stripe vs MoR) | Owner + PM |
| 2 | Email magic-link signup: mailer, one-time link, auto-issue `RU-` code | Netlify Backend |
| 3 | `payment.js` + `billing.js` + `entitlements.js` + `stripe.js`, webhook + idempotency | Netlify Backend |
| 4 | `PaywallModal`, `.copy.paywall` + i18n keys, trigger wiring, `useAuth.refresh` fix, wishlist-cap fix | Front End Developer |
| 5 | Tests: email-link flow, webhook idempotency, entitlement materialization, cap, paywall rendering | Tester |
| 6 | Security review: webhook signature, email-link expiry/replay, secret handling, code leakage | Security Auditor |
| 7 | Validate pricing + paywall copy across 7 markets | Marketing Manager |

Gates before merging: `npm run lint`, `npm test`, `npm run build`.
