# Design Brief — Alcove app icon (for UI/UX Expert)

**Owner:** Marketing Manager → UI/UX Expert (Figma) · **Status:** `[VALIDATE]`
**Gated item:** ticket-rename-alcove.md §5 (icon) — ships with the "name day".
**Copy ref:** `marketing/copy-kit-alcove.md` · **Plan ref:** `marketing/rename-alcove.md` §6.

---

## 1. What we're designing

The **app icon** for the renamed product **Alcove** — the cozy nook that holds
your record crate and book shelf. It replaces the current Runout icon across:

| Asset | Size | Purpose |
| --- | --- | --- |
| `public/favicon.png` | 32×32 | browser tab |
| `public/apple-touch-icon.png` | 180×180 | iOS home screen |
| `public/icon-192.png` | 192×192 | PWA manifest |
| `public/icon-512.png` | 512×512 | PWA manifest |
| `public/icon-maskable-512.png` | 512×512 | PWA maskable (full-bleed) |

---

## 2. Brand truth the mark must carry

- The product **scans barcodes** (EAN/UPC on records, ISBN on books) and catalogs
  **two kinds of collections at once** — *your crate* (records) and *your shelf*
  (books) — in one app.
- **Alcove** = a warm, recessed place that holds your treasures. The mark should
  feel **cozy + treasure**, never cold or corporate.
- Live design tokens (from `src/index.css`):
  - background `--sleeve-black` `#16130F`
  - accent `--runout-gold` `#C9A227`
  - support `--jacket-kraft` `#EFE6D8`, `--jacket-kraft-dim` `#C9BFAF`
  - `--label-red` `#B23A2E`, `--vinyl-groove` `#211D18`
  - display face: Fraunces (serif) — for any wordmark *if* used at large sizes only.

---

## 3. Concept directions (pick 1–2 to develop)

1. **The alcove arch** — a recessed arch/nook (like a record-sleeve-shaped niche
   or a bookcase alcove) in gold on the dark field, with a record disc and a book
   peeking out from inside. Most on-brand for "cozy nook that holds your things".
2. **Two loves, one mark** — a vinyl disc and a book cover joined so they form an
   arch/niche together. Tells the records+books story at a glance.
3. **The barcode nook** — a barcode motif (the product's scan gesture) framed by
   an alcove arch. Communicates "scan to catalog".

---

## 4. Hard constraints

- **Reads at 32px** (favicon) and at 192px — one clear silhouette, no fine detail
  that disappears when scaled down.
- **Maskable-safe:** keep the core motif inside the center **80%** of the canvas;
  the background must extend to the edges (PWA masks icons).
- **Flat, simple shapes** — no gradients that fight the PWA mask or small sizes.
- **Palette:** dark `#16130F` field + gold `#C9A227` primary; kraft/red only as
  tiny accents. Matches the installed home-screen against other icons.
- **No text in the icon** (or, at most, a serif wordmark only at 512px — it will
  be illegible at 32px and should not be relied on).
- **Must be visually distinct** from the current Runout icon so the rebrand is
  obvious on the home screen.

---

## 5. Deliverables

- Figma source (design tokens, exported from `--sleeve-black` / `--runout-gold`).
- Exported PNGs at the exact paths in §1 (512 + 192 + 180 + 32; maskable at 512).
- A **3-size legibility test** (32 / 48 / 192) and a home-screen mock on a dark
  background.
- 2–3 concept options, labeled, with a recommendation.

## 6. Success criteria

- [ ] Legible at 32px (favicon) with no mush.
- [ ] Survives the maskable crop (no content clipped).
- [ ] Reads as "cozy place for records & books" → on-brand for Alcove.
- [ ] Distinct from the old Runout icon.
- [ ] Uses the real dark/gold tokens (no invented palette).
- [ ] Approved by Marketing → handed to Front End Developer to swap into `public/`
      (ticket-rename-alcove.md §5).
