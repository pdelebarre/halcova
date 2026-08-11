# Runout Design Tokens

Source of truth: `src/index.css` (and `src/styles/shared.css`). Use these
exact values in any Figma design so the result matches the app. If a value
changes, update `src/index.css` first and mirror it here.

## Colors
| Token | Value | Use |
| --- | --- | --- |
| `--sleeve-black` | `#16130F` | App background |
| `--vinyl-groove` | `#211D18` | Surfaces (sheets, cards) |
| `--vinyl-groove-2` | `#2B251E` | Raised surfaces, chip/icon bg |
| `--jacket-kraft` | `#EFE6D8` | Primary text, on-primary |
| `--jacket-kraft-dim` | `#C9BFAF` | Secondary text, ghost text |
| `--label-red` | `#B23A2E` | Primary action (`btn-primary`) |
| `--label-red-bright` | `#CE4B3D` | Primary hover/active |
| `--runout-gold` | `#C9A227` | Focus outline (`:focus-visible`) |
| `--static-grey` | `#8A8377` | Muted / decorative text |
| `--line` | `#35302A` | Borders, dividers |
| `--danger` | `#C24B3F` | Destructive actions, errors |
| `--success` | `#7A9A6B` | Positive states (e.g. `cd` badge) |

## Typography
| Token | Family | Use |
| --- | --- | --- |
| `--font-display` | Fraunces (serif) | Headings / wordmark / titles |
| `--font-body` | Inter (sans) | Body, buttons, inputs |
| `--font-mono` | IBM Plex Mono | Status, badges, meta, codes |

Body sizes in use: buttons 15px (`.btn`), status/meta ~13px, badges 10px,
toast 13.5px.

## Radii & shape
- `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 16px`.
- Badges: pill (`border-radius: 999px`); close buttons: circle (32px).

## Spacing / layout
- Buttons: `padding: 12px 18px`, gap `8px`.
- Sheets: `max-width: 560px`, `max-height: min(84dvh, 720px)`, top corners
  `--radius-lg`, bottom padding `calc(var(--safe-bottom) + 18px)`.
- Safe areas: `--safe-top` / `--safe-bottom` (`env(safe-area-inset-*)`) — the
  FAB, toast, and sheets respect the bottom inset; header should respect the
  top.
- Grid: `AlbumGrid` breakpoints at `480px` and `720px`.

## Interaction
- Focus: `:focus-visible { outline: 2px solid var(--runout-gold); outline-offset: 2px }`.
- Press feedback: buttons/FAB scale down on `:active`.
- Reduced motion: `prefers-reduced-motion` kills animations/transitions
  (honored in `index.css`, `ScannerModal.css`, `EmptyState.css`).
- `color-scheme: dark`; selection = `--label-red` bg / `--jacket-kraft` text.
