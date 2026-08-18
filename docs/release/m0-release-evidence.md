# M0 Release Evidence — Current Records/Books Product

**Status:** HOLD  
**Baseline commit:** `7d4aaaaa728f339ecc0ec49c486fcce08a494063`  
**Baseline date:** 2026-08-18

## Objective

M0 is the release gate for the existing Records/Books product. This document records objective evidence and explicit blockers; it does not authorize M1.

## Quality gates

| Gate | Evidence | Status |
|---|---|---|
| Build | `npm run build` passed on the latest verified mainline validation before the M0 CI-only change; recent merged PRs consistently report a successful production build. | PASS (evidence available; current post-merge run not exposed by the connector) |
| Tests | `npm test` passed with 1,777 tests in the latest verified mainline validation. | PASS (latest verified evidence) |
| Coverage | 86.94% statements in the latest verified mainline validation, above the repository's 70% gate. | PASS |
| Lint | `npm run lint` is now a blocking step in `security-ci.yml` via merged PR #357. | PASS — gate configured; current run evidence still required |
| Security CI | Blocking workflow includes security tests, dependency audit, secret scan and SAST; lint is now also blocking. | PASS — configuration verified |

The current `main` commit is the merge of PR #357, which added lint to the blocking Security CI workflow. No application runtime code was changed by that PR.

## Current-product security evidence

Existing security work already merged into `main` covers identity/session security, tenant isolation/object authorization, API/input/web security, data protection/offline cache isolation, payments and incident response. M0 must preserve those controls rather than duplicate them.

No new M0 security surface should be introduced without the mandatory Security Auditor gate.

## Product-risk sweep

### Blocking item: iOS scanner validation

Issue #87 is intentionally **open** again. Its implementation is merged, but its explicit physical-device acceptance criteria remain unverified:

- no iOS Safari permission re-prompt when continuing to scan;
- no camera LED/battery drain while the result sheet is displayed.

The issue's existing backlog comment explicitly recorded these checks as outstanding. It must not be considered complete until evidence is recorded.

### Other scanner evidence

Recent merged scanner fixes established a known-good `zxing-wasm` 3.1.2 pin, same-origin WASM loading and CSP support, with unit/build/E2E validation. Physical iOS validation remains the remaining evidence gap.

## Product metrics baseline

M0 requires minimum privacy-preserving measurement for:

- **Activation:** first meaningful successful item-add journey.
- **Add:** successful item addition, with source classified as scan/manual.
- **Browse:** collection browsing usage by collection kind.

The existing `src/utils/track.js` mechanism is first-party, DEFAULT-OFF, sanitizes event properties before queueing, caps the local queue, and never throws. `CollectionView` already emits `gamif_item_added` for successful owned adds.

The full telemetry ingestion/dashboard pipeline remains deferred to the later analytics epic (#257). M0 must not introduce a third-party analytics SDK or silently enable tracking.

**Current gap:** activation and browse events are not yet consistently wired to the existing privacy-preserving queue. Therefore the analytics exit gate is not yet satisfied.

## M0 decision

**HOLD**

M0 cannot be declared PASS yet because:

1. physical iOS scanner validation remains outstanding (#87);
2. activation/browse baseline instrumentation still needs to be wired or explicitly risk-accepted;
3. a fresh post-#357 CI run is not currently exposed through the GitHub connector, so current lint/test/build evidence should be confirmed by GitHub Actions before release.

## Next actions

1. Complete physical iOS validation and record evidence on #87.
2. Add minimal DEFAULT-OFF activation/browse instrumentation using the existing first-party queue; do not build the full analytics backend.
3. Run/verify the complete blocking Security CI on the resulting mainline commit.
4. Re-run this evidence review.
5. Only then make the M0 PASS/HOLD decision.

M1 must not start as a release milestone until M0 is either passed or an explicit product risk acceptance is recorded.
