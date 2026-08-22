TEAM: AI
CURRENT ISSUE: #308 — [ADMIN-3.6] GitHub issue/epic generation + controlled labels (M4 P1)
STATUS: IMPLEMENTED — issue-gen.js + issue-gen.test.js complete on branch m4/ai/308. All 404 AI tests pass (13 files, +47 new). No .test.* in netlify/functions/ root.
ACTIVE PR: none yet — branch m4/ai/308 (committed, not pushed)
LAST GATE: self-verify — 47/47 issue-gen tests pass. Controlled 14-label allow-list enforced. XSS-safe via isSafeCanonicalString. Data-minimization: triage metadata never sent to model. Idempotent via deterministic draftId. Draft-return pattern (requiresConfirmation: true). Error propagation verified.
BLOCKER: none — #303 GENERATE_ISSUE_EPIC capability exists; #306 feedback triage input schema compatible
NEXT: PM route for independent review by Security Auditor + Whole Stack Architect (ADR-0006 AI provider/tool security boundary); then route #308 PR for merge
