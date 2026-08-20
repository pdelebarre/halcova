# M1 Security Foundation — #342 Close-out Evidence & Residual-Risk Register

**Status:** GROOMED — ready for Security Auditor final sign-off once the listed residual-risk and owner-action items close.
**Milestone:** M1 — Security, Reliability & Platform Foundation · **Epic:** #337 · **Gate ticket:** #342
**Baseline main:** `882df75` (incl. #162/#338/#339/#341/#340/#375).

This document is the **PM-coordinated close-out checklist** for the #337/#342 final security gate. It collects the threat-model coverage, the implemented-control evidence, the residual-risk register and the owner-action reconciliation list. It does **not** itself close #342 — only the Security Auditor's explicit PASS on the final evidence does.

---

## 1. Implemented security-control evidence (M1)

| Capability | Evidence | Verification |
|---|---|---|
| Trusted-device / offline-auth model (ADR-0015 Dec 4, ADR-0016) | #162 → PR #374 (`a461e00`): `offlineTrust.js`, bounded expiry/revocation, fail-closed, no credentials in IndexedDB | Security Auditor PASS · Tester PASS |
| Centralized object/property authorization (BOLA/BOPLA, IDOR) | #338 → PR #377 (`ebb161e`): `policy.js` predicate table, non-enumerating 403 FORBIDDEN, `filter.js` property allowlists | Security Auditor PASS · Tester PASS |
| Privacy/visibility/data classification (data exposure) | #339 → PR #379 (`b6011e1`): `visibility.js` C1–C14 matrix, per-role DTO allowlists, `PRIVATE_ASSET_FIELDS`, retention doc | Security Auditor PASS · Tester PASS |
| Rate limiting / abuse / cost controls (abuse & cost DoS) | #341 → PR #382 (`8b257b1`): `rate-limit.js` + `cost-ceiling.js` + rate-limit matrix + uniform 429 | Security Auditor PASS (GO) · Tester PASS |
| Secure asset access / signed URLs | #340 → PR #384 (`8240471`): `asset-store.js` + `asset-sign.js` + `asset.js` (authorization-before-signed-access), private/public separation | Security Auditor PASS (GO) · Tester PASS |
| SSRF / external-provider boundaries | Pre-existing SEC-6 + #338 (`books.js`/`discogs.js` routing); allowlisted hosts, constrained cover proxy, bounded retries | Pre-existing controls + #338 negative tests |
| XSS (web/input) | Pre-existing SEC-6 + shared `json()` security headers (CSP default-src 'none', nosniff), no reflection of untrusted values | Pre-existing controls; unchanged by M1 |
| Secrets / PII-safe logging | `audit.js` redaction, `publicUser`/`SECRET_FIELDS`, secret-scan CI | Gitleaks CLEAR (#375) |
| CI security gate | `security-ci.yml` (security-tests, dependency-audit, secret-scan) + **CodeQL default-setup** for SAST | **#375 remediated** → PR #387 (`882df75`); advanced-config SAST removed in #412, SAST now via default-setup code-scanning |

**Cumulative quality on main:** 153 files / **1924 tests**, coverage **87.37%** (all ≥70%), lint/build green. Every security PR behind independent Security Auditor + Tester blocking gates with negative tests.

---

## 2. Threat-model coverage (BOLA/BOPLA, SSRF, XSS, prompt injection, credential theft, data exposure, abuse/cost DoS)

| Threat | Coverage | Control |
|---|---|---|
| **BOLA / BOPLA** (object/property-level auth) | #338 policy layer + #340 asset BOLA negatives | Non-enumerating 403; `enforce()` on every action; per-user store scoping; `asset-sign` BOLA tests |
| **SSRF** | #338 lookup routing; ADR-0013 | Server-mediated provider proxying, allowlisted hosts, constrained cover proxy, bounded retries |
| **XSS** | Pre-existing SEC-6 + shared security headers | CSP `default-src 'none'`, `X-Content-Type-Options: nosniff`, no unsafe HTML reflection |
| **Prompt injection** | (AI gated) — **#303/#304 blocked until #337 PASS**; cost-ceiling scaffolding only, no provider wired | Deferred by design; no live AI surface in M1 |
| **Credential theft** | #162 offline-trust + sessions + `publicUser`; #375 Gitleaks CLEAR | No credentials in IndexedDB/localStorage beyond approved session marker; secret scan clear; secrets never logged |
| **Data exposure** | #339 classification + allowlists | Default-private sensitive ownership/asset fields; explicit per-role DTO allowlists |
| **Abuse / cost DoS** | #341 rate-limit matrix + cost ceilings | Per-identity/IP/overall limits; AI cost ceilings (scaffolding); 429 contract; PII-safe abuse signals |

> **Prompt-injection risk is open by design** and must be explicitly recognized in the #342 residual-risk register: there is **no live AI/LLM integration** in M1, so prompt-injection is **not currently exploitable** — it becomes a live threat when the AI foundation (#303/#304) ships, which is **gated on #337 PASS** and would then require its own threat model + ADR/security review.

---

## 3. Residual-risk register (must close or be formally risk-accepted before #342 PASS)

| ID | Finding | Ticket | Severity | Status / path |
|---|---|---|---|---|
| R1 | Pre-existing blocking security-CI failures on mainline | **#375** (PR #387) | P0 | **RESOLVED** (Node pin, gitleaks binary, netlify-cli upgrade, exceptions #386). Owner-action items remain (below). |
| R2 | Dev-only high dependency advisories (`extract-zip`, `sharp`/libvips) — no fix | **#386** | High (dev-only) | **Security-Auditor APPROVED** exception; **must stay open** until a real upstream fix; recheck every `netlify-cli`/`@netlify/*` release; no downgrade. |
| R3 | `rate_limit_exhaustion_burst`/`rate_limit.served` abuse observability not wired to all production endpoints (F-1) | **#383** | Medium | Open (pre-#342). Either wire via `rateLimitGuard` or narrow the doc claim; add endpoint-level burst test. |
| R4 | `review:delete` policy gate uses `ownsTarget: () => true` (latent footgun, correct today) | **#378** | Low | Open (hardening). Real ownership predicate in `policy.js`. |
| R5 | Offline-trust hardening: in-flight `me()`-vs-logout race + FNV→SHA-256 | **#376** | Low | Open (hardening). |
| R6 | Asset serving layer + `asset:sign` rate-limit + instant revocation | **#385** | Low | Open (pre-file-feature). |
| R7 | Self-serve member data export (GDPR-style) | **#380** | P2 | Open (documented in #339; implementation deferred). |
| R8 | Self-serve account deletion (right-to-erasure) | **#381** | P2 | Open (documented in #339; implementation deferred). |
| R9 | Offline trust 7-day window is a client-side constant (server authorizes on reconnect) | — | Info | Accepted for M1 (server session expiry authoritative); re-affirm at #342. |

## 4. Owner-action reconciliation list (repo settings — NOT code; required before the CI gate is fully green)

Done via GitHub / Netlify settings by the owner (not mergeable):

1. **CodeQL default-setup conflict** (#375/#386): **resolved in #412** — decision is to **keep default setup** and drop the redundant advanced-config SAST. The advisory `codeql.yml` workflow and the blocking `sast` job in `security-ci.yml` were removed; SAST is now enforced via **default-setup code-scanning results** (must be added as a required status check). Confirm the active CodeQL default-setup is reporting to code-scanning.
2. **`github-advanced-security` required status check** (#375): references a workflow that has no matching job. Reconcile the branch-protection required-status-check config (add the real `security-ci` job names, or remove the stale check).
3. **Enable secret-scanning + push protection + Dependabot alerts/security-updates** in **Settings → Code security and analysis** (per `.github/ai/README.md` "Owner actions").
4. Add the `security-ci.yml` job names (`security-tests`, `dependency-audit`, `secret-scan`) **and** the **CodeQL default-setup** check as **required status checks** in **Settings → Branches** so the blocking gate (incl. SAST via default-setup) actually gates merges (the exceptions policy assumes this).

## 5. #342 close checklist (for the Security Auditor)

- [ ] All **M1 threat-model rows** (BOLA/BOPLA, SSRF, XSS, prompt injection, credential theft, data exposure, abuse/cost DoS) reviewed against the implemented controls above.
- [ ] **Residual-risk register (R2–R9)** reviewed; each is either **CLOSED** or **explicitly ACCEPTED with rationale** (prompt-injection is not live; R2 is Security-Auditor-approved dev-only exception).
- [ ] **Negative authorization tests** run automatically in CI and green (blocked until the #4 required-status-checks + CodeQL reconciliation land; re-run `security-ci` on main after).
- [ ] Secret / dependency / static checks enforced before merge (R2 exception approved; #386 open).
- [ ] Existing audit/logging/runbook controls **verified, not duplicated** (see `docs/security-runbook.md`, `docs/technical.md` §13).
- [ ] **No HIGH/MEDIUM finding remains without an explicit accepted risk** (R3 F-1 is the outstanding MEDIUM — must be remediated via #383 or formally accepted here).
- [ ] **Security Auditor records explicit PASS** with the finalized residual-risk register.

---

## 6. PM decision

**M1 security-foundation implementation is COMPLETE** (all #337 deliverable sub-epics + CI remediation merged). **#342 not yet PASS** — blocked on: (a) owner-action settings reconciliation (#4), (b) the outstanding MEDIUM F-1 abuse-observability item (#383) being remediated or formally accepted, and (c) the hardening follow-ups (R4–R8) being closed or accepted. Once those land and the Security Auditor records PASS on this register, #342 and #337 close and the M1 security gate clears.

*This document is PM-coordinated evidence; the Security Auditor owns the final verdict.*
