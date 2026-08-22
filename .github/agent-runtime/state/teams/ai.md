TEAM: AI
CURRENT ISSUE: #310 — [ADMIN-3.8] AI provider test/dry-run + cost, health & fallback dashboard (M4 P1)
STATUS: IMPLEMENTED — implementation complete on branch m4/ai/310, all 390 AI tests pass (16 files)
ACTIVE PR: none yet — branch m4/ai/310 (committed, not pushed)
LAST GATE: self-verify — 27 new tests across 3 new test files (ai-cost-tracker, ai-fallback, ai-dryrun). New modules: ai-cost-tracker.js (cost estimation + Blobs/Postgres storage), ai-fallback.js (cooldown + retry + fallback), ai-dryrun.js (read-only feedback evaluation). Modified: ai-admin.js (getAiDashboard, runAiDryRun), admin.js (handleAiDashboard, handleAiDryRun, ?aiDashboard=1), auth.js (adminAiDashboard, adminAiDryRun), AdminPanel.jsx (AI dashboard tab with health/cost/fallback/dry-run UI), AdminPanel.css (dashboard table styles), en.js (new i18n strings). No .test.* in netlify/functions/ root.
BLOCKER: none — all dependencies (#304, #306, #337) merged
NEXT: PM route for independent review by Security Auditor + Whole Stack Architect (AI provider/model/tool security boundary per ADR-0006); then route #310 PR for merge