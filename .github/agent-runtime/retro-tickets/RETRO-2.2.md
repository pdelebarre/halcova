# RETRO-2.2 — Navigation and action flow regression after UI refactor

- **Date:** 2026-08-22
- **Team:** COLLECTOR
- **Issue:** #320/#321 M2 home redesign — scan button, manual add, cover scan and home action buttons all broken in the same pattern
- **Mistake:** HomeScreen callbacks (`onScan`, `onScanCover`, `onManualAdd`) all just set `navTab='browse'` with no mechanism to carry the user's intent to the collection view. The scan button in BottomNav also just set `navTab='browse'` with no scan trigger. Four user-visible actions silently became no-ops.
- **Root cause:** The `navTab` state alone can't carry action intent. When the M2 home redesign added `HomeScreen` and `BottomNav` as separate components, there was no `pendingAction` state to bridge the gap between "user tapped scan on the home screen" and "collection view opens the scanner modal." The comments in the code literally said "The scan flow starter will be handled by the browse view" but no handler was ever wired.
- **Rule:** Any UI action that crosses a component boundary (home → browse, bottom nav → browse) must use a shared intent mechanism (state prop, callback chain, or context) — not just tab switching. A code review of the complete action flow from tap to modal should be part of pre-submit verification for UI refactors.
- **Gate:** Code review (Front End Architect) for any PR that restructures navigation or adds new UI panels that route to different component trees.