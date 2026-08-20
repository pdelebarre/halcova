TEAM: DATA
CURRENT ISSUE: #315 — [FEAT-6.2] Collection Type Registry & Capabilities (ADR-0020 §2/§6; epic #313)
STATUS: IMPLEMENTED on m3/data/315 (PR #425) — registry tables + records/books seed (fields/labels/icons/capabilities/provider mappings via one shared mechanism), server-authoritative (app_rls SELECT-only, no write policy), stable UNKNOWN_TYPE/UNKNOWN_FIELD/REQUIRED/... validation, XSS-safe allowlisted public projection, read-only collection-types GET-only API.
ACTIVE PR: #425 (m3/data/315)
LAST GATE: DATA internal — registry (21) + read-only API (5) + RLS-012 content block + full _shared data-layer suite 1191 passed / 4 skipped (real-PG rls-integration skipped). Independent Data Architect + Security Auditor + Tester verification pending (not self-approved).
BLOCKER: none for #315; #316 (migration) serializes AFTER #315. Provider-mapping field contract kept compatible for #317.
NEXT: PM coordinate independent Data Architect + Security Auditor + Tester gates on #425; then MERGE #315 before #316.
---
COORDINATION NOTE (parallel worktree collision): #315 and #317 share one working tree; the #317 agent's commit be6c46a ("#317 metadata provider adapter layer") was committed onto m3/data/315 and pushed. DATA rebased it OUT of m3/data/315 (PR #425 now contains only #315 files) and RESCUED the provider work: be6c46a is now on m3/providers/317, and the 5 provider files (adapter-contract.js/.test.js, adapters.js, normalize.js, payload-guard.js) were restored to the working tree as untracked (their original live state). PM should confirm the PROVIDERS team resumes from m3/providers/317 and re-commits/pushes its own branch. Two teams must not push to the shared checkout concurrently.
