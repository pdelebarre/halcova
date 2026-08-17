# Security Incident-Response Runbook

Runout/Halcova — Netlify functions + Netlify Blobs + managed Postgres + Stripe.
This runbook is the operational companion to the **mandatory security gate**
(`.github/ai/README.md`) and the **secret/PII-safe logging + audit-event**
policy (`docs/technical.md` § 13.5/13.6). It covers the incident classes most
likely to touch this stack and, for each, the detection → containment →
eradication → recovery → post-incident review sequence.

> **Golden rule**: NEVER put actual secret values in code, docs, logs, issues,
> or PRs. Only reference the variable names listed here. If a secret was leaked,
> treat it as compromised immediately and **rotate it** — see the secret-rotation
> procedure in `.github/ai/README.md` (SEC-EPIC-5), which this runbook references
> rather than duplicates.

## Roles & escalation

- **Owner** — signs in with `RUNOUT_ADMIN_KEY`; controls Netlify env, Stripe
  dashboard, Google Cloud (Books API key), Discogs (token).
- **Security Auditor** — blocking reviewer for the security gate; owns
  incident sign-off and exception decisions.
- **Netlify Backend agent** — the implementer/remediator for function/Blob/
  Postgres/Stripe code paths.

Escalate a confirmed incident to the Security Auditor before any public
communication. A high/critical finding or a leaked secret is **not** a merge
exception and **not** something the implementer self-approves.

## Signals to watch

The structured `AUDIT <json>` lines in Netlify function logs (§ 13.6):

- `auth.login_failed` burst from one IP → brute force / credential stuffing.
- `anomaly.auth_failure_burst` → repeated failed logins from one IP in a window.
- `anomaly.webhook_invalid_signature_burst` → forged/replayed webhook probing.
- `anomaly.admin_denial_burst` → a non-admin probing the admin surface.
- `webhook.unknown_event_type` flood → probing which event types we act on.
- `payment.*` anomalies → checkout abuse / replay of a `?session_id=…` URL.
- `admin.*` events → check for actions the owner did not perform.

---

## 1. Credential theft (access code / session token / admin key stolen)

**Detection**

- Unusual sign-ins for a member (login from an unexpected IP/device; `AUDIT`
  `auth.login_success` you didn't trigger).
- A member reports "someone is using my account".
- A leaked `localStorage.runout.session` / bearer token appearing in logs or a
  paste.

**Containment**

- Immediately **disable the affected member** from the admin panel
  (`updateUser` → `status: disabled`). `resolveSession` rejects disabled
  accounts on every call, so their live sessions die server-side immediately.
- If the **admin key** is suspected, rotate it and invalidate owner sessions
  (sign out all owner sessions via `logoutAll`).

**Eradication**

- **Rotate the member's access code** (admin `rotate` action) — this mints a
  NEW code, stores its hash, and **revokes all live sessions** for that user.
  The old code stops working instantly.
- For the admin key: generate a new random value, update the Netlify env var
  and any local `.env`, and rotate. Follow `.github/ai/README.md` § "Secret-leak
  response & rotation procedure".

**Recovery**

- Hand the new code to the member out-of-band; confirm they can sign in.
- Verify the old credential returns 401/403 everywhere.

**Post-incident review**

- Trace which sessions the attacker could reach (session table / `sessions`
  store); confirm nothing cross-account was read (tenant isolation — see the
  `netlify-collection` and `multi-tenant-security` skills).
- File a Security Auditor review with the timeline.

---

## 2. Account takeover (attacker signs in as a member)

**Detection**

- `auth.login_failed` followed by a successful `auth.login_success` from an
  unusual IP; a member's collections/flags changing without their action.

**Containment**

- Disable the account immediately (stops all live sessions + re-login).
- Revoke all sessions for the user (`logoutAll`).

**Eradication**

- Rotate the code; if the magic-link path was used to take over, review the
  magic-link flow: **fail-closed** when `RUNOUT_MAGIC_LINK_SECRET` is missing
  (M3), and the token is HMAC-signed + single-use. Ensure the signing secret was
  not exposed; if it was, rotate it.
- Check whether the attacker could have rotated a member's code via a forged
  magic link — if so, rotate that member's code.

**Recovery**

- Re-grant the member's plans/features from the admin panel after confirming
  their identity out-of-band.

**Post-incident review**

- Confirm no other account shared the exposure window; review the audit events
  for the takeover window.

---

## 3. Data breach (collections / identity / billing data exposed)

**Detection**

- An IDOR report, a misconfigured store, a cross-tenant read in tests or logs,
  or a leaked `sessionId`/`stripeCheckoutSessionId` reading another member's
  status (this is exactly what SEC-6.2 #216 binds against).
- A security scan finding (CodeQL / Gitleaks / secret scanning / `npm audit`).

**Containment**

- Identify the store(s) involved: Netlify Blobs (`runout-identity`,
  `collection-<userId>-<kind>`, caches, rate limits, audit-free user data) or
  managed Postgres (`users`, `items`, `sessions`, `reviews`, `feedback`).
- If a function path is the vector, ship a **fix branch** (never to `main`)
  behind the security gate and deploy.
- If a member is the victim, disable + rotate (see § 1/2).

**Eradication**

- Patch the code path (auth/authorization/tenant-isolation) and add negative
  security tests before considering it done (mandatory gate).
- For leaked secrets, rotate per `.github/ai/README.md`.

**Recovery**

- Restore from the surviving authoritative store via the **documented**
  backfill/mirror paths only — a Postgres outage is NOT a reason to silently
  switch authority to Blobs (SEC-4.1 #202 → 503 `DATA_SOURCE_UNAVAILABLE`).

**Post-incident review**

- Determine scope: which members/items were readable/writable. Deleted member
  data may persist in provider backups until they age out (documented retention
  in `docs/technical.md` § 13.3) — disclose if required.

---

## 4. Secret exposure (a key/token/code appears in logs, code, or a public place)

**Detection**

- Gitleaks / secret scanning / push protection flags a value.
- A `console.*` line or error surfaces a code/token/key (see § 13.5 policy).
- A `?session_id=…` URL or an access code is pasted into a ticket/issue.

**Containment**

- Treat the value as compromised immediately — assume it was copied, do not
  assume deletion removed it.
- Rotate the affected secret at its source **now** (do not wait for the
  incident to be fully understood).

**Eradication**

- Follow `.github/ai/README.md` § "Secret-leak response & rotation procedure":
  rotate `RUNOUT_ADMIN_KEY`, access codes, `STRIPE_SECRET_KEY` /
  `STRIPE_WEBHOOK_SECRET`, `GOOGLE_BOOKS_API_KEY`, `RUNOUT_DISCOGS_TOKEN`,
  `RUNOUT_MAGIC_LINK_SECRET`, `RUNOUT_MAIL_API_KEY` as applicable; purge the
  value from git history and any Netlify Blob cache.

**Recovery**

- Verify the old value no longer works (401/403) and the new value is env-only
  in production (no dev fallback).

**Post-incident review**

- Route to the Security Auditor for sign-off; record the incident and rotate
  any other secrets that shared the exposure window.

---

## 5. Payment compromise (Stripe webhook forgery / replay / checkout abuse)

**Detection**

- `anomaly.webhook_invalid_signature_burst` — repeated bad `Stripe-Signature`s.
- `webhook.unknown_event_type` floods — probing which event types we act on.
- A member whose plan upgraded with no real payment; duplicate accounts for one
  email; `payment.checkout_created` bursts from one IP/email.

**Containment**

- The webhook is signature-authenticated over the RAW body with a 5-minute
  replay window and **fail-closed** on a missing secret (SEC-6.1 #215) — verify
  `STRIPE_WEBHOOK_SECRET` is set and rotated if any doubt.
- If a real payment is disputed/refunded, handle via the Stripe dashboard; the
  webhook is idempotent (keyed on `stripeCheckoutSessionId` /
  `stripeSubscriptionId`), so redeliveries converge.

**Eradication**

- Confirm no event type outside `KNOWN_EVENT_TYPES` can mutate state (SEC-6.1).
- Confirm `status` is bound to the authenticated user and the code-delivery
  window is bounded (SEC-6.2 #216) so a leaked `?session_id=…` can't mint codes
  indefinitely.

**Recovery**

- Re-issue entitlements for legitimately paid members (the webhook/reconcile
  path self-heals); revoke any code that was over-delivered.

**Post-incident review**

- Review Stripe dashboard event logs vs. our `AUDIT` webhook events for
  divergence; confirm idempotency held (no duplicate members).

---

## Incident log

For each incident, record: date, class, detection signal, affected
users/stores, containment + eradication + recovery steps taken, secrets
rotated, and the Security Auditor sign-off reference. Keep the audit `AUDIT`
lines as the evidence trail.
