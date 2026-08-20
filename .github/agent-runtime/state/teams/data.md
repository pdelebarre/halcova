TEAM: DATA
CURRENT ISSUE: #315 — [FEAT-6.2] Collection Type Registry & Capabilities (ADR-0020 §2/§6; epic #313)
STATUS: IMPLEMENTED on m3/data/315 (PR #425) — registry tables + records/books seed (fields/labels/icons/capabilities/provider mappings via one shared mechanism), server-authoritative (app_rls SELECT-only, no write policy), stable UNKNOWN_TYPE/UNKNOWN_FIELD/REQUIRED/... validation, XSS-safe allowlisted public projection, read-only collection-types GET-only API. Branch attribution corrected after a parallel #317 agent switched the shared worktree (commit moved to m3/data/315; m3/providers/317 reset to base — its uncommitted provider files preserved).
ACTIVE PR: #425 (m3/data/315)
LAST GATE: DATA internal — schema/capability + read-only API + RLS-012 tests green (registry 21, API 5, RLS-migration incl. 012 block); full _shared data-layer suite 1191 passed / 4 skipped (real-PG rls-integration skipped). Independent Data Architect + Security Auditor + Tester verification pending (not self-approved).
BLOCKER: none for #315; #316 (migration) serializes AFTER #315 per dependencies. Provider-mapping field contract kept compatible for #317 (parallel).
NEXT: PM coordinate independent Data Architect + Security Auditor + Tester gates on #425; then #315 MERGED before #316/#317.
