# AI development framework

This directory documents how repository agents, skills and prompts work together.

## Operating model

1. One primary agent owns each task.
2. Supporting agents review or provide specialist input; they do not independently redesign the same scope.
3. Agents use repository evidence and distinguish observed facts, inferences, assumptions and unknowns.
4. Agents prefer the smallest coherent change and add tests for changed behaviour.
5. Agents are token-conscious: inspect narrowly, avoid rereading unchanged files and stop when acceptance criteria are evidenced.

## Work stages

```text
discovery -> targeted inspection -> decision -> implementation -> validation
```

## Evidence ledger

Agents should maintain a compact working ledger:

```text
Files inspected:
- path/to/file

Facts:
- observed behaviour

Unknowns:
- unresolved behaviour

Next inspection:
- smallest useful next file or symbol
```

## Required completion report

- Summary.
- Files changed.
- Tests and checks run.
- Coverage impact.
- Risks and assumptions.
- Remaining work.

## Routing

| Task | Primary agent | Supporting agent |
|---|---|---|
| Architecture decision | Whole-stack architect | Data or platform architect |
| React feature | Frontend developer | Frontend architect, tester |
| Netlify Function | Netlify backend | API contract reviewer, security auditor |
| Offline persistence | Sync engineer | Offline architect, tester |
| Tenant authorization | Multi-tenant security | Netlify backend, data architect |
| Database migration | Data architect | Security auditor, tester |
| Docker/Synology | Platform architect | Security auditor |
| API contract | API contract reviewer | Backend agent |
| Release | Release validator | Tester, security auditor |
| Ergonomics | Ergonomics reviewer | UI/UX expert |
| Marketing copy | Marketing manager | Project manager |

## Scope rules

- Do not inspect the whole repository unless the task explicitly requires it.
- Do not invent APIs, schemas or security guarantees.
- Do not modify authentication, payments or tenant isolation without targeted tests.
- Do not introduce microservices or infrastructure without measured justification.

## Mandatory security gate

Any change touching **auth, authorization, user data, payments, storage,
caching, external APIs, or databases** MUST pass a security gate before it is
declared done:

1. **Threat modeling** — identify the assets, trust boundaries, and the
   threats the change introduces or weakens (see the `security-auditor` and
   `multi-tenant-security` agents).
2. **Negative security tests** — attack-path tests (unauthorized access,
   IDOR, privilege escalation, tampering) in addition to happy-path tests.

The owning agent MUST route such changes to the `Security Auditor` (or
`Multi-tenant Security` for tenant isolation) for a blocking review. This gate
is **blocking** — security review may not be skipped, deferred, or waived by
an implementer.

## Supply-chain & secrets security (SEC-EPIC-5)

Two layers of scanning:

- **Advisory, non-blocking** (`secret-scan.yml`, `sonarcloud.yml`)
  surface findings without gating the launch branch.
- **Blocking merge gate** (`security-ci.yml`, #213) **fails the check-run** on
  critical/high findings so it blocks merges via the required status checks.
  It covers security unit tests, dependency checks
  (`npm audit --audit-level=high`) and secret scanning (Gitleaks).
- **SAST (CodeQL)** is enforced **out of band** via GitHub **CodeQL default
  setup**, which is enabled at the repo level. The advanced-config CodeQL
  workflows (`codeql.yml` advisory and the former `sast` job in
  `security-ci.yml`) were removed in #412 because default-setup rejects
  advanced-config SARIF uploads. Default-setup code-scanning results surface
  as code-scanning alerts and must be added as a branch-protection required
  status check to gate merges.

- **Dependency/SCA scanning (#208)** — Dependabot (`.github/dependabot.yml`)
  opens weekly update PRs for npm and GitHub Actions; an advisory
  `npm audit --audit-level=high` step runs on every PR/push in `sonarcloud.yml`
  (`continue-on-error: true`). Remediation SLAs once a finding is filed:
  - **Critical** — fix within **7 days**.
  - **High** — fix within **30 days**.
  - Moderate/low — next regular dependency update.
- **SAST (#209)** — enforced via GitHub **CodeQL default setup** (enabled at the
  repo level by the owner). The advanced-config CodeQL workflow
  (`.github/workflows/codeql.yml`) and the former `sast` job in
  `security-ci.yml` were removed in #412 because default-setup rejects
  advanced-config SARIF uploads. Default-setup runs `security-extended`
  code scanning on every push/PR to `main`; findings surface as code-scanning
  alerts and are gated via the default-setup required status check.
- **Secret scanning (#210)** — an advisory Gitleaks scan
  (`.github/workflows/secret-scan.yml`, config in `.gitleaks.toml`) runs on
  every PR/push in report-only mode. Real-time secret scanning + push
  protection is a **repo-level GitHub setting the owner must enable** (below).

### Owner actions (required, one-time)

1. In the GitHub repo **Settings → Code security and analysis**, enable
   **Secret scanning** and **Push protection** (blocks known secrets pushed to
   the repo in real time). Optionally enable **Dependabot alerts** and
   **Dependabot security updates** to complement the weekly PRs.
2. In **Settings → Branches**, add the `security-ci.yml` job names
   (`security-tests`, `dependency-audit`, `secret-scan`) **and** the **CodeQL
   default-setup** check to the branch-protection **required status checks** so
   the blocking gate (incl. SAST via default-setup) actually gates merges (this
   is what makes #213 effective).
3. Follow-up for #208: commit a `package-lock.json` so the npm ecosystem
   (Dependabot + `npm audit`) resolves pinned versions.

### Exceptions policy (#213 — who may waive a blocking finding, and how)

The blocking gate is a **merge gate**, not a veto on shipping with a known
issue — but exceptions are narrow and audited:

- **Which findings can be waived**:
  - **Moderate / low** severity findings do NOT block merges (the gate only
    fails on high/critical). They are tracked via the advisory scans and
    Dependabot PRs; fix on the normal cadence.
  - **High / critical** findings can only be waived when (a) a **ticket** is
    filed describing the finding, the impact, and the remediation plan, and
    (b) the **Security Auditor** approves the exception. No self-approval by
    the implementer.
  - **Secrets** (Gitleaks / secret scanning) are **never** waivable — a
    detected secret is a rotation incident (see the response procedure
    below), not a merge exception.
- **By whom**: only the **Security Auditor** (with the Project Manager's
  concurrence for schedule impact) may approve a high/critical exception.
- **With a ticket**: every exception must reference an open issue (e.g.
  `#NNN`), and the PR description must link it. The exception is temporary:
  the ticket stays open until the finding is remediated, and the PR is not
  considered "done" under the mandatory security gate until the ticket closes.

### Secret-leak response & rotation procedure

If a secret is detected (push protection, secret scanning, Gitleaks, or code
review):

1. **Contain** — treat the leaked value as compromised immediately; do not
   assume deletion removed it (assume it was copied).
2. **Rotate** — replace and revoke the old value at its source:
   - `RUNOUT_ADMIN_KEY` — generate a new random value, update the Netlify
     environment variable and any local `.env` files, and invalidate sessions.
   - Access codes (`RU-XXXX-XXXX-XXXX`) — revoke and re-issue codes for
     affected members from the admin panel.
   - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — rotate in the Stripe
     dashboard and update Netlify.
   - `GOOGLE_BOOKS_API_KEY` — regenerate in Google Cloud Console and update
     Netlify.
   - `RUNOUT_DISCOGS_TOKEN` — reset the Discogs token and update Netlify.
3. **Purge** — remove the leaked value from git history (e.g. `git filter-repo`
   or a GitHub support request) and from the Netlify Blob cache if it was ever
   stored there.
4. **Verify** — confirm the old value no longer works (401/403) and the new
   value is env-only in production (no dev fallback).
5. **Record** — note the incident, rotate any other secrets that shared the
   exposure window, and route the incident to the `Security Auditor` for
   sign-off.

> Never put actual secret values in code, docs, logs, issues, or PRs. Only
> reference the variable names listed above.
