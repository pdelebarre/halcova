TEAM: SECURITY
CURRENT ISSUE: #380 Self-serve member data export (GDPR portability, SEC-7.2.x)
STATUS: READY — export.js (96.92% stmts) + export-sign.js (95.55% stmts) + policy.js (93.1% stmts) all ≥70%; 63 new tests (20 export-sign unit + 15 export integration + 1 policy inventory + 27 existing policy) all pass; negative tests cover cross-user, expired token, forged token, malformed token, demo readonly, unauthenticated, unconfigured secret, over-broad scope, C12 credential exclusion; single-use consumption verified; no test files in netlify/functions/ root; full regression 1543/1544 pass (1 pre-existing unrelated serve.test.js failure)
ACTIVE PR: (open) m1/security/380
LAST GATE: pending independent Security Auditor + Tester verification (no self-approval)
BLOCKER: —
NEXT: PM review of #380 diff → independent Security Auditor + Tester gates → human merge