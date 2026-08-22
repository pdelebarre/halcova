TEAM: AI
<<<<<<< Updated upstream
CURRENT ISSUE: #333 — [FEAT-9.2] Natural-Language Collection Assistant (M4 P1)
STATUS: IMPLEMENTED — implementation complete on branch m4/ai/333, ready for specialist review (Security Auditor + Whole Stack Architect per ADR-0006/ADR-0021)
ACTIVE PR: none yet — branch m4/ai/333 (committed, not pushed)
LAST GATE: self-verify — all 299 AI tests pass (11 files). New files: assistant.js ~90%+ stmts/branch/100% funcs/lines; tools.js (incl. new runners) ~95%+ stmts/90% branch/100% funcs; capabilities.js +ASSISTANT_QUERY. No .test.* in netlify/functions/ root. Adversarial negatives covered: XSS injection rejection, data-minimization (private fields stripped), input validation, provider error propagation, mutation draft requiresConfirmation always true, action/entityType enum validation.
BLOCKER: none — #332 ADR-0021 document committed to repo
NEXT: PM route for independent review by Security Auditor + Whole Stack Architect; then route #333 PR for merge
=======
CURRENT ISSUE: #332 — [FEAT-9.1] Define AI Collection Tool Contracts & Data-Minimization Policy (M4 design gate)
STATUS: ACTIVE — ADR-0021 written on branch m4/ai/332, awaiting independent specialist review (AI Architect + Security Auditor + Whole Stack Architect)
ACTIVE PR: none yet — branch m4/ai/332 (committed, not pushed)
LAST GATE: self-verify — design document only (no implementation code); consistent with ADR-0006, ADR-0013, ADR-0010, ADR-0014, ADR-0019, ADR-0020, #303, #304, #409, #317
BLOCKER: none — all dependencies (#303, #304, #409, #317) merged; ADR-0020 is Proposed but this ADR builds on its domain model concepts without requiring its acceptance
NEXT: PM route ADR-0021 for independent review by AI Architect + Security Auditor + Whole Stack Architect; then route P1 tickets (#333, #334, #306, #307, #308, #310, #309) for implementation
LESSONS: none yet — first AI team M4 issue
>>>>>>> Stashed changes
