TEAM: AI
CURRENT ISSUE: #336 — [FEAT-9.5] AI Image Recognition for Collection Capture (M4 P2)
STATUS: IMPLEMENTED — image-identify function + IDENTIFY_FROM_IMAGE capability + identifyFromImage tool + ImageCaptureModal component + i18n strings. All 26 new tests pass (15 function tests, 11 component tests). No .test.* in netlify/functions/ root.
ACTIVE PR: none yet — branch m4/ai/336 (committed, not pushed)
LAST GATE: self-verify — 26/26 new tests pass. Capability schema validation rejects malformed input/output. XSS-safe via assertSafeStrings on candidates. Data-minimization: only signed image URL + optional public hints sent to model. AI suggests only (no auto-add). Signed time-bounded URLs (5 min TTL). Server-authoritative ownership (session-derived user.id). Rate-limited per-identity+IP. Fail-closed on missing ASSET_SIGN_SECRET or AI provider.
BLOCKER: none — #303 AI provider abstraction exists, #385 asset signing exists, #321 scan flow exists
NEXT: PM route for independent review by Security Auditor + Whole Stack Architect (ADR-0006 AI provider/tool security boundary); then route #336 PR for merge
