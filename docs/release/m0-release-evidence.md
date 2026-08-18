# M0 Release Evidence — Current Records/Books Product

**Status:** HOLD  
**Baseline commit:** `7d4aaaaa728f339ecc0ec49c486fcce08a494063`  
**Latest M0 application commit:** merge of PR #362 (`17030affa7430b5d552a4e01377c51daa5a58675`)  
**Baseline date:** 2026-08-18

## Objective

M0 is the release gate for the existing Records/Books product. This document records objective evidence and explicit blockers; it does not authorize M1.

## Quality gates

| Gate | Evidence | Status |
|---|---|---|
| Build | `npm run build` passed in the latest verified mainline validation; M0 application changes are limited to the privacy-preserving instrumentation described below. | PASS — fresh post-#362 Actions evidence still required for final release decision |
| Tests | `npm test` passed with 1,777 tests in the latest verified mainline validation; M0 instrumentation PRs add focused regression coverage. | PASS — fresh post-#362 Actions evidence still required for final release decision |
| Coverage | 86.94% statements in the latest verified mainline validation, above the repository's 70% gate. | PASS |
| Lint | `npm run lint` is a blocking step in `security-ci.yml` via merged PR #357. | PASS — gate configured; fresh post-#362 run still required |
| Security CI | Blocking workflow includes security tests, dependency audit, secret scan and SAST; lint is also blocking. | PASS — configuration verified; fresh post-#362 run still required |

PR #361 and PR #362 are merged. #361 implements first-add activation telemetry and #362 implements collection browse telemetry. Both preserve DEFAULT-OFF tracking and use the existing first-party queue; neither adds a third-party analytics SDK or telemetry backend.

## Current-product security evidence

Existing security work already merged into `main` covers identity/session security, tenant isolation/object authorization, API/input/web security, data protection/offline cache isolation, payments and incident response. M0 must preserve those controls rather than duplicate them.

No new M0 security surface should be introduced without the mandatory Security Auditor gate.

## Product-risk sweep

### Blocking item: iOS scanner validation

Issue #87 is intentionally **open**. Its implementation is merged, but its explicit physical-device acceptance criteria remain unverified:

- no iOS Safari permission re-prompt when continuing to scan;
- no camera LED/battery drain while the result sheet is displayed.

The issue must not be considered complete until evidence is recorded.

### Other scanner evidence

Recent merged scanner fixes established a known-good `zxing-wasm` 3.1.2 pin, same-origin WASM loading and CSP support, with unit/build/E2E validation. Physical iOS validation remains the remaining device-evidence gap.

## Product metrics baseline

M0 requires minimum privacy-preserving measurement for:

- **Activation:** first meaningful successful item-add journey.
- **Add:** successful item addition, with source classified as scan/manual.
- **Browse:** collection browsing usage by collection kind.

The existing `src/utils/track.js` mechanism is first-party, DEFAULT-OFF, sanitizes event properties before queueing, caps the local queue, and never throws.

### Implemented

- **Activation:** PR #361 emits one `activation` event per browser session after the authoritative successful first meaningful add signal, carrying only collection kind and add source.
- **Browse:** PR #362 emits one `browse` event per collection kind per browser session when the Records/Books collection view mounts, carrying only `kind`.
- Focused tests cover enabled/disabled tracking, deduplication and payload safety.
- The full telemetry ingestion/dashboard pipeline remains deferred to #257.

Tracking remains DEFAULT-OFF and no item-identifying or secret data is added.

## M0 decision

**HOLD**

The implementation gates are substantially complete. M0 cannot yet be declared PASS because:

1. physical iOS scanner validation remains outstanding (#87);
2. a fresh post-#362 blocking Security CI run still needs to be confirmed as green for the final mainline evidence package.

No additional M0 product instrumentation work is currently required.

## Next actions

1. Complete physical iOS validation and record evidence on #87.
2. Confirm the complete blocking Security CI on the post-#362 mainline commit: tests, lint, build, dependency audit, secret scanning and SAST.
3. Re-run this evidence review.
4. Make the explicit M0 PASS/HOLD decision.
5. Do not start M1 as a release milestone until M0 is passed or an explicit product risk acceptance is recorded.
