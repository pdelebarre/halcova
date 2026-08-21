TEAM: SECURITY
CURRENT ISSUE: #385 Asset serving layer + asset:sign rate-limit + instant revocation (SEC-7.3.x)
STATUS: PASS — asset:sign rate-limited per-identity+IP (rateLimitGuard, 30/min default, 429 on exhaustion, cross-identity isolation); serving layer (serve.js) verifies signed URLs end-to-end (valid → bytes, expired/tampered/revoked → 403); instant revocation via asset:revoke + revokedAt envelope check; 55 new tests (12 serve + 25 asset + 3 rate-limit + 7 revoke + 8 existing) all pass; coverage ≥70% on all changed files (asset.js 91%, serve.js 92%, asset-sign.js 76%, asset-store.js 100%, policy.js 93%); full regression 2847/2847 pass; no test files in netlify/functions/ root; docs/secure-asset-access.md updated
ACTIVE PR: m1/security/385
LAST GATE: pending independent Security Auditor + Tester verification (no self-approval)
BLOCKER: —
NEXT: PM review of #385 diff → independent Security Auditor + Tester gates → human merge