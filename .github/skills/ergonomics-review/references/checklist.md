# Runout Ergonomics Checklist

Grounded in the real app (theme colors from `src/index.css`, shared styles from
`src/styles/shared.css`, app shell from `src/App.css`, components under
`src/components/`). For each probe, verify in the **integrated browser at a
phone viewport (~375×667) AND desktop** unless noted. Record only findings that
fail the probe — the "already handled" items live in `SKILL.md`.

## 1. Touch & reach (mobile)
- **Primary action reach**: the FAB (`.fab`, bottom-right, above `safe-bottom`)
  is the thumb-zone primary. Confirm it never overlaps content/cards when
  scrolled, and that its label + icon stay readable at `14.5px`.
- **Tap targets ≥44px** (Apple HIG / WCAG 2.5.5): check `.icon-btn` (20px svg —
  what's the button's real height?), `.sheet-close` (32px circle), `.chip`,
  `.tab`, `.match-row`, `.related-row`, `.format-badge`. Note any control with
  effective hit area under ~44px and its spacing from neighbors (mis-taps).
- **Press feedback**: `.btn`/`.fab` have `:active` scale ✓. Do chips, tabs,
  `.match-row`, and `.related-row` give any press feedback?
- **Sheet actions reachable**: `.sheet-actions .btn { flex: 1 }` pins actions at
  the thumb. On short screens (`max-height: 84dvh`) confirm actions stay
  visible without scrolling, and the inner list is the thing that scrolls.

## 2. Layout & scrolling
- **Sticky toolbar** (`Toolbar.css`): does the search input stay usable while a
  long grid scrolls, and does it overlap cards when stuck? Is the count
  (`toolbar-count`) legible and not clipped?
- **Fixed header + FAB clearance**: `.app-main` has `padding-bottom: safe+90px`
  — verify the last row of cards isn't hidden behind the FAB and the header
  never covers content.
- **Grid breakpoints** (`AlbumGrid.css` 480/720): covers per row on a phone,
  on a landscape phone, and desktop. Do covers keep a sane aspect and does the
  grid avoid huge gaps on wide desktop?
- **Long titles/artists**: check truncation/ellipsis vs wrap in `AlbumCard`,
  `.match-info`, `.related-info` (they set `min-width: 0`). Any overflow,
  clipped text, or overlap with the meta line?
- **Sheet scrolling**: `.sheet` is `overflow: hidden` with an inner scroll
  region. Confirm a long match list / related list scrolls while the
  `.sheet-header` and `.sheet-actions` stay put.

## 3. Readability & contrast (dark `#16130F` theme)
- **Small mono text**: `13px` `.sheet-status`/`.status-line`, `13.5px` toast,
  `10px` `.format-badge` — legible? Is any *essential* info only in these
  sizes?
- **Dim text on dark**: `--jacket-kraft-dim #C9BFAF` and `--static-grey
  #8A8377` against `#16130F`/`#211D18` — check contrast for placeholder text,
  meta lines, and the `AlbumDetail` 44px `static-grey` element.
- **Primary button**: `.btn-primary` = `--label-red #B23A2E` bg with
  `--jacket-kraft` text — WCAG contrast on hover (`--label-red-bright`)? Same
  for `.btn-danger` (red text on dark) and `.chip.active`.
- **Ownership banner tones** (`ScanResult` good/owned/caution): verify the tone
  isn't communicated by color alone (labels/sub text present ✓) and the banner
  bg/text contrast holds for all three tones.
- **Hierarchy**: display font (`Fraunces`) headings vs `Inter` body — is the
  visual hierarchy clear at a glance in cards, match rows, and detail sheets?

## 4. Feedback & states
- **Toast**: how long does it show, does it overlap the FAB, and is it
  announced to screen readers (`role="status"`/`aria-live`)? Auto-dismiss
  timing consistent across add/remove?
- **Optimistic updates** (`useCollection`): on a failed `update`/`remove`
  (rollback), does the user actually see why — an error toast/message, not
  silent revert?
- **Busy/disabled**: auth buttons disable + relabel ("Signing in…") ✓. Check
  collection add, scan, and admin actions have equivalent busy protection
  (double-submit).
- **Actionable errors**: are error strings actionable (SERVER_NO_TOKEN → "the
  owner needs to add a Discogs token"; camera denied → "allow camera in
  Settings"; 403 plan → "your plan doesn't include X")? Is the message near
  the control that caused it?
- **State coverage**: loading (`.status-line`), empty (`EmptyState`), and
  no-results are distinct and each has a next step (CTA button / manual add).

## 5. Forms & input
- **Labels**: `ManualAddModal`/`AuthScreen` wrap `<label><span>…</span>
  <input/></label>` (visible labels ✓). Ensure no required field relies on
  placeholder-only hints.
- **Code entry**: `AuthScreen` sets `autoCapitalize="characters"`,
  `autoCorrect="off"`, `spellCheck={false}` ✓. Does the field accept pasted /
  lowercased / dash-less codes, and is the "wrong code" error clear?
- **Validation**: `required` on manual-add title — is there inline error text,
  or only native browser chrome (which iOS shows oddly)? Year uses
  `inputMode="numeric"` ✓.
- **Selects on iOS**: `sort-select`/format/artist `<select>`s use the native
  wheel — confirm options are few enough to be sane and labels (`aria-label`)
  are present.
- **Error proximity**: form errors appear next to the offending field and
  clear on the next attempt.

## 6. Scanner UX
- **Guidance + permission**: statusMsg flows "Starting camera…" → "Aim at the
  barcode" ✓; camera-denied and not-supported errors are friendly and tell the
  user what to do. Is there a **retry** affordance after an error, or must the
  user close and reopen?
- **Aiming aid**: is there a visible target/scanline (`scanner-target`) showing
  where to hold the code, and does it help on a busy sleeve/cover?
- **Decode feedback**: vibration (60ms) + auto-advance to the result ✓. Is the
  "Scan next" path obvious from the result sheet?
- **Framing**: the video fills the overlay — on tall phones does the barcode
  area sit in-frame, and is the canvas/preview aspect right (letterboxing)?
- **No torch/flash toggle**: acceptable for 1D retail codes, but note it as
  MAJOR/MINOR depending on real-world failure rate you observe.

## 7. Navigation & wayfinding
- **Back affordances**: every sheet has explicit back/close
  (`MatchPicker` "Search by title", `ManualAddModal` "Back to search",
  `AuthScreen` "← Back", scanners `✕`). Are any sheets close-only with no
  back path to the previous step?
- **Installed-PWA back gap**: `display: standalone` removes browser chrome —
  confirm **Esc closes sheets on desktop**, and on a phone the iOS swipe-down /
  Android back gesture either works or there's always an on-screen close.
- **Focus on open/close**: when a sheet opens, does focus move into it, and
  does it return to the trigger (e.g., the FAB) on close? `aria-modal` alone
  doesn't trap focus.
- **External links** (`detailLink` → Discogs/Google Books): open in a new tab
  with `rel="noopener"`, and does leaving the app feel abrupt? Is there an
  in-app detail fallback?

## 8. Accessibility
- **Keyboard**: full tab order through header → toolbar → grid → sheets; no
  invisible tab stops; Esc closes sheets (see #7).
- **Screen reader**: toasts/status updates need `aria-live`/`role="status"`;
  form errors wired with `aria-describedby`; decorative icons `aria-hidden`;
  images `alt=""` where decorative (match/related covers ✓) and meaningful
  `alt` for detail covers.
- **Focus visibility**: `:focus-visible` gold ✓ — confirm every interactive
  element (chips, tabs, match rows, selects, FAB) shows it, not just buttons.
- **Color-only info**: format badges, tone banners, and `.status-line` must not
  be the sole conveyors of meaning (banners have text ✓ — check badges vs
  `color-scheme` and contrast).
- **Reduced motion**: honored ✓ — the `empty-disc` spin must be decorative.

## 9. Installed PWA / environment
- **Safe areas**: sheet bottom padding, FAB, toast use `safe-bottom` ✓; does
  the header/top respect `safe-top` on a notched phone?
- **Standalone quirks**: no browser back (see #7); pull-to-refresh is disabled
  (`overscroll-behavior-y: none` ✓) — confirm scroll still feels native.
- **Offline**: shell + scanner `.wasm` precached; cached items render offline.
  Is offline communicated (subtle message) or does it look broken?
- **Desktop**: hover states exist (`btn-primary:hover`, `btn-ghost:hover` ✓);
  the mobile-first layout must not look abandoned on a wide desktop (max-width
  on content, sensible grid).

## 10. Performance feel
- **Images**: covers use `loading="lazy"` ✓ — check for layout shift while
  loading (reserved aspect ratio / placeholders) in cards, match rows, detail.
- **Scanner boot**: the WASM is lazy-imported ✓ — does tapping Scan feel
  responsive, with a clear loading state (`scanner-loading`)?
- **Transitions**: sheet `0.22s` rise and toast `0.2s` — confirm they don't
  feel sluggish on a mid-range phone and that `prefers-reduced-motion` kills
  them.
