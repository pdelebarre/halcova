TEAM: AI
CURRENT ISSUE: #333 — [FEAT-9.2] Natural-Language Collection Assistant (M4 P1)
STATUS: IMPLEMENTED — implementation complete on branch m4/ai/333, ready for specialist review (Security Auditor + Whole Stack Architect per ADR-0006/ADR-0021)
ACTIVE PR: none yet — branch m4/ai/333 (committed, not pushed)
LAST GATE: self-verify — all 299 AI tests pass (11 files). New files: assistant.js ~90%+ stmts/branch/100% funcs/lines; tools.js (incl. new runners) ~95%+ stmts/90% branch/100% funcs; capabilities.js +ASSISTANT_QUERY. No .test.* in netlify/functions/ root. Adversarial negatives covered: XSS injection rejection, data-minimization (private fields stripped), input validation, provider error propagation, mutation draft requiresConfirmation always true, action/entityType enum validation.
BLOCKER: none — #332 ADR-0021 document committed to repo
NEXT: PM route for independent review by Security Auditor + Whole Stack Architect; then route #333 PR for merge