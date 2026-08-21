TEAM: SECURITY
CURRENT ISSUE: #385 Asset serving layer + asset:sign rate-limit + instant revocation (SEC-7.3.x)
STATUS: PASS — asset:sign rate-limited per-identity+IP (rateLimitGuard, 30/min default, 429 on exhaustion, cross-identity isolation); serving layer (serve.js) verifies signed URLs end-to-end (valid → bytes, expired/tampered/revoked → 403); instant revocation via asset:revoke + revokedAt envelope check; 55 new tests (12 serve + 25 asset + 3 rate-limit + 7 revoke + 8 existing) all pass; coverage ≥70% on all changed files (asset.js 91%, serve.js 92%, asset-sign.js 76%, asset-store.js 100%, policy.js 93%); full regression 2847/2847 pass; no test files in netlify/functions/ root; docs/secure-asset-access.md updated
ACTIVE PR: m1/security/385
LAST GATE: pending independent Security Auditor + Tester verification (no self-approval)
BLOCKER: —
NEXT: PM review of #385 diff → independent Security Auditor + Tester gates → human merge
CURRENT ISSUE: #380 Self-serve member data export (GDPR portability, SEC-7.2.x)
STATUS: READY — export.js (96.92% stmts) + export-sign.js (95.55% stmts) + policy.js (93.1% stmts) all ≥70%; 63 new tests (20 export-sign unit + 15 export integration + 1 policy inventory + 27 existing policy) all pass; negative tests cover cross-user, expired token, forged token, malformed token, demo readonly, unauthenticated, unconfigured secret, over-broad scope, C12 credential exclusion; single-use consumption verified; no test files in netlify/functions/ root; full regression 1543/1544 pass (1 pre-existing unrelated serve.test.js failure)
ACTIVE PR: (open) m1/security/380
LAST GATE: pending independent Security Auditor + Tester verification (no self-approval)
BLOCKER: —
NEXT: PM review of #380 diff → independent Security Auditor + Tester gates → human merge
