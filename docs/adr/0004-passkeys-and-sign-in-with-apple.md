# ADR-0004: Passkeys & Sign in with Apple — evaluation for primary consumer auth (SEC-1.8, #183)

- **Status:** Decision recorded — **Defer** (evaluation only; no code implemented in this pass)
- **Date:** 2026-08-17
- **Contributors:** Netlify Backend (auth/sessions), Whole Stack Architect (review)
- **Branch for implementation:** `feat/security-identity` (PR #250) — design artifact only
- **Supersedes/extends:** ADR-0003 §1 (passwordless email magic-link as the self-serve signup path), SEC-EPIC-1 (server-managed session tokens)

---

## The problem

Halcova/Runout is a **passwordless** PWA: members sign in with a `RU-…` access
code (exchanged for a revocable, expiring server-side session) or with a
one-time email magic link (self-serve, ADR-0003). SEC-1.8 asks us to evaluate
whether **Passkeys (WebAuthn)** and/or **Sign in with Apple (SiWA)** should
become *primary* consumer authentication — replacing or supplementing the
magic-link/code paths — and to record a clear decision with a migration sketch
if recommended. This is an evaluation note, not an implementation.

---

## Recommendation (one paragraph)

**Defer both.** The current stack is already passwordless (no password
database to protect), so the #1 security driver for Passkeys — killing
passwords and their credential-stuffing/reuse risk — does not apply here, and
the email magic link is already the secure recovery path either option would
need anyway. Passkeys are **feasible today** on Netlify Functions + Postgres
with modest effort (~2 ceremony endpoints + a `credentials` table) and good
iOS-Safari-PWA support (iOS 16+/17+), but they add ceremony complexity and
per-platform quirks for a small user base. Sign in with Apple is also feasible
but adds an Apple Developer Program requirement ($99/yr), domain-verification
files, JWKS/id_token verification, and account-linking headaches (Apple's
private-relay emails can duplicate accounts). Both are **additive** — they
would slot into the existing `createSession` model and never remove the
magic-link fallback. Revisit Passkeys when there is real auth friction or
before/at public launch if email deliverability becomes a reliability risk;
revisit SiWA when a **native iOS app** ships (the App Store then makes SiWA
effectively mandatory for apps offering third-party login).

---

## 1. Context: what "primary auth" means here

Today there is no password anywhere:

- **Access code** (`RU-XXXX-XXXX-XXXX`): exchange credential only (SEC-EPIC-1,
  #176/#177) — never persisted client-side, never accepted as a Bearer,
  revocable via session tokens.
- **Magic link** (ADR-0003 S1): HMAC-SHA256 signed, ≤30 min TTL, single-use,
  rate-limited (per-IP + per-email), fail-closed secret (SEC-1.7, #182).
- **Session tokens**: opaque 256-bit, sha256-hashed server-side, sliding
  renewal capped at 90 days (SEC-1.3, #178), revocable per-session and
  per-user (logout-all, SEC-1.4, #179), server-side kill on disable/delete.

"Primary auth" candidates must therefore beat *or* complement the magic-link
for: **login friction**, **recovery**, **phishing resistance**, and **cost**.

## 2. Passkeys (WebAuthn) assessment

| Concern | Assessment |
|---|---|
| **Feasibility on Netlify Functions + Postgres/Blobs** | High. WebAuthn is pure HTTP: a `registerStart`/`registerFinish` + `loginStart`/`loginFinish` pair in a Netlify function, using `@simplewebauthn/server`. Challenges are short-lived random values (store in a TTL store); credentials persist in a new Postgres `credentials` table (credential_id PK, user_id FK, public_key_cose, sign_count, transports). No new infra, no WebSockets. |
| **PWA / iOS Safari support** | Good and improving. Passkeys on iOS Safari: iOS 16+ (platform authenticators, iCloud Keychain sync), iOS 17+ for the richer flows. Works in an installed PWA (standalone) — the WebAuthn prompt is system-level. Desktop (Safari/Chrome/Firefox, Windows Hello / Touch ID / security keys) also supported. Cross-platform sync (iCloud/Google) covers most real users. |
| **Secure recovery** | The magic link stays the recovery + re-registration path. A lost (non-synced) authenticator is covered by the existing email flow — so Passkeys never remove the email dependency, they add a primary path on top. |
| **Phishing resistance** | Strong — origin-bound credentials can't be typed into a lookalike site (unlike codes/links, which are phishable). This is the one security argument FOR passkeys here, and it matters if we ever get phished. |
| **Cost/complexity** | Moderate: ~2 endpoints, COSE public-key handling, signCount clone detection, challenge lifecycle, and per-browser ceremony quirks (JSON parsing of `publicKey` options, userVerification settings). Meaningful test matrix across iOS Safari / Android / desktop. |
| **Pitfalls** | Credential-bound RP ID = site origin; if we later change domains, credentials must be re-registered. Attestation is `none` (privacy + simplicity). Discoverable credentials (resident keys) so login needs no username — requires platform authenticator support (iCloud Keychain OK). |

## 3. Sign in with Apple (SiWA) assessment

| Concern | Assessment |
|---|---|
| **Feasibility on Netlify** | High. `appleAuthStart` → redirect to Apple → callback on a Netlify function that exchanges the authorization code, fetches JWKS (`https://appleid.apple.com/auth/keys`), and verifies the id_token (iss/aud/exp + **nonce** to prevent replay). Domain verification is a static `apple-developer-domain-association.txt` served from the site root — trivial on Netlify. |
| **PWA / iOS Safari support** | Works in Safari and standalone PWA (Apple-hosted sign-in sheet); minor popup/redirect quirks in standalone mode. Fine, not zero-friction. |
| **Secure recovery** | Same as passkeys — the magic link remains. SiWA itself needs a fallback (an Apple ID can be lost/disabled). |
| **Cost** | Requires an **Apple Developer Program** membership ($99/yr, recurring) and a configured App/Service ID + "Sign in with Apple" capability. Not a blocker, but an ongoing paid dependency + account administration. |
| **Account linking** | The hard part. Apple returns `sub` (stable) plus a **private-relay email** (`…@privaterelay.appleid.com`) unless the user opts to share. Our member identity is keyed by email today (dedupe by email; magic-link finds members by email) — an SiWA sign-in with a relay address would silently create a duplicate member unless we link on `sub` and surface "link to existing account" UX. |
| **Cost/complexity** | Moderate-high for our size: Apple Dev account, JWKS verification, nonce/CSRF handling, relay-email dedupe + account linking, and the "Sign in with Apple" button requirements (Apple's HIG terms). |
| **Pitfalls** | Only iOS/macOS ecosystem users; no value for Android/Windows visitors. The App Store requires SiWA for native iOS apps offering third-party login — that's the main forcing function, and it only kicks in when we ship a native app. |

## 4. Comparison

| | Magic link (today) | Passkeys | Sign in with Apple |
|---|---|---|---|
| Passwordless | ✅ | ✅ | ✅ |
| Phishing resistance | Low (links/codes phishable) | **High** (origin-bound) | Medium (OAuth) |
| Friction | Email round-trip (seconds) | **Tap/FaceID (fastest)** | Apple sheet (fast) |
| Recovery path | N/A (it IS the recovery) | Needs magic-link | Needs magic-link |
| iOS PWA support | ✅ | ✅ (iOS 16+) | ✅ (minor standalone quirks) |
| New infra/cost | None | `credentials` table + 2 endpoints | Apple Dev acct ($99/yr) + JWKS + linking |
| Risk to existing members | None (in place) | New test matrix, RP-ID binding | Relay-email duplicate accounts |
| Fits current session model | ✅ | ✅ (issue via `createSession`) | ✅ (issue via `createSession`) |

## 5. Decision & rationale — **Defer**

1. **The main Passkeys argument doesn't apply.** Passkeys exist to kill
   passwords. We have no passwords, no credential-stuffing/reuse risk, and no
   password DB to leak. The marginal security gain is phishing resistance
   alone — real, but not urgent for a small, invite-driven user base.
2. **Both options still depend on email for recovery.** Magic-link is the
   fallback either way, so adopting them now adds a second login path without
   removing the email dependency — more surface, more testing, for limited
   user-facing benefit at our current scale.
3. **Cost/complexity is front-loaded.** Passkeys add a ceremony surface +
   cross-browser matrix; SiWA adds a paid Apple account + account-linking
   complexity. Neither is justified for the private-test cohort.
4. **SiWA becomes high-value only with a native app.** The App Store rule
   ("if you offer third-party login, offer Sign in with Apple") is the real
   trigger. When a native iOS app is planned, re-evaluate SiWA seriously.

## 6. Migration sketch (if/when adopted — NOT implemented in this pass)

**Passkeys (recommended first, additive):**

1. **Schema:** new `credentials` table — `credential_id` (PK), `user_id` (FK →
   users), `public_key_cose` (bytea), `sign_count` (int), `transports` (jsonb),
   `created_at`, `last_used_at`. Plus a short-TTL `passkey_challenges` store
   (keyed by challenge, ~5 min, single-use) — Netlify Blobs or a Postgres
   table with an expiry sweep.
2. **Endpoints** (extend `netlify/functions/auth.js` actions):
   - `passkeyRegisterStart { email? }` → `{ options, challengeId }`
   - `passkeyRegisterFinish { challengeId, response }` → creates credential,
     then issues a session via the **existing `createSession`**.
   - `passkeyLoginStart { }` (discoverable credentials, no username) →
     `{ options, challengeId }`
   - `passkeyLoginFinish { challengeId, response }` → verify assertion
     (signature vs stored public key, **signCount ≥ previous** to catch cloned
     authenticators), resolve `user_id`, issue a session token. Roles come from
     the user record — same as today (SEC-1.6).
3. **Session model unchanged.** A passkey login is just another way to reach
   `createSession({ userId, role })`; the Bearer/session/renewal/revocation
   layer, store isolation, and rate limits all stay identical.
4. **Recovery:** keep `requestMagicLink`/`verifyMagicLink` as-is; a lost
   passkey → magic link → re-register.

**Sign in with Apple (later, when native-app planning begins):**

1. Apple Developer Program account + Service ID with the domain configured +
   `apple-developer-domain-association.txt` at the site root.
2. `appleAuthStart` (state + nonce) → Apple → `appleAuthFinish`: exchange
   code, verify id_token via JWKS (iss/aud/exp/**nonce**), extract `sub` +
   email (relay-aware).
3. **Linking:** match on `sub` first; if the `sub` is new but the email
   matches an existing member, offer account-linking (never auto-merge a relay
   email into a different canonical account). On success → `createSession`.

**What happens to access codes:** unchanged. `RU-…` codes remain for manual
approval (admin flow) and as a deterministic recovery/offline path. Passkeys
and SiWA are **additive** login methods — they never remove or weaken the
code/magic-link paths, and `publicUser` stripping still applies to every
response.

## 7. When to revisit (triggers)

- **Auth friction becomes a real complaint** (e.g. "the email link is slow" /
  deliverability failures at launch) → adopt Passkeys first.
- **A native iOS app is planned** → SiWA becomes high-value (App Store
  requirement) and Passkeys get first-class platform support.
- **Phishing is a concrete threat model** (large public audience) → revisit
  passkeys for origin-bound credentials.
- Any revisit starts here (this ADR) — the sketch above is the plan.
