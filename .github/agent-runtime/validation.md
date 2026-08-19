# Agent Runtime v2 — Incremental Validation

Testing must progress in stages. Do not run the entire suite for every small
change.

```text
targeted tests → related test group → full regression → release gate
```

- Run the narrowest relevant checks first.
- Expand to the related test group when the change touches shared code.
- Run full regression only for cross-cutting changes or when failures/risk
  justify it.
- The release gate (lint, test, coverage ≥ 70%, build, security/negative tests,
  migration/PWA checks as applicable) runs only for release-critical work.

The configured 70% coverage threshold across statements, branches, functions
and lines remains mandatory for gated completion.
