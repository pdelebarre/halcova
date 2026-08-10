---
description: "Fix the Runout 'dark screen' bug — the app unmounts to a blank/dark page after an action because an uncaught render error crashed React (there is no error boundary). Triggers: 'dark screen', 'blank screen', 'app crashed after adding', 'white screen', 'render error', 'screen went black'."
name: "Fix dark-screen render crash"
argument-hint: "What were you doing when it went dark (e.g. 'after adding an LP')?"
agent: "Runout Engineer"
---
Diagnose and fix the dark-screen render crash in Runout.

The app has no error boundary — any uncaught error while rendering unmounts the
React tree, leaving the `#16130F` body background (a dark/blank screen). It
persists on refresh when the crash is data-driven.

## Steps
1. Reproduce the crash and capture the console error (render stack + offending
   component).
2. Identify the item whose data path crashed — usually the item just added or
   edited. Check `title`, `genre`, `coverImage`, and missing/undefined fields.
3. Fix at the source: guard the render path (defensive defaulting) OR fix the
   data shape. Prefer the root-cause fix over sprinkling `?.` everywhere.
4. Verify `splitArtistTitle` from `src/utils/match.js` is imported wherever
   titles are split — a missing import here has caused exactly this bug before.
5. Confirm the exact item no longer crashes, then re-check the normal
   add/scan/delete flows.

## Deliverables
- The root cause (data path + component).
- The fix applied.
- Confirmation the app renders after the same action that crashed it.
