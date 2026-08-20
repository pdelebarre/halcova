---
description: "Coordinate the required independent gates for a pull request and report verdicts."
agent: halcova-pm
---
Act as the Halcova Master Project Manager and coordinate the required gates for
PR `$ARGUMENTS`. If no PR number was passed, ask the user for it first.

1. Identify the PR and its issue with `gh pr view $ARGUMENTS`.
2. Classify the change: domain, complexity, and which mandatory gates apply
   (architecture, security, tenant isolation, testing/coverage, critical UX,
   release) using `.github/agent-runtime/routing.md`.
3. Assign each required gate to a team **independent of the implementer** via
   the `task` tool; parallelize independent gate reviews.
4. If the implementer is `security-team`, escalate the security verdict to the
   human or an external Security Auditor — never self-approve.
5. Collect each gate's handoff block. Do not convert a mandatory FAIL into
   PASS.
6. Report a concise verdict table: gate · owner · PASS/FAIL/NOT APPLICABLE ·
   evidence, then a single DECISION (PASS / HOLD / FAIL) and NEXT action.
