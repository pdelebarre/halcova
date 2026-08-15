# Spec — Activation: the scan loop & empty-state onboarding

- **Status:** Draft — for product/design review, not yet implemented
- **Owner:** Marketing Manager (handoff to Front End Developer)
- **Suggested branch:** `feat/scan-add-loop` (C1) and `feat/empty-state-onboarding` (C2)
- **Scope:** frontend only. No backend changes. All copy ships through `catalog.copy` / i18n — this document names the keys; it does not edit `src/`.

---

## Why these two

The core habit is **"scan a crate/shelf in one sitting"** (a burst-then-idle usage
pattern). Two places break that habit today:

1. **C1** — after every Add, the user is dropped back on the grid and must re-open
   the camera. Bulk cataloging is *Add → close → reopen camera* per item.
2. **C2** — a brand-new user must scan before seeing any value, and the Records
   tab requires a Discogs token. The first 10 seconds can stall before the first win.

---

## C1 — Make "Add" continue scanning

### Current behavior (verified in code)

- `CollectionView.handleAddCandidate()` — on success: `setModal(null)`,
  `setScanCandidate(null)`, `showToast(copy.addToast, 'add')`. The result sheet
  closes and the user is back on the grid.
- `CollectionView.handleScanNext()` — `setScanCandidate(null)`, `setModal('scan')`.
  Reaching the scanner again is always a **second tap** (the ghost "Scan next").
- `ScanResult` (bottom actions): ghost **Scan next** (`copy.scanNext`), then a
  primary **Add** (`copy.add` / `copy.addAnyway` / wishlist "Own it"). For an
  already-owned item the primary is **Add anyway** — the *least* useful action.

### Proposed changes

**C1.1 — "Add & scan next" as the primary action (scan-sourced results only).**
Add an `onAddAndScanNext` prop to `ScanResult`. When the candidate came from a
scan (`scanCandidate.source === 'scan'`), the primary button becomes
**Add & scan next**; "Add" demotes to the ghost slot next to "Scan next".
On success the flow runs `add()` and then `handleScanNext()` in sequence so the
camera is already open when the toast fires.

- Manual-add and search-sourced results keep today's plain **Add** (the user is
  not holding a stack to scan).

**C1.2 — Already-owned items: primary is "Scan next".**
When `ownedExact` is set, the user already has this item. Swap the buttons so the
primary is **Scan next** and "Add anyway" becomes the ghost action. Rationale:
the existing duplicate detection is a great guard; it should not also force an
extra tap for the most common outcome (you already own it).

**C1.3 — Keep the camera warm (iOS).**
Today `setModal('scan')` remounts `ScannerModal`, which tears down and re-requests
`getUserMedia`. On iOS Safari this can re-flash the permission prompt and adds
latency between scans. Keep the scanner mounted while the add succeeds and only
toggle visibility, so a "Add & scan next" resumes the same stream instantly.
> **Needs validation on device:** confirm the warm stream (a) doesn't re-prompt,
> (b) doesn't keep the camera LED/drain battery when the result sheet is up.

**C1.4 — Momentum toast (factual, no gamification).**
Track a per-session "added today" count and show the toast as
`copy.addedCount(n)` → *"Added — 3 today"*. Reuse the existing
`track('gamif_item_added', …)` call site to increment the count (it's already
default-off and joinable later). No badges, no XP.

### Copy keys to add

| Key | Kind | Fallback via i18n | EN copy |
| --- | --- | --- | --- |
| `copy.addAndScanNext` | catalog override | `catalog.addAndScanNext` | `Add & scan next` |
| `copy.addedCount` | catalog override (function) | `catalog.addedCount` | `Added — {n} today` |
| (reuse) `copy.scanNext` | exists | `catalog.scanNext` | `Scan next` |
| (reuse) `copy.addAnyway` | exists | `catalog.addAnyway` | `Add anyway` |

Add `catalog.addAndScanNext` / `catalog.addedCount` to **all** locales
(`src/i18n/locales/*.js`), mirroring the existing `catalog.*` block.

### Touchpoints

| File | Change |
| --- | --- |
| `src/components/ScanResult.jsx` | Add `onAddAndScanNext` prop; button swap logic for `ownedExact` and scan-sourced results |
| `src/CollectionView.jsx` | `handleAddCandidate()` branches to `addAndScanNext`; pass `source` to `ScanResult`; session add-count |
| `src/components/ScannerModal.jsx` | Optional keep-mounted mode (C1.3) |
| `src/catalog.js` | New `.copy` keys on both `recordsCatalog` and `booksCatalog` |
| `src/i18n/locales/*.js` | New `catalog.*` defaults |

---

## C2 — Empty-state onboarding

### Current behavior (verified in code)

- `EmptyState` (`kind='empty'`) renders `copy.emptyTitle` / `copy.emptySub` /
  `copy.emptyTagline`, then a primary **Scan** (`copy.emptyBtn`), an optional
  cover-scan ghost, and a manual-add ghost.
- Rendered by `CollectionView` only when `ownedItems.length === 0`; demo visitors
  get no scan/cover/manual buttons (`isDemo`).
- `App.jsx` resets `tab` to `'records'` when a different user signs in — so a
  brand-new member lands on Records, the tab that **requires a Discogs token**.

### Proposed changes

**C2.1 — Route first-run to the token-free path.**
On first sign-in for a member, default the active tab to **Books** when the user
has Books access and no stored items, falling back to Records otherwise. Books
need no token, so the first scan works immediately. If Books is not granted,
keep Records but show the token hint (C2.4).
> Implementation note: `App.jsx` already resets `tab` on user change — change the
> reset target from `'records'` to a "best first tab" computed from the session.

**C2.2 — Three-step "how it works" visual (copy-only).**
Replace the single `emptySub` sentence with three micro-steps, rendered as an
ordered list in `EmptyState`:

- Scan the barcode
- Confirm the match
- Done — it's in your crate/shelf

Copy lives in `catalog.copy.emptySteps` as a 3-item array so each catalog keeps
its own wording (`crate` vs `shelf`). No new component logic beyond mapping the
array.

**C2.3 — "Try a sample" barcode (needs validation).**
A secondary ghost button in the empty state that runs the normal scan-result flow
against a known, hardcoded release/volume so a user sees a full result sheet in
~10 seconds without owning anything.
> **Validation required before build:** a stable Discogs release ID + its real
> EAN barcode, and a known ISBN for books; and a way to prevent the sample from
> being saved to the collection (the existing `isDemo` read-only pattern is the
> model, but it currently applies to demo visitors, not signed-in members).

**C2.4 — Records empty-state token hint.**
When the active catalog is Records and no token is set, show a one-line hint under
the Scan button pointing at Settings: *"Records lookups need a Discogs token —
add yours in Settings."* (Reuses the existing no-token toast flow, but as a
persistent, non-blocking hint so it isn't a modal surprise.)

### Copy keys to add

| Key | Kind | EN copy |
| --- | --- | --- |
| `copy.emptySteps` | catalog override (array of 3) | `['Scan the barcode', 'Confirm the match', "Done — it's in your collection"]` — step 3 uses the generic "collection" noun, not crate/shelf (see the localization addendum: avoids DE/IT gender-agreement) |
| `copy.trySample` | catalog override | `Try a sample` (C2.3) |
| `copy.noTokenHint` | catalog override | `Records lookups need a Discogs token — add yours in Settings.` (C2.4) |

Mirror the `catalog.*` defaults in all locales.

### Touchpoints

| File | Change |
| --- | --- |
| `src/components/EmptyState.jsx` | Render `emptySteps`; optional `trySample` + `noTokenHint` slots |
| `src/CollectionView.jsx` | Pass `emptySteps`/`trySample`/`noTokenHint`; wire sample flow (C2.3) |
| `src/App.jsx` | First-run tab default (C2.1) |
| `src/catalog.js` | New `.copy` keys on both catalogs |
| `src/i18n/locales/*.js` | New `catalog.*` defaults |

---

## Validation flags (blocking)

- **C1.3** warm camera on iOS Safari: no re-permission flash, no battery/LED drain.
- **C2.3** sample barcode: real Discogs release + EAN, real ISBN, and no way to
  accidentally save the sample into the collection.

## Acceptance criteria

- Scanning a stack: each **Add & scan next** returns to an already-open camera in
  one tap; no re-permission flash on iOS.
- Scanning an item you already own shows **Scan next** as primary, **Add anyway**
  as secondary.
- New member with Books access lands on Books; their first scan succeeds with no
  token step.
- All new strings are in `catalog.copy` (both catalogs) + all 7 locales; nothing
  hardcoded in components.

## Out of scope

- Gamification/XP, paywall changes, backend, any email/push (see the lending spec).
