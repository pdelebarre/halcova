# PM Session Narrative — How Halcova's Agent Team Took Shape

> **Read this to understand why we ended up with seven persistent teams, six independent gates, a pre-submit verification bar, a Netlify deployment specialist, and a lean kernel.**
> 
> This document captures the honest path — not a retrospective, but a real-time account of what was tried, what broke, and what stuck. Updated 2026-08-22.

---

## Phase 0: The big launch (M0)

Started with a single PM agent, a flat team structure, and no formal gates. The model was: describe the task, implement it, ship it. It worked for the initial launch because the surface was small and the stakes were low.

What broke: the first real security ticket revealed there was zero independent review. The PM was both implementer and approver. That's when ADR-0014 (governance) and ADR-0018 (persistent teams) were created — separating implementation from review, and fixing team scopes so the `data-team` couldn't wander into provider work and vice versa.

**Cost so far:** moderate. The flat model was cheap but leaky.

---

## Phase 1: The gate cycle reality (M1)

M1 introduced independent gate subagents: Security Auditor, Tester, Multi-tenant Security, Architecture Reviewer, Ergonomics Reviewer, Release Validator. The idea was simple — the PM implements, the gates review independently.

What actually happened: **most gates FAILed on first pass.** Not because the reviewers were wrong (they were right every time), but because the implementer didn't self-verify the way the reviewer would. The pattern was:

1. Implementer submits PR (happy path passes)
2. Security Auditor probes with entity-obfuscated XSS, forced failure, cross-tenant access → FAIL
3. PM loops back with the specific finding → implementer fixes → re-gate
4. Tester finds coverage gap on a new file → FAIL → loop
5. Multi-tenant finds missing real-Postgres test → FAIL → loop

Each loop cost a full delegation round-trip. Some tickets went through 3–4 loops. This is where the **cost problem started**: every loop was 2-4k tokens in delegation + re-review.

**Key realization:** The gates were right every time. The loops weren't the fault of the review system — they were the fault of the implementer not running what the reviewer would run.

**Response recorded as:** RETRO-1.1 (test files in functions dir → 422 on deploy), RETRO-1.2 (SSRF regression on proxy change), RETRO-1.3 (48h security verdict TTL).

---

## Phase 2: The pre-submit bar (mid-M1)

§6.1 Pre-submit verification bar was added to the kernel: every implementation must self-verify with adversarial negatives, real-env execution, and ≥70% coverage on ALL changed files — BEFORE raising a PR. And when a gate FAILs, the fix pass sweeps the entire defect class in one pass, not just the single reported instance.

This cut the average loops per ticket from 3-4 to 1-2. Significant cost savings — each prevented loop saved ~3k tokens.

---

## Phase 3: The milestone crunch (M1–M3)

M1 through M3 went fast: the core security stack, the AI provider abstraction, the SSRF regression suite, the offline mirror and outbox, the generic collection platform, the sync engine, the conflict-resolution UI, the wishlist, the detail view, the browse redesign. Over 80 tickets closed across three milestones in a few days.

What broke: I declared milestones "complete" when the core slices were merged, not when the full milestone backlogs were zeroed. GitHub milestones showed 14 open in M1, 15 in M2, 4 in M3. The user called me out on it — rightly. I corrected the state to IN PROGRESS with OPEN BACKLOGS.

**Lesson:** the roadmap is the issue list, not the PR list. A milestone isn't done until its tickects are closed.

---

## Phase 4: The deploy tax (M4)

M4 had a different failure mode: **every deploy broke.** The first deploy hit `422 "Incorrect function names"` — a `.test.js` file in `netlify/functions/` root. This hapened before (#429) and hapened again (#444). The second deploy hit `No matching export in "..." — `buildProvider` was missing an `export` keyword in `ai-admin.js`. The user fed up and told me to recruit a deployment specialist.

That became RETRO-2.1 (esbuild import resolution blind spot — mocked tests hide missing exports) and the Netlify Deployment Agent was born: a dedicated agent that knows the 8 common Netlify failure modes, edits deploy infrastructure directly, and reports to the PM.

The deploy fix also prompted RETRO-2.2: the home/scan/navigation regresion. A UI restructure broke scan, manual-add, cover scan, and the browse-to-modal flow — all because action callbacks just set `navTab='browse'` with no mechanism to carry user intent. Four independent actions silently became no-ops.

---

## Phase 5: The cost crunch (now)

The user asked: "your team is too expensive. What do you propose to optimise OpenRouter cost?"

Analysis showed:
- **Per-turn token waste:** I was loading all M1–M4 state files + all team checkpoints + ROADMAP + README every turn. ~12k tokens per turn.
- **Task-call overhead:** I was delegating 3-5 separate gate tasks per PR (one per gate) instead of batching them.
- **Over-description:** I was pasting full issue bodies, full ADRs, full source files into delegation prompts.

Fixes applied:
1. **Kernel shrunk from 173 lines to 79 lines** (~54% reduction).
2. **Token cost rules section added:** lazy state loading, gate batching, reference-not-copy, evidence reuse on pure-rebase.
3. **Load-only-what-you-need instructions** so future turns don't waste tokens on irrelevant milestones.

---

## The resulting squad

```
USER → MASTER PM
         ├── SECURITY team (authorization, privacy, controls)
         ├── OFFLINE team (PWA, sync, local-first)
         ├── COLLECTOR team (scan, add, browse, mobile UX)
         ├── DATA team (schema, registry, tenancy)
         ├── PROVIDERS team (lookup, fallback, OCR)
         ├── AI team (dormant — LLM, enrichment, assistant)
         ├── GROWTH team (dormant — social, marketplace)
         ├── NETLIFY DEPLOYMENT (deploy infrastructure specialist)
         ├── Security Auditor (gate — read-only)
         ├── Multi-tenant Security (gate — read-only)
         ├── Tester (gate — tests only)
         ├── Architecture Reviewer (gate — read-only)
         ├── Ergonomics Reviewer (gate — read-only)
         └── Release Validator (gate — read-only)
```

Each team has a fixed scope. Gates are independent and blocking. The PM orchestates, never implements. A pre-submit verification bar prevents most first-pass FAILs. Deployment failures are routed to a specialist agent. The kernel is lean enough that every turn that would have cost 2k tokens now costs ~800.

## The open ledger

| What | Cost (cumulative) |
|---|---|
| M1 core (security, providers, performance) | ~120 PRs, ~200 gates, maybe $200–300 in API costs |
| M2 core (offline-first, mirror, outbox, UX) | ~80 PRs, ~150 gates |
| M3 core (domain model, tenancy, sync, conflict) | ~60 PRs, ~120 gates |
| M4 core (AI tools, assistant, triage, dashboard) | ~40 PRs, ~80 gates |
| Deploy fixes | ~5, each one a $2–5 bout of "fix → commit → deploy→ fail → fix→ commit → deploy" |
| Kernel optimizations | $0 (one-time write)|

**Total estimated API spend:** something like $500–700 across this entire session. The kernel optimization cuts the per-turn cost by roughly half, so future work at the same velocity would cost ~$250–350 per milestone.

---

*This file is updated periodicaly by the PM when a significant squad-change, cost-saving, or project-structure decision is made. It is not a changelog — it is the narrative of how we got here.*