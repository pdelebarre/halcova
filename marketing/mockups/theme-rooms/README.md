# Mockups — "One home, two rooms" (Phase 0 survey assets)

**Owner:** UI/UX Expert · **Date:** 2026-08-15
**For:** `marketing/survey-theme-rooms.md` §5 (Section B of the Phase 0 survey).
**Generate:** `node marketing/mockups/theme-rooms/generate.mjs` → 5 SVGs + 5 PNGs.

## Files

| File | Letter | Direction | Accent |
| --- | --- | --- | --- |
| `records-room-gold-reference.svg/.png` | REF | Records tab, current look — the reference testers compare against | gold `#C9A227` |
| `books-room-A-amber.svg/.png` | A | Books, warm amber | `#D9A441` |
| `books-room-B-green.svg/.png` | B | Books, reading-room green | `#7FA98C` |
| `books-room-C-oxblood.svg/.png` | C | Books, oxblood / wine red (two-tone — see below) | `#B05750` + text `#CB7C70` |
| `books-room-D-gold.svg/.png` | D | Books, keep gold (status quo control) | gold `#C9A227` |

## What's identical in every mockup (the "one home" skeleton)
Header + wordmark, Records|Books tab bar, user chip (**gold initial in every
room** — the brand thread), search pill + count, filter/sort buttons, the
tagline row, the **red Scan FAB** (`--label-red`, the global primary action),
cover cards, layout, spacing. Only the **ambient background tint** and the
**accent surfaces** (active category chip) differ — that's the "room."

## Contrast gate (verified, WCAG on `#16130F`)

| Accent | Purpose | Ratio vs `#16130F` | Verdict |
| --- | --- | --- | --- |
| gold `#C9A227` (control) | text + UI | 7.65:1 | ✅ |
| amber `#D9A441` (A) | text + UI | 8.23:1 | ✅ |
| green `#7FA98C` (B) | text + UI | 7.02:1 | ✅ |
| oxblood `#B05750` (C) | UI/border/tint | 3.81:1 | ⚠️ UI-only (≥3:1) |
| oxblood text `#CB7C70` (C) | chip text | 5.87:1 | ✅ |

> **Key finding:** plain oxblood **fails 4.5:1 for text on the dark base**, so
> the C variant uses a two-tone treatment (deep oxblood for borders/tints,
> lighter `#CB7C70` for text). If oxblood is chosen, the app needs both tokens.

## Design notes / gotchas for the Front End Architect & Tester
- **Do not conflate the books accent with semantic colors.** Green was chosen
  deliberately to differ from `--success #7A9A6B` (a yellow-green sage) — the
  proposed reading-room green `#7FA98C` is teal-leaning and passes 4.5:1.
  Semantic colors (danger/success/owned) must stay **global and identical**
  across rooms (per `analysis-theme-per-collection.md` §5.1).
- **Token plan (directional):** introduce a neutral core token layer + per-kind
  accent aliases (`--kind-records-accent`, `--kind-books-accent`) so records
  keeps today's look and books gains a room without a breaking visual rewrite.
  Current tokens are vinyl-named (`--sleeve-black`, `--runout-gold`, …) —
  rename is a Front End Architect decision, not part of this mockup.
- **Ambient tint:** the room tint is a subtle top gradient (≤13% accent
  opacity fading to 0) — enough to feel like a different room, weak enough to
  pass the "same app" cohesion test. Keep it below ~15% at implementation.
- **Covers are placeholder art** (muted blocks + serif initial). Production
  cards show real Google Books covers via `coverImage` — the accent/ambience is
  independent of cover art.
- **A/B/C/D letter badges and "REF"** are survey identifiers (bottom-left);
  they are NOT part of the app UI.
- **PNG render fonts:** SVGs name Fraunces/Inter/Plex Mono; `sharp`/librsvg
  falls back to Georgia/Helvetica/Menlo for the PNGs. Browser-opened SVGs may
  also fall back. This does not affect the survey (same fallback everywhere).

## What testers see
- **A vs D** show how close amber sits to the current gold — A is the "max
  cohesion, min change" option.
- **B** is the clearest "second room" (distinct hue, still passes contrast).
- **C** shows oxblood's bookish warmth **and** its contrast constraint (lighter
  text). If testers love the *feel* of C, note the two-tone requirement.
- **D = status quo** (identical to today's books tab look) — the control.
