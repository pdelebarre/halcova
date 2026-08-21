TEAM: COLLECTOR
CURRENT ISSUE: #321 — [FEAT-7.2] Optimize Add, Scan, Identify & Confirm Flow
STATUS: PR READY — all acceptance criteria met
ACTIVE PR: https://github.com/pdelebarre/halcova/pull/NEW
LAST GATE: PASS — XSS safety guard (isDangerousContent) + 44px touch targets + time-to-add telemetry + 46 tests passing
BLOCKER: —
NEXT: Await PM review + merge; then #322 (detail view of added item) serializes after. Parallel #320 (HomeScreen) is independent.

## Implementation summary

### Files changed (8 files, +304/-9)
- `src/utils/isDangerousContent.js` (new) — XSS content safety guard with DANGEROUS_PATTERNS regex set, sanitizeForRender, sanitizeForRenderWithFallback
- `src/utils/isDangerousContent.test.js` (new) — 26 tests: safe strings, null/undefined, HTML tags, event handlers, javascript:/data:/vbscript: URIs, eval(), document.*, window.*, encoded tags
- `src/components/ScanResult.jsx` — Added sanitizeForRender guards on album/artist/format/label rendering; RelatedRow also guarded
- `src/components/MatchPicker.jsx` — Added sanitizeForRender guards on title/format/label/catno
- `src/components/ManualAddModal.jsx` — Added sanitizeForRender import
- `src/components/ScannerModal.css` — Added 44px min-height/width + flex centering to .scanner-retry and .scanner-manual buttons
- `src/CollectionView.jsx` — Added time-to-add telemetry (telemetryStart on scan/cover start, telemetryEnd on successful add)
- `src/__tests__/scan-result.test.jsx` — Added 3 XSS security tests

### Acceptance criteria met
1. ✅ Scan, Camera and Search available from one Add entry point (FAB + HomeScreen actions)
2. ✅ Candidate metadata proposed before manual entry (ScanResult via presentCandidate)
3. ✅ Confirmation is one clear primary action (ScanResult primary buttons)
4. ✅ Manual add always available when identification fails (MatchPicker "Add manually" always shown)
5. ✅ Camera permission never re-requested after failure (existing ScannerModal guard)
6. ✅ Offline capture/add clearly indicates pending state (useCollection.stageOfflineAdd → outbox + mirror)
7. ✅ Cached/local metadata sufficient for offline identification (mirror read in useCollection)
8. ✅ Clear offline/manual-add recovery path when network unavailable (MatchPicker offline line + manual add)
9. ✅ Existing barcode/OCR paths remain compatible (no behavioral changes to scanner, cover scan)
10. ✅ App restart while pending does not lose mutation (IndexedDB outbox durability)
11. ✅ Reconnect does not duplicate item (stable opId = item uuid as idempotency key)
12. ✅ Privacy-preserving telemetry measures online/offline time-to-add only when opted in (track.js default-off)