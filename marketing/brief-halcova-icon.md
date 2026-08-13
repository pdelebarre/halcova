# Design Brief — Halcova app icon (for UI/UX Expert)

**Owner:** Marketing Manager → UI/UX Expert (Figma) · **Status:** `[VALIDATE]`
**Gated:** Phase 3 (name reveal) — see `campaign-viral-launch.md` §0
**Copy ref:** `marketing/copy-kit-halcova.md` · **Current spec:** `docs/icon-treasure-nook-spec.md`

> **Feedback (2026-08-13): the current icon does not show a barcode.** The
> selected Treasure Nook mark (Gothic arch + tilted card) has no "code bar".
> **A visible barcode is now a required element** of the Halcova icon — the mark
> must read as "scan to catalog" at a glance.

---

## 1. What we're designing

The **app icon** for **Halcova** — the cozy place that holds your record crate
and book shelf, entered by scanning a barcode. It replaces the current icon
across:

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
- **Halcova** = the cozy place that holds your treasures. The mark should feel
  **cozy + treasure**, never cold or corporate — and it must be **instantly
  about scanning**.
- Live design tokens (from `src/index.css`):
  - background `--sleeve-black` `#16130F`
  - accent `--runout-gold` `#C9A227`
  - support `--jacket-kraft` `#EFE6D8`, `--jacket-kraft-dim` `#C9BFAF`
  - `--label-red` `#B23A2E`, `--vinyl-groove` `#211D18`
  - display face: Fraunces (serif) — wordmark only at large sizes, never relied on.

---

## 3. The barcode is REQUIRED (not optional)

Every concept must include a **recognizable barcode (code bar)** — the scan
gesture is Halcova's whole identity. Integrate it with the existing Treasure
Nook idea (Gothic arch + tilted card from `docs/icon-treasure-nook-spec.md`).
Directions to develop (each must show a barcode):

1. **Barcode card** — the tilted card resting in the Gothic arch is a barcode
   (its face is a gold code bar on the dark field). Treasure + scan in one shape.
2. **Barcode arch** — the Gothic arch is drawn from vertical code-bar strokes of
   varying width (gold on `#16130F`), with a small kraft card/title tucked inside.
3. **Barcode base** — arch + card as today, with a short barcode strip sitting on
   the base line inside the arch (reads "scan to open the nook").

> Do **not** propose a barcode-free concept. If the barcode disappears at 32px,
> simplify it (fewer, thicker bars) — never remove it.

---

## 4. Hard constraints

- **Reads at 32px** (favicon) and at 192px — one clear silhouette; the barcode
  must still read as bars at 32px (use bold bars, not fine lines).
- **Maskable-safe:** keep the core motif inside the center **80%** of the canvas;
  the background must extend to the edges (PWA masks icons).
- **Flat, simple shapes** — no gradients that fight the PWA mask or small sizes.
- **Palette:** dark `#16130F` field + gold `#C9A227` primary; kraft/red only as
  tiny accents.
- **No text in the icon** (a serif wordmark only at 512px at most — never relied
  on, illegible at 32px).
- **Must be visually distinct** from the old Runout icon so the rename to
  Halcova is obvious on the home screen.

---

## 5. Deliverables

- Figma source (design tokens, exported from `--sleeve-black` / `--runout-gold`).
- Exported PNGs at the exact paths in §1 (512 + 192 + 180 + 32; maskable at 512).
- A **3-size legibility test** (32 / 48 / 192) — the barcode must be legible at
  32px — and a home-screen mock on a dark background.
- 2–3 concept options (each **with a barcode**), labeled, with a recommendation.
- Update `docs/icon-treasure-nook-spec.md` with the chosen barcode geometry.

## 6. Success criteria

- [ ] **Barcode clearly visible and legible at 32px** (no mush, no disappearance).
- [ ] Survives the maskable crop (no content clipped).
- [ ] Reads as "cozy place for records & books, entered by scanning" → on-brand
      for Halcova.
- [ ] Distinct from the old Runout icon.
- [ ] Uses the real dark/gold tokens (no invented palette).
- [ ] Approved by Marketing → handed to Front End Developer to swap into `public/`
      alongside the Hokan→Halcova code rename (new dev ticket; model:
      `ticket-rename-Halcova.md`).
