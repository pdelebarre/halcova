# Token-efficient work

Use this skill for every repository task.

## Before reading files

1. Inspect the smallest relevant directory.
2. Search for symbols, imports, routes, configuration keys and tests.
3. Read targeted files before large files in full.
4. Reuse facts already established in the current task.

## During analysis

- Maintain a compact evidence ledger.
- Separate observed facts, inferences, assumptions and unknowns.
- Avoid rereading unchanged files.
- Batch independent inspections when supported.
- Stop when acceptance criteria are sufficiently evidenced.
- Ask for clarification when the scope contains unrelated domains.

## Implementation discipline

- State the smallest planned change before editing.
- Prefer a focused diff over a rewrite.
- Do not generate speculative code before confirming interfaces.
- Add or update tests for changed behaviour.
- Run targeted validation before broad validation.

## Output discipline

- Start with a concise status.
- List changed files rather than reproducing them.
- Report tests and coverage impact.
- Report uncertainty explicitly.
- If context is becoming constrained, summarize the ledger and ask whether to continue.
