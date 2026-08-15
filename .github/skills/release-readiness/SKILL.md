# Release readiness

Use before merging or deploying a significant change.

## Checklist

- Build succeeds.
- Targeted tests pass.
- Full tests pass when scope requires them.
- Coverage remains at or above the repository threshold.
- Secret and dependency scans pass.
- API compatibility is checked.
- Database migrations are validated.
- PWA installation and offline startup are checked where relevant.
- Rollback or forward-fix is documented.
- Changed files, risks and assumptions are reported.
