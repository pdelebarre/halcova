# Hokan — Design Redesign Spec

A design-forward, implementation-ready spec for modernizing Hokan's UI/UX
while keeping its record-shop identity. This is the **target design** — the
current app has been reviewed and this document describes the desired end
state. It is a handoff for the Runout Engineer; nothing here is implemented yet.

- [1. Goals & principles](#1-goals--principles)
- [2. Design tokens (changes flagged)](#2-design-tokens-changes-flagged)
- [3. Responsive system](#3-responsive-system)
- [4. Component-by-component spec](#4-component-by-component-spec)
- [5. Toolbar & filter-sheet interaction detail](#5-toolbar--filter-sheet-interaction-detail)
- [6. Motion & haptics](#6-motion--haptics)
- [7. Ergonomics & accessibility checklist](#7-ergonomics--accessibility-checklist)
- [8. Implementation notes & suggested order](#8-implementation-notes--suggested-order)

---

## 1. Goals & principles

The current app has a strong, distinctive identity (warm dark
`sleeve-black` + kraft + `label-red` + `runout-gold`, Fraunces/Inter/IBM Plex
Mono) wrapped in an overly dense, utilitarian shell. The redesign **keeps the
identity and modernizes the chrome**.

Four principles drive every decision:

1. **Covers first** — the artwork is the content. Covers get bigger, images are
   the hero, chrome is secondary.
2. **One hand, no hunting** — everything reachable in the thumb zone, 44px
   targets, at most one filter row on screen at a time.
3. **Small joys, big payoff** — motion and haptics reward the core ritual
   (scan → confirm → add). Every haptic has a visual fallback because
   `navigator.vibrate` is a no-op on iOS/iPadOS.
4. **Scales to 100s–1000s of items** — a collector can own hundreds of
   records or books; browsing, finding, and performance must hold up at that
   size, not just at 20 items (§4.18).

Non-goals: no color-theme change, no copy overhaul, no new top-level pages.
The list view (§4.6) is a new *view* of the existing collection screen, not a
new page.

---

## 2. Design tokens (changes flagged)

Source of truth remains `src/index.css`. Only changes are listed; everything
else keeps its current value.

### Colors

| Token | Current | Proposal | Change |
| --- | --- | --- | --- |
| `--static-grey` | `#8A8377` | `#A49C8E` | ⚠️ brighten — small mono text was ~4.5:1 on dark |
| `--glass` | — | `rgba(33, 29, 24, 0.72)` | ✚ new — scrims / backdrops |
| `--shadow-card` | — | `0 6px 14px rgba(0,0,0,0.35)` | ✚ new — explicit card depth |
| `--shadow-float` | — | `0 10px 24px rgba(0,0,0,0.45)` | ✚ new — FAB / sheets / elevated |

All other colors keep current values (`--sleeve-black #16130F`,
`--vinyl-groove #211D18`, `--vinyl-groove-2 #2B251E`, `--jacket-kraft #EFE6D8`,
`--jacket-kraft-dim #C9BFAF`, `--label-red #B23A2E`,
`--label-red-bright #CE4B3D`, `--runout-gold #C9A227`, `--line #35302A`,
`--danger #C24B3F`, `--success #7A9A6B`).

### Typography scale

Introduce a real scale. **Rule: mono is never smaller than 11–12px.**

| Role | Family / weight | New size | Current |
| --- | --- | --- | --- |
| Screen/empty title | Fraunces 700 | 28 / 24 | 24 / 19 |
| Sheet title | Fraunces 600 | 22 | 20 |
| Detail title | Fraunces 600 | 22 | 20 |
| Card title | Inter 600 | **14** | 12.5 |
| Card meta | Inter 500 | **12.5** | 11 |
| Body / buttons | Inter 600 | 15–16 | 15 |
| Status / meta / labels | IBM Plex Mono | **12 min** | 10–13 |
| Detail meta value | Inter 500 | 14 | 13 |

### Shape & spacing

- Radii unchanged: `--radius-sm 6px`, `--radius-md 10px`, `--radius-lg 16px`.
- Badges stay pill (`999px`); close buttons stay circular but grow to **44px**.
- Cover "sleeve frame": thin 1px inner border + `--shadow-card` so covers read
  as physical objects.
- Rhythm: 8 / 16 / 24 / 32; cards gap ≥16px; sheet padding 20px.

---

## 3. Responsive system

Must run on Apple phones, tablets (iPad), and desktop. Strategy: **one
continuous grid + one shell max-width**, plus a handful of deliberate
breakpoints for *chrome* (never for column counts).

### 3.1 Grid — continuous, no fragile breakpoints

```css
.app-main { width: 100%; max-width: 1280px; margin: 0 auto; padding: 0 16px calc(var(--safe-bottom) + 90px); }

.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 20px 16px;
}
```

Books share the same grid (`BookGrid` already imports `AlbumGrid.css`); give
books a narrower min so spines feel book-like:
`.album-grid--books { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }`

Resulting columns at real Apple widths (computed):

| Device / context | Viewport | Columns | Cover width |
| --- | --- | --- | --- |
| iPhone SE | 375×667 | 2 | ~171px |
| iPhone 12–16 | 390×844 | 2 | ~179px |
| iPhone Pro Max | 430×932 | 2 | ~191px |
| iPhone landscape | 667–932 × ≤430 | 3–4 | ~149–190px |
| iPad mini | 744×1133 | 4–5 | ~154–172px |
| iPad Air | 820×1180 | 5 | ~154px |
| iPad Pro 12.9 portrait | 1024×1366 | 6 | ~153px |
| iPad Air landscape | 1180×820 | 7 | ~161px |
| iPad Pro 12.9 landscape | 1366×1024 | 8 | ~140px |
| Desktop | 1440+ | 8 (capped) | ~140px+ |

### 3.2 Deliberate breakpoints (chrome only)

| Breakpoint | What changes |
| --- | --- |
| `<480` | 2-col grid, compact header, FAB |
| `480–719` | 3–4 cols (larger phones / small tablet landscape) |
| `≥768` (tablet) | Sheets may center vertically; header breathing room; toast widens; targets stay ≥44px |
| `≥1024` | Desktop hover **only** via `@media (hover: hover) and (pointer: fine)` — card lift/tilt, button hovers |
| `(orientation: landscape) and (max-height: 520px)` | Compact detail cover (120px), collapsed empty-state padding, sheet actions stay pinned, toolbar stays one row |

### 3.3 Apple-specific rules

1. **`100dvh`** for the shell (already in place) — handles iOS Safari URL-bar
   collapse. Keep.
2. **Safe areas** — `env(safe-area-inset-*)` already on FAB, sheets, toast;
   iPad contributes ~20px bottom inset. Keep.
3. **Haptics no-op on iOS** — `navigator.vibrate?.()` is guarded; pair every
   haptic with a visual pulse (scan flash, add-pop).
4. **iPad hover double-tap** — all decorative hover (card lift, shadows) must
   live behind `@media (hover:hover) and (pointer:fine)`; the touch path uses
   `:active` only. Never layout-changing `:hover` on touch.
5. **`backdrop-filter`** — add the `-webkit-` prefix alongside unprefixed for
   older iPadOS Safari (header blur, sheet scrim).
6. **Camera-less iPads** — keep the friendly error and add a **Retry**
   affordance in the scanner.
7. **Landscape iPhone** — verify no horizontal scroll, FAB never covers the
   last row, sticky toolbar never traps content.

### 3.4 Sheets & scanner across sizes

- Sheets: `max-width: 560px` (admin 620) centered — already fine on
  iPad/desktop; `max-height: min(84dvh, …)` keeps landscape phones safe.
- Scanner target: `min(78vw, 60dvh, 340px)` so it never clips on short or wide
  viewports.
- Detail cover: `clamp(120px, 30vw, 240px)` — 120 on landscape phone, ~200 on
  portrait, 240 on desktop.

---

## 4. Component-by-component spec

Each component lists **purpose, layout, states, responsive behavior, and a11y**
requirements. Files referenced are the current ones to be updated.

### 4.1 App shell & layout (`src/App.css`)

- `.app-main`: `max-width: 1280px; margin: 0 auto; padding: 0 16px calc(var(--safe-bottom) + 90px);` — centers content on desktop/tablet, keeps FAB clearance on phone.
- Scroll elevation: header and toolbar gain a subtle bottom border + `backdrop-filter: blur(8px)` when scrolled (class toggled by scroll listener).
- Toast: `role="status"` + `aria-live="polite"`, positioned above the FAB (`bottom: calc(var(--safe-bottom) + 84px)`), 2.4s auto-dismiss.

### 4.2 Header (`src/components/Header.jsx` / `Header.css`)

- **Left:** wordmark "Hokan" (Fraunces 24, weight 700). The tagline moves out of the header — it belongs in the empty state, not the chrome.
- **Center:** segmented **Records | Books** pill control, 44px tall, `aria-pressed` per tab; active = `--vinyl-groove-2` + gold underline dot.
- **Right:** one compact cluster: avatar chip (44px, shows initial) → opens a small menu (Settings / Admin if `showAdmin` / Sign out). All icon-btns grow from 38px to **44px**.
- Sticky; blur + border on scroll (see §4.1).
- Responsive: on `<480` the wordmark shrinks to 22px; on `≥1024` the cluster can show a "Sign out" ghost button in addition to the avatar.

### 4.3 Toolbar & search (`src/components/Toolbar.jsx` / `Toolbar.css`)

Collapses to **one row** (currently up to three):

- **Search:** 44px-tall pill input with a magnifier icon (left), inline **✕ clear** button (right, only when there's text), and the result-count badge inside the field. `aria-label="Search collection"`.
- **Filter button:** pill button, 44px, with a badge showing the number of active filters (e.g. `3`). Opens the filter sheet (§5). `aria-haspopup="dialog"`.
- **Sort control:** chevron button (44px) showing the current sort; opens the sort menu (§4.5).
- **View toggle:** a two-state **Grid | List** segmented control (44px, `aria-pressed`) — see §4.6. Essential for large collections: covers are for *browsing*, the list is for *finding*.
- Format/genre/artist chips **move out of the toolbar** into the filter sheet — the toolbar is search + filter + sort + view only.
- Responsive: one row on all sizes; on `<480` the count badge hides behind the clear button if both fit poorly (keep count, drop inline label).

### 4.4 Filter sheet

See §5 for the full interaction detail. Summary: a bottom sheet listing Format (if any), Genre/Category, and Artist (author) sections with 40px+ chips; "Reset" and "Done" actions pinned at the bottom.

### 4.5 Sort menu

- Opens as a small popover (desktop) / bottom sheet (mobile) with radio options: Recently added, Artist A–Z, Year, Format, Title (per-catalog list from `catalog.sortOptions`).
- Selected option shows a gold check; tap applies and closes.
- `role="menu"` / `role="menuitemradio"`, arrow-key navigation.

### 4.6 Grid, list & cards (`AlbumCard.jsx`, `BookCard.jsx`, `AlbumGrid.css`)

Two views, user-toggled and remembered per kind (`localStorage`): **Grid** (the
identity/browse view) and **List** (the find-at-scale view). For a collector
with hundreds of items, grid-only browsing is unusable.

**Grid view**

- `repeat(auto-fill, minmax(140px, 1fr))` records / `minmax(120px, 1fr)` books; gap `20px 16px`; inside the 1280px shell (§3.1).
- **Card (records):** square sleeve with a thin 1px frame + `--shadow-card`; a subtle vinyl under-edge visible at the bottom (evolved from today's `record-peek`, now always-visible rather than only on `:active`). Title 14 / artist 12.5, one line each, ellipsis. Press: cover lifts −4px + tilts 2° (`:active`). Desktop hover (`(hover:hover) and (pointer:fine)`): lift + shadow deepen.
- **Card (books):** 2:3 spine with the existing spine-shadow motif; same text spec.
- Performance at scale: `loading="lazy"` (keep) + `content-visibility: auto` + `contain-intrinsic-size` on cards so 1000+ covers don't jank.

**List view**

- Dense rows (~56px): small cover 40px, then title (Inter 14) / artist · label · catno · year (Inter 12.5, mono for catno) and a format badge; chevron on the right. Row is a single button.
- **Virtualized** (windowed) — render only visible rows (react-window or equivalent); fixed row height keeps windowing cheap and keyboard scrolling stable.
- Optional **grouping** for Artist A–Z: sticky group headers per letter/artist and a letter **jump rail** on tablet/desktop (A–Z index on the side, like a contacts app). Tap a letter to scroll the group into view.
- A11y: rows are buttons (`aria-label` from title/artist); grid uses `role="grid"`/`gridcell`, list uses a flat list; both keep gold `:focus-visible`; `aria-pressed` on the Grid/List toggle; announce "Showing N of M" when filters change.

### 4.7 Empty state (`EmptyState.jsx` / `EmptyState.css`)

- Keep the spinning disc (records) / hardback (books), slightly larger (96px).
- Title (Fraunces 24) + sub (keep existing copy), then **two actions**: primary "Scan a record/book" + ghost **"Add by title"** — manual entry becomes discoverable here, not only behind the camera.
- A 3-step hint row (Scan → Confirm → Enjoy) as small mono text with gold separators.
- Responsive: `padding: clamp(24px, 14vh, 120px) 32px 40px` so it doesn't overflow on short landscape.

### 4.8 FAB & add menu (`src/App.css` `.fab`)

- FAB stays bottom-right (56px, `safe-bottom + 20px`), label "Scan".
- A light press expands a **3-option menu** above it: **Scan barcode · Search by title · Enter manually** (44px rows, icons + labels). Tapping outside closes.
- Purpose: manual-add and search-by-title become first-class paths instead of scanner dead-ends.
- A11y: FAB `aria-haspopup="menu"`; menu items are buttons; Esc closes; focus returns to the FAB.

### 4.9 Scanner (`ScannerModal.jsx` / `ScannerModal.css`)

- Full-bleed camera; rounded "window" target (gold corners + scanline — keep) with a soft vignette around it so the barcode pops.
- Target size: `min(78vw, 60dvh, 340px)`.
- Status pill (keep, mono 13) with a small animated icon.
- **Torch toggle** button (top-right, next to ✕) — `ImageCapture`/`track.applyConstraints` where available; hide if unsupported.
- On decode: success pulse (gold/green ring flash) + `navigator.vibrate?.(60)` (visual-only on iOS).
- On error: friendly message + a **Retry** button (new), plus the existing "Enter details manually instead" fallback.
- Keep ✕ close (44px), safe-area aware.

### 4.10 Scan result sheet (`ScanResult.jsx` / `ScanResult.css`)

- Cover grows to **96px**; title (Fraunces 17–18) / artist / sub to the right.
- **Ownership banner** (good / owned / caution) kept as a card: color + icon + label + sub-text (never color-only). Same three tones and copy.
- Actions: primary full-width **"Add to crate"** (or "Add to shelf"); secondary **"Scan next"**; when owned, ghost **"Add anyway"** + "View" link.
- On add: the button briefly swaps to a **spinning disc + "Added"** state (~0.8s) before the toast fires; `navigator.vibrate?.(30)` with a visual pulse.
- Related pressings/editions list: keep rows, raise text to 13/11.5, and **cap at 5 rows + "and N more"** — with hundreds of items, "other pressings you own" can otherwise overflow the sheet.

### 4.11 Match picker (`MatchPicker.jsx` / `MatchPicker.css`)

- Keep the flow ("Is this it?"), sheet layout, loading/error/no-match states.
- Match rows: cover 56px, title 14 / meta 12.5, ≥48px rows, `:active` press + focus-visible gold.
- Buttons: "Search by title" and manual entry remain reachable from the sheet footer.

### 4.12 Manual add sheet (`ManualAddModal.jsx`, `BookManualAddModal.jsx`, `ManualAddModal.css`)

- Keep visible labels and the two-column row (year/format). Inputs stay 44px+ tall.
- Add inline validation: title `required` shows a `danger` message wired with `aria-describedby`, clearing on next keystroke (don't rely on native browser chrome alone).
- Actions pinned at the bottom of the sheet.

### 4.13 Detail sheet (`AlbumDetail.jsx`, `BookDetail.jsx`, `AlbumDetail.css`)

- Cover `clamp(120px, 30vw, 240px)`, centered, with a "sleeve out of jacket" shadow (`--shadow-float`).
- Title (Fraunces 22) / artist (Inter 14) centered; **meta card** (2-col grid, keep) with mono 12 labels + Inter 14 values.
- **Notes:** styled textarea + explicit **"Save"** button (no silent save-on-blur). Save shows a brief confirm state.
- Tracklist (records): keep, mono 12 positions/times.
- Actions pinned at the bottom: **"View on Discogs/Google Books ↗"** (button) and **"Remove from crate"** (danger) → confirm step.
- Responsive: in landscape/short viewports the cover shrinks to 120px and the whole sheet scrolls while actions stay pinned.

### 4.14 Auth screen (`AuthScreen.jsx` / `AuthScreen.css`)

- Keep the big Fraunces wordmark (52px) + tagline; anchor it with the spinning disc as a visual.
- Code field: mono, uppercase, 44px+, `autoCapitalize="characters"`, `autoCorrect="off"`, `spellCheck={false}` (keep), plus a subtle "Paste" hint.
- Error state in `--danger` next to the field; busy state "Requesting…"/"Signing in…" (keep).
- "← Back" affordance retained.

### 4.15 Settings (`SettingsModal.jsx` / `SettingsModal.css`)

- Sheet language: section headers (mono 12 uppercase), rows as cards ≥48px.
- Discogs token input: keep mono; add a visibility toggle (eye) and "saved" confirmation state.
- Help text stays; books help becomes a card (keep).

### 4.16 Admin panel (`AdminPanel.jsx` / `AdminPanel.css`)

- Same sheet language; rows ≥48px; **switch** components for plan toggles instead of chip toggles.
- Access-code display kept as a copyable gold box (`user-select: all` + a copy button).
- Disabled rows keep `opacity` but add a `--static-grey` label so it's not opacity-only.

### 4.17 Toast & feedback (`src/App.css`)

- Pill toast above the FAB with a small leading icon (✓ add / – remove), `role="status"` + `aria-live="polite"`, 2.4s.
- Error toasts use `--danger` tint + icon; keep the copy ("Could not save — check your connection" etc.).
- Failure rollback (optimistic `useCollection`) already toasts; ensure it's not silent.

### 4.18 Scaling to large collections (100s–1000s of items)

Summary of the scale requirements the rest of this spec assumes. A collector
can own hundreds of records or books; the design must hold at that size.

- **Two views (Grid / List)** — §4.6. Grid = browse/identity; List = find.
  Default to Grid; remember the choice per kind.
- **Search is the primary path at scale** — it already matches title, label,
  catno, and genre; it must feel instant on 1000s of items (client-side
  filter over the in-memory list is fine; debounce ~150ms).
- **Filters must scale** — artist filter is a searchable combobox (§5.2),
  never a flat select; genre stays chips (bounded set).
- **Grouped browsing** — Artist A–Z with sticky headers + jump rail in List
  view (§4.6) mirrors a real record store.
- **Performance** — grid: lazy images + `content-visibility: auto`; list:
  virtualized rows; both avoid layout shift (reserved aspect ratio).
- **Cap noisy sections** — related pressings/editions in the scan-result sheet
  capped at 5 + "and N more" (§4.10).
- **Initial load** — thousands of blob keys can't mean a blank screen: show a
  skeleton grid immediately and hydrate progressively (this couples to the
  backend read strategy — see the whole-stack architect for pagination/
  caching if load becomes the bottleneck).
- **Counts** — format large numbers ("1,234") and never clip the toolbar count
  badge.

---

## 5. Toolbar & filter-sheet interaction detail

### 5.1 Toolbar states

| State | Behavior |
| --- | --- |
| Default | Search pill (empty) + "Filter" (badge `0`, dim) + sort chevron showing current sort |
| Typing | Search shows ✕ clear; count badge updates live; results grid updates as you type |
| Filters active | "Filter" badge shows count (e.g. `2`), gold tint; a subtle "Clear all" appears in the sheet only |
| No results | Grid area shows the existing "Nothing matches" empty state with a "Clear filters" action |

### 5.2 Filter sheet structure

A bottom sheet (`role="dialog" aria-modal="true" aria-label="Filters"`) with:

1. **Header:** title "Filters" + ✕ close (44px).
2. **Scrollable body:**
   - **Format** (records only): chips LP / EP / CD / 7" / 12" — 40px tall, multi-select; active = gold border + `rgba(201,162,39,0.1)` bg (existing `.chip.active` pattern, just larger). Fixed small set — always chips.
   - **Genre / Category**: multi-select chips (derived). If a collection ever exceeds ~30 distinct genres, this section scrolls internally with its own sticky header (chips stay, no nested scroll traps).
   - **Artist / Author**: **a searchable combobox** (type-ahead over the artist list) — **hard requirement at scale**: a flat select with 300+ artists is unusable. Shows "All artists" default, selected artist as a removable chip; `role="combobox"` + `aria-expanded`, arrow-key navigation.
3. **Footer (pinned):** ghost "Reset" + primary "Done". "Reset" only appears when filters are active.

### 5.3 Behavior & a11y

- Opening: focus moves into the sheet (first chip or close button). Closing: focus returns to the **Filter** button.
- Esc closes (desktop); iOS swipe-down / Android back closes (bottom-sheet pattern already in place).
- Selections apply **immediately** to the grid (the sheet is a live filter panel, not a draft-then-apply dialog) — "Done" just closes. This matches the current instant-chip behavior and avoids a confusing second step.
- Chips: `aria-pressed`; active chips announce state change via `aria-live="polite"` on the count.
- All targets ≥44px; `:focus-visible` gold outline on every chip/button.

---

## 6. Motion & haptics

All gated behind `prefers-reduced-motion` (already honored — do not regress).

| Moment | Motion | Duration / easing |
| --- | --- | --- |
| Sheet open | rise + soft fade | 0.22s `cubic-bezier(0.2,0.7,0.3,1)` (keep) |
| Card press | cover lifts −4px + tilt 2° | 0.22s ease |
| Card hover (fine-pointer) | lift + shadow deepen | 0.22s ease |
| Add success | button → spinning disc → toast | ~0.8s |
| Scan decode | gold/green pulse ring | 0.3s |
| Toast in/out | slide + fade | 0.2s (keep) |
| Tab switch | scale on active pill | 0.15s |
| Empty disc | slow spin (keep) | 9s linear |

Haptics: scan-hit 60ms, add 30ms, remove 40ms — each paired with a visual
pulse because `navigator.vibrate` is a no-op on iOS/iPadOS.

---

## 7. Ergonomics & accessibility checklist

Every interactive target ≥ **44px** (header icons, tabs, chips 40+, search,
sheet close, FAB 56, match/related rows). Gold `:focus-visible` outline on
**every** control. Toasts `role="status"`; form errors `aria-describedby`
clearing on next attempt. Sheets move focus in on open / back to trigger on
close. Decorative icons `aria-hidden`; covers `alt=""` decorative / meaningful
`alt` on detail. No color-only meaning (banners have label+icon+text). Mono
never below 11–12px; `--static-grey` brightened for contrast. Reduce-motion and
safe-areas preserved.

---

## 8. Implementation notes & suggested order

Token/type changes are centralized in `src/index.css` (+ `styles/shared.css`).
Suggested build order (each step shippable independently):

1. **Tokens + type scale** (colors, `--glass`, shadows, font sizes).
2. **Shell + grid**: `max-width: 1280px` container, `auto-fill` grid, breakpoints, desktop hover guard.
3. **Header** consolidation (44px targets, tab control, avatar menu).
4. **Toolbar** → one row + **filter sheet** + sort menu (§5).
5. **Grid/List views** — view toggle, list rows, virtualization, grouped
   Artist A–Z + jump rail, grid `content-visibility` (§4.6, §4.18).
6. **FAB menu** + empty-state "Add by title" (manual entry discoverability).
7. **Scanner** polish (target/vignette, torch, retry, decode pulse).
8. **Result + detail sheets** (bigger covers, add-pop, notes Save, Remove
   confirm, related-list cap).
9. **Auth/Settings/Admin** restyle + toast `aria-live` pass.

Verify on: iPhone SE (375×667), iPhone 12–16 (390–430), iPhone landscape, iPad
mini/Air/Pro portrait + landscape, and desktop 1440+. Use the §3.1 matrix as
the acceptance grid. **Scale check:** load a seeded collection of ~800 items
and confirm grid scrolling stays smooth, list virtualization shows no blank
rows, and the artist filter type-ahead is instant.
