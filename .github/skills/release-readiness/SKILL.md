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

## Security release checklist

MUST be verified (and signed off by the `Security Auditor`) before any release
touching auth, authorization, tenant isolation, storage, caching, external
APIs, or databases:

- [ ] **Authentication** — sign-in, session revalidation, logout, and code
      rotation verified end-to-end; no regression in the access-code flow.
- [ ] **Authorization** — every endpoint carries its auth check; per-collection
      plans and disabled members enforced (403).
- [ ] **Tenant isolation** — owner/member store separation verified; no
      cross-account read/write path (see the `multi-tenant-data` skill).
- [ ] **Secrets handling** — `RUNOUT_ADMIN_KEY` is env-only in production (no
      dev fallback); no access codes / admin keys in logs, bundles, or built
      output.
- [ ] **Dependencies (SCA/CVE)** — `npm audit` / SCA scan passes, or known
      risk is recorded and explicitly accepted.
- [ ] **Secret scanning** — repo-level secret scanning + push protection are
      active and `.github/workflows/secret-scan.yml` (advisory) shows no new
      findings (procedure in `.github/ai/README.md`).
- [ ] **CSP / security headers** — Content-Security-Policy and security
      headers are present and correct for the deployed origin.
- [ ] **Logging safety** — logs contain no secrets or PII; access codes and
      admin keys never appear.
- [ ] **Incident readiness** — rollback path and a security point of contact
      are documented; a security reviewer has signed off the release.
