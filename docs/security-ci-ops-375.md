# Security-CI Remediation — OPS-3.1 (#375)

> OPS-3.1 (#375). Operating note recording the diagnosis and remediation of
> the pre-existing blocking `security-ci.yml` merge-gate failures on mainline.
> Companion to the exceptions ticket **#386** (dev-only dependency HIGHs) and
> the PR on `feat/m1-sec-375-ci-remediation`.
>
> Security properties preserved: **no access codes or admin credentials are
> exposed, leaked, or changed**; the `.gitleaks.toml` allowlist continues to
> cover **only fake test-fixture values** (never a real secret); auth /
> authorization / storage contracts are untouched.

## Background

The blocking gate (`security-ci.yml`, #213) failed 5 check-runs identically on
every `main` commit and PR #370:

| # | Check | CI failure (root cause) | Fix |
| --- | --- | --- | --- |
| 1 | `Dependency audit (npm audit)` | 9 HIGH, all **dev-only** via `netlify-cli`; some with no fix available | Upgraded `netlify-cli` 27.1.1→27.1.2 (removes `image-size`); filed **exceptions ticket #386** for the remaining no-fix `extract-zip` + `sharp` |
| 2 | `Secret scan (Gitleaks)` (blocking) | **Not a secret.** CI failed with Docker `pull access denied` for `gitleaks/gitleaks:v8.24.3` (exit 125) | Switched the scan from the Docker image to the standalone `gitleaks` binary (same v8.24.3 engine). Full-history scan reports **0 leaks**. |
| 3 | `Security unit tests` | **Node 20 mismatch.** The `jsdom@30`/`undici@8` stack requires Node `>=22.19.0`; under Node 20 the vitest worker crashed (`webidl.util.markAsUncloneable is not a function`), silently dropping most test files (only 57/153 ran) | Pinned CI Node `20 → 22` (matches undici engines; local toolchain). Local run: 153 files / 1924 tests pass. |
| 4 | `SAST (CodeQL, blocking)` | **Repo-settings conflict, not a code bug.** CodeQL **default setup is enabled** on the repo, so the advanced-config SARIF cannot be processed (`CodeQL analyses from advanced configurations cannot be processed when the default setup is enabled`). Default-setup `Analyze` jobs already succeed. | **Documented only — owner action required** (see below). |
| 5 | `github-advanced-security` | Not a real workflow check — a required status check with no matching workflow (repo settings / feature-availability). | **Documented only — owner action required** (see below). |

## 1. Dependency audit — exceptions ticket #386

- **Before:** `npm audit --audit-level=high` → **9 HIGH**, all via `netlify-cli`
  (`extract-zip`, `image-size`, `sharp`/libvips), all dev-only, none in the
  production runtime.
- **After (netlify-cli 27.1.2):** **7 HIGH** — `image-size` resolved by the
  upgrade; remaining `extract-zip` (GHSA-jmr9-qjv8-65gv) and
  `sharp`/libvips (GHSA-f88m-g3jw-g9cj) have **no fix available** in the
  current `netlify-cli` 27.x line (`npm audit fix --force` only proposes a
  downgrade to `netlify-cli@23.15.1`, a regression — not a fix).
- **Disposition:** filed **exceptions ticket #386** ([SEC-EXC-375]) describing
  each finding, impact (dev-only, local `netlify dev` tooling only), and a
  remediation plan (recheck each upstream release). **Requires Security Auditor
  approval** — the implementer cannot self-approve. `netlify-cli` is not
  bundled/deployed; production runtime dependencies are unaffected.

## 2. Secret scan (Gitleaks) — NOT a secret; infra fix

- The blocking scan's log showed **`docker: pull access denied for
  gitleaks/gitleaks` (exit 125)** — Docker could not pull the public image on
  the hosted runner. This is an infrastructure failure, **not** a detected
  secret and **not** a false-positive-allowlist situation.
- Verified with the standalone `gitleaks` v8.24.3 binary over full history
  (fetch-depth 0): with the repo's `.gitleaks.toml` → **0 leaks**.
- Cross-checked with **pure default rules (no allowlist)**: the only findings
  are 6 **fake test-fixture values** (a rotated-token placeholder, a placeholder
  Stripe `sk_live_*` test key, and placeholder `RU-1234-...` access codes)
  inside `*.test.js`/`__tests__/*` files — all already covered by the existing
  `.gitleaks.toml` allowlist (test fixtures). **No allowlist change is
  required; the allowlist never covers a real secret.** (Literals are described
  only by rule/pattern here, per the repo's no-secret-values-in-docs rule.)
- **Fix:** both `secret-scan.yml` (advisory) and `security-ci.yml` →
  `secret-scan` (blocking) now download and run the standalone
  `gitleaks_8.24.3_linux_x64` binary instead of Docker. SEC-5.4 pinning is
  preserved (version pinned to v8.24.3).

## 3. Security unit tests — Node version fix

- Root cause: the repo's dev stack (`jsdom@30` depends on `undici@^8.9.0`,
  which declares `engines.node >= 22.19.0`) crashes under Node 20. In CI (Node
  20) the vitest `forks` worker threw `TypeError: webidl.util.markAsUncloneable
  is not a function` and dropped most test files (57 passed / 951 tests) before
  exiting 1. Local (Node 26) passed all 153 files / 1924 tests.
- **Fix:** pinned `node-version: 20 → 22` in `security-ci.yml` (test + audit
  jobs), `sonarcloud.yml`, and `sbom.yml` — aligning CI with the dependency
  engines and the local toolchain. `vitest@4` supports `^20 || ^22 || >=24`;
  Node 22 is Active LTS. This does **not** weaken the test gate — it makes CI
  run the **full** suite (153 files / 1924 tests) that it was previously
  dropping.

## 4. SAST (CodeQL) — documented, owner action (not code-fixable)

- The CodeQL analysis itself **succeeds** (autobuild + analyze complete); only
  **SARIF submission fails**:
  `Code Scanning could not process the submitted SARIF file: CodeQL analyses
  from advanced configurations cannot be processed when the default setup is
  enabled`.
- **Cause:** GitHub **CodeQL default setup is enabled** at the repo level AND
  the repo also runs advanced-config workflows (`codeql.yml` advisory +
  `security-ci.yml` `sast` blocking). GitHub rejects the advanced-config SARIF
  upload while default setup is on. The check-run list confirms default-setup
  jobs (`Analyze (actions)`, `Analyze (javascript-typescript)`) succeed.
- **Disposition:** no repo-code fix can resolve the settings conflict.
  **Owner action required:** choose ONE of
  (a) disable **CodeQL default setup** in repo settings so the advanced-config
  blocking `sast` job can upload SARIF, or
  (b) keep default setup (it already runs CodeQL security scanning) and remove
  / relax the redundant blocking `sast` job.
  The blocking `sast` job should remain gated on actual high/critical findings
  either way; this is a settings reconciliation, not a finding.

## 5. `github-advanced-security` — documented, owner action

- `github-advanced-security` appears as a failing item but is **not a
  workflow check** — it is a required status check with no matching workflow,
  reflecting a repo settings / feature-availability state (e.g. a required
  status-check name for a disabled Advanced-Security feature).
- **Disposition:** **owner action** in repository settings — reconcile required
  status checks with the actual workflows/checks.

## Verification (on branch `feat/m1-sec-375-ci-remediation`)

- `npm run lint` → 0 errors (warnings only), exit 0.
- `npm test` → **153 files / 1924 tests passed**, exit 0.
- `npm run build` → passes; PWA precache intact (59 entries); only the
  pre-existing >500 kB chunk-size warning.
- `npm audit --audit-level=high` → **7 HIGH** (was 9): all dev-only via
  `netlify-cli`, no fix available → exceptions ticket #386.
- Gitleaks v8.24.3 standalone over full history → **0 leaks** with repo config.

## Next required gate

1. **Security Auditor approval** of exceptions ticket **#386** (dependency
   HIGHs) and sign-off on the Gitleaks-clear scan (no real secret).
2. **Owner action** for CodeQL default-setup conflict (#4) and
   `github-advanced-security` (#5).
3. Re-run `security-ci.yml` on the branch to confirm the gate is green.
4. PM-controlled merge to `main`.
