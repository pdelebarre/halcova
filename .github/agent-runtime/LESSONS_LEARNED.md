# Agent Runtime — Lessons Learned

Append-only. One entry per gate-fail loop or regression. Entries are the
source of truth for RETRO tickets and kernel pre-submit rules.

## Entry format

```
DATE:        YYYY-MM-DD
TEAM:        <team name>
ISSUE:       #<number> — <title>
MISTAKE:     <what went wrong — 1 sentence>
ROOT CAUSE:  <why it happened — 1 sentence>
RULE:        <concrete rule to prevent recurrence>
GATE:        <gate updated, if any>
TICKET:      [RETRO-x.y] #<issue number> (opened by Agent Developer)
```

---

## Log

### RETRO-1.1
```
DATE:        2026-08-21
TEAM:        DATA
ISSUE:       #315 — [FEAT-6.2] Implement Collection Type Registry & Capabilities
MISTAKE:     *.test.js file was bundled into netlify/functions/ root, causing 422 on deploy.
ROOT CAUSE:  No pre-submit check prevented test files from landing inside the functions root.
RULE:        Never place *.test.js (or *.spec.js) inside netlify/functions/. Move to _shared/ or __tests__/.
GATE:        Release Validator pre-submit checklist (kernel.md §6.1)
TICKET:      [RETRO-1.1] — open via routing trigger after gate-fail
```

### RETRO-1.2
```
DATE:        2026-08-21
TEAM:        SECURITY
ISSUE:       #217 — [SEC-6.3] SSRF Regression Suite for External API Proxies
MISTAKE:     SSRF guard was not re-validated before a new external-proxy PR merged, causing regression.
ROOT CAUSE:  Security gate evidence was reused across a changed proxy surface without re-running the suite.
RULE:        Any PR touching an external API proxy must re-run the SSRF regression suite; prior PASS evidence is stale.
GATE:        Security Auditor gate (kernel.md §3); evidence-cache rules (handoff.md)
TICKET:      [RETRO-1.2] — open via routing trigger after gate-fail
```

### RETRO-2.1
```
DATE:        2026-08-22
TEAM:        AI
ISSUE:       #310 — [ADMIN-3.8] AI provider test/dry-run + cost, health & fallback dashboard
MISTAKE:     Shared module import resolved at test time (via mocking) but failed at deploy time (via esbuild) because the exported symbol didn't exist.
ROOT CAUSE:  Unit tests mock the import target, so the real export is never verified. Only esbuild (Netlify's bundler) traces the full module graph — and it fails when an import has no matching export.
RULE:        Any PR adding a new import from netlify/functions/_shared/ must verify the exported symbol exists (grep for "export function" matching the import name, or run a bundler dry-run). Unit tests alone are insufficient — mocking hides missing exports.
GATE:        Release Validator pre-submit checklist (kernel.md §6.1)
TICKET:      [RETRO-2.1] — auto-opened after deploy-time esbuild failure
```
```
DATE:        2026-08-21
TEAM:        SECURITY
ISSUE:       #271 — [ADMIN-2.7] Security gate: threat model + negative tests + sign-off
MISTAKE:     Security gate verdict was referenced 48 h+ after production and treated as still valid.
ROOT CAUSE:  No explicit TTL or re-check cadence was defined for security gate verdicts.
RULE:        Security gate verdicts expire after 48 h or on any change to the security surface, whichever is sooner.
GATE:        Security Auditor gate; evidence-cache rules (handoff.md)
TICKET:      [RETRO-1.3] — open via routing trigger after gate-fail
```
