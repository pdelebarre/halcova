## Design Components — Compact Spec

Purpose: concise, developer-focused component sizing, spacing tokens, and accessibility notes for Header, Toolbar (collapsed), Cards, Empty State, and Scanner overlay. Use existing design tokens in `src/index.css` and `src/styles/shared.css` where possible.

---

**Global spacing tokens (new CSS variables recommended)**
- `--space-1`: 8px  (small gaps, icon spacing)
- `--space-2`: 12px (tight padding)
- `--space-3`: 16px (component padding)
- `--space-4`: 18px (sheet / existing large padding)
- `--space-5`: 24px (card gutters / large gaps)
- `--gap-grid`: 12px (grid gap for Album/Book grids)

Map to existing tokens where appropriate: use `--radius-md`, `--radius-lg`, `--label-red`, `--jacket-kraft-dim`, `--runout-gold`, `--line` from `src/index.css`.

---

**1) Header component**
- Height: 56px on phone, 72px on tablet/desktop.
- Padding: `padding-left/right: var(--space-3)` (16px) mobile, `var(--space-5)` (24px) desktop.
- Logo / brand: max height 32px (phone), 40px (desktop). Preserve ~12px left gap to edge.
- Search input (if present): height 40px, border-radius: `var(--radius-md)`, padding `8px 12px`, background `var(--vinyl-groove)` with `border: 1px solid var(--line)`.
- Actions (right side): icon buttons sized 40×40px, hit target 44×44px (use padding to reach hit target). Gap between actions: `--space-1` (8px).
- Avatar: 36×36px (circle) on phone, 40×40px on desktop. Align center vertically.

Accessibility
- Header landmark: `<header role="banner">`.
- Focus order: Logo (optional link) → Primary nav / search → Toolbar actions → Avatar. Ensure `tabindex` follows this flow.
- All action icons must have accessible labels (`aria-label`) and keyboard focus visible (use `:focus-visible`).

---

**2) Toolbar — collapsed one-row layout**
- Layout: single horizontal row, fixed height 52px (mobile) / 64px (desktop), left-to-right flow: Primary actions (left), flexible spacer, filter + sort group (right).
- Padding: `0 var(--space-3)` (0 16px).
- Buttons: compact icon + label hidden in collapsed state — show only icon (24px visual). Button container: 44×44px. Gap between buttons: 8px.
- Filter button behavior:
  - Closed: shows funnel icon, badge count (optional) as small circle at top-right of icon (10×10px, background `--label-red`).
  - Tap/Enter: opens a modal sheet (reuse `.sheet` styles) or an anchored popover at toolbar level (prefer sheet on phone, popover on tablet/desktop).
  - When filter sheet is open, the filter button has `aria-expanded="true"` and client focus moves into the sheet's first focusable control.
  - When closed, button `aria-expanded="false"` and returns focus to the filter button.

Accessibility
- Toolbar: `<div role="toolbar" aria-label="Collection actions">`.
- Keyboard: Left/Right arrow navigate between toolbar items; Enter/Space activate.
- Filters in popover/sheet: include `role="dialog" aria-modal="true" aria-label="Filter items"` and trap focus while open.

---

**3) Card (record / book) sizes & spacing**
- Grid gaps: `--gap-grid` = 12px.
- Mobile (phone, single column feed or 2-column grid):
  - 2-col grid: card width = calc((100% - gap) / 2) — target artwork display 148×148px.
  - Card padding: `var(--space-2)` (12px). Card radius: `--radius-md`.
- Tablet (3-col grid): artwork 160×160px; card width ~ (container minus gaps)/3.
- Desktop (4-col grid): artwork 180×180px; card width ~ container/4 minus gaps.
- Card inner layout:
  - Artwork: square at top (see sizes above), object-fit: cover, background `#111`.
  - Title row: font-size 14px, weight 600, color `--jacket-kraft`.
  - Subtitle (artist/author + year): font-size 12px, color `--jacket-kraft-dim`.
  - Action area: horizontal, two icons (more / add) sized 20px with 8px spacing.

Accessibility
- Cards are `<article>` with `tabindex="0"` and `role="link"` if clickable. Provide `aria-label="{Artist} — {Title}, {Year}"`.
- Keyboard: Enter opens detail; Space can toggle quick actions where implemented.

---

**4) Empty state — variant with two CTA buttons**
- Layout: centered stack.
  - Illustration: max-width 220px, margin-bottom `var(--space-3)` (16px).
  - Heading: font-size 18px, margin-bottom 8px.
  - Body text: font-size 14px, color `--jacket-kraft-dim`, margin-bottom 16px.
  - CTA row: two buttons side-by-side on desktop, stacked on narrow screens.
    - Primary CTA: `.btn-primary` (use existing class), width: auto, min-width: 140px.
    - Secondary CTA: `.btn-ghost`, min-width: 140px, margin-left: 10px (or top-margin when stacked).

Behavior
- Primary CTA: `Add by scan` — opens scanner modal.
- Secondary CTA: `Add manually` — opens ManualAdd modal.

Accessibility
- The CTA group should be a toolbar-like region with clear focus order: Primary → Secondary.
- Provide `aria-describedby` on the primary button referencing the body copy id for context (useful for screen readers).

---

**5) Scanner overlay target & torch placement**
- Target frame (visual scanning area):
  - Phone: square occupying 64% of viewport width, centered vertically slightly above center (translateY: -6% of vh) to allow controls below.
  - Tablet: square occupying 56% of viewport width.
  - Desktop: square occupying 44% of viewport width, max 640px.
  - Styling: 2px semi-transparent stroke `rgba(255,255,255,0.12)` and rounded corners `--radius-md`. Inner subtle crosshair lines at 50% offsets (1px, `--runout-gold` at 12% opacity on active scan).

- Torch button:
  - Size: 48×48px visible control, hit target 56×56px.
  - Placement: bottom-right inside safe area, offset `calc(var(--safe-bottom) + 14px)` up from bottom and `16px` from right on phone. For tablet/desktop place at bottom-center (under scanner) when a portrait layout is wide.
  - Styling: circular background `var(--vinyl-groove-2)`, icon color `--jacket-kraft`, border `1px solid var(--line)`.
  - Behavior: toggle button with `aria-pressed="true|false"` and `aria-label="Toggle torch"`.

Accessibility
- Scanner modal: `role="dialog" aria-modal="true" aria-label="Scan barcode"`.
- When scanner opens, focus moves to the scanner close button (or first control) and keyboard users can close with `Esc`.
- Torch must be reachable by keyboard (Tab) and have visible focus ring using `:focus-visible`.

---

Visual mock descriptions (Figma-agnostic)
- Phone — Home / Collection (single row header + grid):
  - Header 56px with logo left, search collapsed centered, avatar on right. Toolbar pinned below header (52px) with compact icon buttons. Grid 2 columns; cards show 148px artwork with tight 12px gutters. Scanner target fills most of width when opened with torch bottom-right.
- Tablet — Collection browse:
  - Header 72px with full search visible. Toolbar same row as header actions. Grid 3 columns; artwork 160px. Filter opens as anchored popover beside toolbar rather than full sheet.
- Desktop — Wide gallery:
  - Header 72px with logo, full-width search, actions on the right. Toolbar condensed into right-aligned action cluster. Grid 4 columns; artwork 180px. Empty state shows two CTAs side-by-side centered in a wider container.

Notes / Implementation tips
- Reuse existing `.sheet` for modal/sheet behavior. Prefer sheet on small viewports and anchored popover for larger viewports.
- Introduce the `--space-*` variables in `src/index.css` and use them across components for consistent spacing.
- Keep all interactive icons with `aria-label` and ensure `:focus-visible` styles are prominent (existing gold outline is acceptable).
- Do not change the shared item shape or catalog flow — these specs affect view/layout only.

If you'd like, I can also produce small CSS snippets for each component to drop into their existing CSS files.
