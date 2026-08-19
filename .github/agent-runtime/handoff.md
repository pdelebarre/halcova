# Agent Runtime v2 — Compressed Handoff & Evidence Cache

## Handoff contract

Every specialist handoff uses exactly this block:

```text
STATUS: PASS | FAIL | HOLD | NOT VERIFIED
DECISION:
CHANGED:
EVIDENCE:
RISKS:
NEXT:
```

Rules:

- No copied issue descriptions, ADRs, source code or long logs.
- Use file/line references instead of pasted content.
- Do not reproduce code or logs unless the exact excerpt is required.
- `CHANGED` lists files/surfaces, not their contents.
- `EVIDENCE` cites tests/checks/verdicts, not full test logs.
- `NOT VERIFIED` is valid when context is insufficient; never infer PASS.

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
