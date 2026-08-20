# Threat Model — Halcova Collection Platform

> **Issue:** SEC-7.5 #342  
> **Milestone:** M1 — Security, Reliability & Platform Foundation  
> **Status:** Active  
> **Last updated:** 2026-08-20

---

## Trust Boundaries

| Boundary | Description |
|---|---|
| Browser → Netlify CDN | Public internet; TLS enforced |
| Netlify Functions ↔ Netlify Blobs | Internal Netlify network; access via scoped API token |
| Netlify Functions ↔ Postgres | DATABASE_URL connection string; TLS required |
| Netlify Functions ↔ External APIs | Discogs, Open Library, Google Books; outbound HTTPS only |
| Admin token | Single owner key minted at login; never sent in query string |
| Member session | Bearer token stored in localStorage; 90-day hard cap; revocable |

---

## Threat 1 — BOLA (Broken Object Level Authorization)

**What it is:** User B guesses or knows User A's item id and tries to read, update, or delete it.

**How Halcova mitigates it:**  
Collection items live in per-user isolated Netlify Blob stores, scoped by the *server-resolved* `user.id` from the session token. A client-supplied `ownerId` or `userId` in the URL or body is never used as the store key. An item looked up by id in another user's store simply does not exist there; the function returns a uniform `403 FORBIDDEN` — indistinguishable from "exists but isn't yours" (SEC-7.1, #338).

**CI evidence:** `src/__tests__/security-authz.test.js` — BOLA section.

---

## Threat 2 — BOPLA (Broken Object Property Level Authorization)

**What it is:** A crafted request body contains privileged fields (`ownerId`, `role`, `plan`, `id`) that a user should not be able to set, attempting to escalate privileges or take ownership of another user's data.

**How Halcova mitigates it:**  
All POST and PUT bodies are run through `pickItemFields()` before any storage write. Only the explicitly allow-listed fields survive; any other field is dropped silently. The server always assigns `id` (UUID). Role and plan are only ever set server-side from the session record (SEC-EPIC-2, #188).

**CI evidence:** `src/__tests__/security-authz.test.js` — BOPLA section.

---

## Threat 3 — SSRF (Server-Side Request Forgery)

**What it is:** An attacker provides a URL (e.g. in a barcode lookup or cover-fetch request) that causes the server to make an outbound request to an internal address (169.254.x.x, metadata endpoints, internal services).

**How Halcova mitigates it:**  
Outbound catalogue lookups (Discogs, Open Library, Google Books) use hard-coded base URLs; no user-supplied URL is ever used as an outbound request target. Asset signing (SEC-7.3, #340) generates pre-signed Netlify Blob URLs server-side — the client receives a signed URL but never supplies one for the server to fetch. There is no URL-fetch-on-behalf-of-user feature.

**Residual risk:** None identified.

---

## Threat 4 — XSS (Cross-Site Scripting)

**What it is:** A user stores a payload like `<script>alert(1)</script>` in a text field (title, artist, notes) and it executes in another user's browser when rendered.

**How Halcova mitigates it:**  
React's JSX rendering escapes all string values by default — no `dangerouslySetInnerHTML` is used for user content. Input validation in `validateItem()` provides a server-side layer. Content Security Policy headers are set via `netlify.toml`.

**CI evidence:** `src/__tests__/security-authz.test.js` — XSS section.

---

## Threat 5 — Prompt Injection

**What it is:** A user stores malicious text in a collection item that is later fed to an AI feature, causing the AI to follow attacker instructions (e.g. "Ignore previous instructions and...").

**How Halcova mitigates it:**  
Halcova contains no server-side LLM integration in M1. AI features are client-only (quiz panel, stories panel) operating on locally held data; no user-supplied text is forwarded to an external LLM API by the server.

**Residual risk:** If an LLM integration is added in a future milestone, prompt injection must be re-evaluated at that point.

---

## Threat 6 — Credential Theft

**What it is:** Secrets (admin key, session token, database URL, third-party API keys) are leaked via source code, logs, error responses, or environment variable exposure.

**How Halcova mitigates it:**  
- Gitleaks scans the full git history on every PR (blocking — `secret-scan.yml`).
- `.gitleaks.toml` configures the allow-list for known test fixtures.
- `safeError()` (SEC-3.7, #200) ensures internal error messages (including stack traces and DB connection strings) are never returned to the client.
- All secrets are stored as Netlify environment variables; `.env.example` contains only placeholder names.
- Session tokens are `Bearer` header only; they are never written to server logs.

**CI evidence:** `secret-scan.yml` — Gitleaks blocking scan.

---

## Threat 7 — Data Exposure (Sensitive Data Leak)

**What it is:** Private fields (email, plan, billing details, private asset URLs) appear in API responses intended for other users or in logs.

**How Halcova mitigates it:**  
All item DTOs returned by `collection.js` pass through `filterFor(user, 'item', item, { own })` (SEC-7.1, #338) before being sent. Admin-only fields (plan, email, billing) are only returned by the `/admin` endpoint, which requires an admin session (`requireAdmin`). Pre-signed asset URLs are scoped to the requesting user and expire.

**CI evidence:** Covered by existing unit tests for `filterFor` and the admin panel tests.

---

## Threat 8 — Abuse / Cost DoS

**What it is:** A runaway client, scraped credentials, or an attacker issues high-volume requests that exhaust Netlify function invocations, Blobs quota, or third-party API rate limits, causing cost overruns or degraded service.

**How Halcova mitigates it:**  
- Per-identity fixed-window rate limiting on all collection endpoints (60 reads / 30 writes per minute) via `rateLimitGuard()` (SEC-7.4, #341).
- Demo users are rate-limited per client IP to prevent one visitor from throttling the whole demo.
- Free-tier plan limits cap the number of items a member can add (enforced server-side).
- Anomaly burst detection (`anomalyScope`) flags sustained traffic spikes.

**Residual risk:** Netlify function invocation limits are at the platform level; no application-level circuit breaker exists yet. Accepted — see residual-risk register.

---

## Audit Events & Logging

All state-changing operations (item create/update/delete, lending, auth events) log a structured line to the Netlify function log stream. PII (email, IP) is hashed before logging via `anomalyScope`. Internal error details are stripped from client responses by `safeError()`.

---

## Incident Response

See `docs/incident-response-runbook.md` for the runbook covering account takeover, data exposure, secret leakage, and provider compromise.
