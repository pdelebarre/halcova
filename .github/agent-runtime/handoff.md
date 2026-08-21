# Agent Runtime v2 — Compressed Handoff & Evidence Cache

## Handoff contract

Every specialist/team handoff uses exactly this block:

```text
STATUS: PASS | FAIL | HOLD | NOT VERIFIED
ISSUE:
PR:
DECISION:
EVIDENCE:
RISKS:
NEXT:
```

Rules:

- No copied issue descriptions, ADRs, source code or long logs.
- Use file/line references instead of pasted content.
- Do not reproduce code or logs unless the exact excerpt is required.
- `DECISION` is 1–3 sentences; `EVIDENCE` cites tests/checks/verdicts only;
  `RISKS` lists unresolved items only; `NEXT` is one action.
- `NOT VERIFIED` is valid when context is insufficient; never infer PASS.

## Team checkpoint

Each persistent team keeps a compact checkpoint at
`.github/agent-runtime/state/teams/<team>.md` using exactly this block (no
narrative):

```text
TEAM:
CURRENT ISSUE:
STATUS:
ACTIVE PR:
LAST GATE:
BLOCKER:
NEXT:
LESSONS: [RETRO-x.y, RETRO-x.z — last 2-3 RETRO tickets relevant to this team]
```

## Evidence cache

A previous PASS may be reused **only when all** of the following hold:

1. the relevant code/security surface has not changed;
2. the governing ADR/contract has not changed;
3. dependencies affecting the gate have not changed.

Otherwise re-run the gate.

Reuse must cite the original evidence and the commit/PR it was produced
against. Stale or unverifiable evidence → `NOT VERIFIED`, then re-run the gate.
Security and tenant-isolation verdicts are never reused across a changed
security surface.

Each gate is recorded compactly as: **gate · scope · commit · evidence ·
result**. Security evidence must never be reused after a relevant
security-surface change.
