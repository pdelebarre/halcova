TEAM: AI
CURRENT ISSUE: #304 — [ADMIN-3.2] Secure LLM configuration storage + Admin AI settings
STATUS: ACTIVE — implementation complete, awaiting independent gates (Security Auditor + Data Architect + Tester)
ACTIVE PR: none yet — branch m1/ai/304 (committed + working tree)
LAST GATE: self-verify — full suite 2605 pass (10 skipped); global coverage gate passes (stmts 88.3%, branches 80.4%, funcs 86.5%, lines 91.4%); ALL changed files ≥70% on stmts/branches/funcs (admin.js, ai-admin, ai-config-repo, ai-config-blob, ai-endpoint, ai-secrets, openai, provider, AdminPanel.jsx, api/auth.js); build + lint clean
BLOCKER: none — #303 merged (PR #430); #304 includes the mandatory base-URL HOST ALLOWLIST on the OpenAI provider (ADR-0006 / #303 Security Auditor MEDIUM) + secrets encrypted at rest (RUNOUT_AI_SECRET_KEY), admin-only API, atomic test-before-activate, audit without secrets
NEXT: PM route #304 to Security Auditor + Data Architect + Tester for independent verification; then Release Validator before cutover