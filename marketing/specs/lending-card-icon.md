# Spec — On-loan card icon that opens the lend card (A5.6)

- **Status:** Refined for implementation (UI/UX-reviewed), part of epic **#84**
- **Owner:** Marketing Manager (handoff to Front End Developer; UI/UX Expert for review)
- **Suggested branch:** `feat/lending-polish`
- **Scope:** frontend-only, no backend change. All copy via `catalog.copy.lending` + i18n.

---

## The ask (verbatim from product)

> When an item is on loan, instead of adding "on loan" on top, put a clickable
> icon directing to the lend card.

## Current state (verified in code)

- Grid cards (`src/components/AlbumCard.jsx`, `BookCard.jsx`) and list rows
  (`src/components/ListView.jsx`) render a **text badge** — `On loan` /
  `Overdue` — when `lendingEnabled && item.lending`:
  - Grid: `.lending-badge` — `position:absolute; top:8px; left:8px` pill over the cover.
  - List: `.list-lending-badge` — inline pill next to the format badge.
- Overdue is computed client-side by `isOverdue` / `toLocalDate`
  (`src/utils/lending.js`); both card types optional-chain `item?.lending` and
  rely on `isOverdue`'s NaN guard (dark-screen safety — no error boundary).
- Every card is a **`<button>`** whose whole surface calls `onOpen(item)` →
  `CollectionView.openItem` → detail sheet (`setModal('detail')`).
- The **lend card** = the `LendingControls` section inside the detail sheets
  (`AlbumDetail` / `BookDetail`): borrower, due date, "Mark returned", and —
  after #90 — Remind / Call / Email actions. It is rendered at the bottom of
  `.detail-scroll`, after notes.
- Existing tests assert the text badge: `src/__tests__/grid-lending-badge.test.jsx`,
  `list-lending-badge.test.jsx` (`.lending-badge`, `.list-lending-badge`).

## A5.6 — The enhancement, refined

When an item is on loan, replace the text badge on grid cards **and** list rows
with a compact, **clickable loan icon**. Tapping the icon opens the item's
**lend card** — the detail sheet scrolled to and focused on the `LendingControls`
section — so the borrower, due date, and return (plus the #90 contact/Remind
actions) are one tap away. Tapping anywhere else on the card still opens the full
detail sheet, exactly as today.

### UI/UX-refined requirements

1. **Deep-link to the lend card.** `onOpen(item)` gains a hint
   (e.g. `onOpen(item, { focus: 'lending' })`). The detail sheet accepts a
   `focusSection` / `initialFocus` prop, keeps a ref on the `LendingControls`
   wrapper, and on open scrolls `.detail-scroll` to it and moves focus there.
   When lending is disabled/gated, the item is a wishlist want, or the section
   isn't present, the icon falls back to a normal detail open (or is hidden).
2. **No nested buttons (a11y, invalid HTML).** Cards are `<button>`s; the icon
   must **not** nest interactive content inside the button. Two acceptable
   patterns (implementer's choice):
   - split the card into sibling tap targets — cover area (its own `<button>`
     containing the icon) and info area (opens the full detail), **or**
   - keep a single card button and render the icon as a non-button element with
     `role="button"`, `tabIndex={0}`, Enter/Space activation, an `aria-label`,
     and `e.stopPropagation()` / `e.preventDefault()` so it never double-fires.
   Button-in-button is explicitly banned.
3. **Overdue stays visible.** The icon keeps an overdue affordance (danger color
   / accent dot) so removing the "Overdue" text does not hide urgency. The
   icon's `aria-label` reads "Overdue" for overdue loans.
4. **Touch target.** Hit area ≥ 44px (compact ~20–24px glyph), positioned
   top-left over the cover where the badge sits today, `z-index` above the
   cover, clear of the card's primary tap.
5. **Keyboard + screen reader.** Icon reachable by Tab; Enter/Space activates;
   label via `catalog.copy.lending` (`lending.manageLoan*`); focus moves into
   the sheet on deep-link (existing close-ref pattern).
6. **Dark-screen safety.** Keep `item?.lending` optional-chaining and the
   `isOverdue` NaN guard; null-check the lending-section ref and the scroll
   target before touching `.scrollTo`.
7. **List-view parity.** Apply the same icon treatment to `.list-lending-badge`
   (inline, next to the format badge). If the 56px row can't hold a 44px hit
   target without breaking layout, defer list to a follow-up and flag it — grid
   is the primary surface.

### Out of scope (follow-ups)

- Changing the lend card itself, the LoansDashboard, or #90/#92 behavior.
- Any backend change; lending stays premium-gated.

### Copy keys to add (A5.6)

| Key | EN master copy |
| --- | --- |
| `lending.manageLoan` (fn) | `On loan to {name} — manage` (aria-label) |
| `lending.manageLoanOverdue` (fn) | `Overdue — on loan to {name} — manage` (aria-label) |

`lending.badge` / `lending.badgeOverdue` are kept as tooltip / fallback text.
Keys go in `src/i18n/locales/*.js` under §15 Lending (all 8 files: en, en-GB,
de, es, fr, it, nl, pt-BR) and are bridged through `catalog.copy.lending` on
both catalogs in `src/catalog.js`. Follow the localization-dictionary
conventions; no `{collectionLabel}` interpolation bug (see #94).

### Touchpoints

| File | Change |
| --- | --- |
| `src/components/AlbumCard.jsx` / `BookCard.jsx` | Text badge → clickable loan icon; `onOpen` focus hint |
| `src/components/ListView.jsx` | Inline pill → loan icon (or defer, flagged) |
| `src/CollectionView.jsx` | `openItem` passes `{ focus: 'lending' }`; thread prop to detail sheets |
| `src/components/AlbumDetail.jsx` / `BookDetail.jsx` | Accept focus hint; ref + scroll/focus to lending section |
| `src/components/LendingControls.jsx` | Expose ref/anchor for deep-link (wrapper div) |
| `src/components/AlbumCard.css` / `BookCard.css` / `ListView.css` | `.lending-badge` → `.loan-icon` (touch target, overdue variant) |
| `src/catalog.js` | `copy.lending.manageLoan*` on both catalogs |
| `src/i18n/locales/*.js` | New `lending.manageLoan*` keys |
| `src/__tests__/grid-lending-badge.test.jsx` / `list-lending-badge.test.jsx` | Assert icon + deep-link instead of text badge |

### Validation flags

- Overdue visibility on the icon (req 3) must survive the ergonomics review on a
  phone viewport before merge — it's the reason the badge text existed.
- Nested-button ban (req 2) is a hard a11y requirement; verify with a screen
  reader + keyboard walk of the card.
