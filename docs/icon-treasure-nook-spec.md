# The Treasure Nook — App Icon Specification

**Concept 2 · Selected 2026-08-12**
A recessed Gothic pointed-arch alcove with a tilted card resting inside —
a "treasure nook" that is unmistakably different from the current vinyl-record icon.

---

## 0. Design Tokens (from `src/index.css`)

| Token | Variable | Hex |
|---|---|---|
| Background | `--sleeve-black` | `#16130F` |
| Arch / Gold | `--runout-gold` | `#C9A227` |
| Card / Kraft | `--jacket-kraft` | `#EFE6D8` |
| Kraft dim | `--jacket-kraft-dim` | `#C9BFAF` |
| Display font | `--font-display` | Fraunces, Georgia, serif |

**Constraint:** Flat shapes only — no gradients, no drop shadows, no blurs.

---

## 1. Canvas

- **Size:** 512 × 512 px
- **Background:** `#16130F` fills the entire canvas
- **Coordinate origin:** top-left (0, 0)
- **Safe zone (maskable 80%):** the region from (51.2, 51.2) to (460.8, 460.8) — a 409.6 × 409.6 px centered square. All core motifs live inside this zone.

---

## 2. The Arch

### 2.1 Geometry — Equilateral Pointed (Gothic) Arch

The arch is a **true Gothic pointed arch** where each arc has its center at the opposite springing point. This produces a distinctive medieval-church-doorway silhouette — not a Roman semi-circle, not a horseshoe, not a wide U.

| Parameter | Value | Notes |
|---|---|---|
| Arch type | Equilateral pointed Gothic | Radius = width |
| Width (springing span) | 280 px | From x = 116 to x = 396 |
| Springing-point Y | 380 px | Where the arch meets the horizontal base |
| Apex Y | ≈ 137.5 px | Top of the pointed arch |
| Arch rise (height) | ≈ 242.5 px | From base-line to apex |
| Stroke width | 16 px | `#C9A227`, centered on the path |
| Fill | `none` | Transparent interior — the dark background shows through |
| Stroke linecap | `round` | Rounded ends at the springing points |
| Stroke linejoin | `round` | Smooth join at apex |

**Arc radius derivation:**

For an equilateral pointed arch of width *W* = 280 px, radius *R* = *W* = 280 px.

Left arc center: (396, 380) — the right springing point.
Right arc center: (116, 380) — the left springing point.

Apex calculation:
- Distance from left arc center to apex must equal R = 280.
- Apex x = 256 (horizontal midpoint).
- Solve: √((396 − 256)² + (380 − y)²) = 280 → (140)² + (380 − y)² = 280² → 19,600 + (380 − y)² = 78,400 → (380 − y)² = 58,800 → 380 − y ≈ 242.49 → y ≈ 137.51.
- **Apex:** (256, 137.5)

### 2.2 SVG Path — Arch

```
M 116 380
A 280 280 0 0 1 256 137.5
A 280 280 0 0 1 396 380
```

Rendered with:
- `stroke="#C9A227"`
- `stroke-width="16"`
- `fill="none"`
- `stroke-linecap="round"`
- `stroke-linejoin="round"`

### 2.3 Horizontal Base Line

A flat horizontal line closing the bottom of the alcove. It extends slightly beyond the arch legs so the round caps overlap cleanly.

```
M 108 380 L 404 380
```

Rendered with:
- `stroke="#C9A227"`
- `stroke-width="16"`
- `stroke-linecap="round"`

**Visual result:** The arch legs' round caps at (116, 380) and (396, 380) naturally blend into the base line's round caps at (108, 380) and (404, 380). The base line visibly spans 296 px (108 → 404), extending 8 px beyond each arch leg (matching the 8 px stroke radius).

### 2.4 Why This Arch Shape

| Arch type | Silhouette | Verdict |
|---|---|---|
| Roman semi-circle | Soft U shape | Too close to the current round vinyl icon |
| Horseshoe | Wide U, narrows at top | Feels Moorish, not "treasure nook" |
| **Equilateral pointed Gothic** | Sharp apex, straight-ish sides | Distinct, architectural, "cathedral/treasure" vibe |
| Lancet (steeper Gothic) | Very narrow, very tall | Too vertical — wastes safe-zone width |

---

## 3. The Inner Item — The "Treasured Object"

### 3.1 Geometry

A rounded rectangle representing a card, case, or book resting inside the alcove. It has a slight perspective tilt — like a treasured object leaning casually in its nook.

| Parameter | Value |
|---|---|
| Shape | Rounded rectangle |
| Width | 100 px |
| Height | 140 px |
| Corner radius | 12 px (all four corners, `rx="12" ry="12"`) |
| Fill | `#EFE6D8` (kraft) |
| Rotation | 10° clockwise around its own center |
| Transform origin | Center of the rectangle |

### 3.2 Position

| Parameter | Value |
|---|---|
| Center X (before rotation) | 256 px |
| Center Y (before rotation) | 302 px |

**Why Y = 302:** After 10° rotation, the lowest point of the card is at approximately:

> y_bottom ≈ 302 + (140/2)·cos(10°) + (100/2)·sin(10°)
>         ≈ 302 + 70·0.9848 + 50·0.1736
>         ≈ 302 + 68.94 + 8.68
>         ≈ 379.62 px

This places the card's bottom edge essentially touching the base line at y = 380 — the card "rests" in the nook, grounded but not overlapping the gold base.

### 3.3 SVG

```svg
<g transform="translate(256, 302) rotate(10)">
  <rect x="-50" y="-70" width="100" height="140" rx="12" ry="12"
        fill="#EFE6D8" />
</g>
```

Alternatively, as a single `<rect>` with explicit transform:

```svg
<rect x="-50" y="-70" width="100" height="140" rx="12" ry="12"
      fill="#EFE6D8"
      transform="translate(256, 302) rotate(10)" />
```

### 3.4 Relationship to the Arch

```
        ┌──────────┐
        │   APEX   │        ← arch peak at y ≈ 137.5
        │  (256,    │
        │  137.5)   │
       ╱            ╲
      ╱   ┌─────┐    ╲      ← card centered at (256, 302)
     ╱    │     │     ╲        tilted 10°, 100×140 px
    ╱     │     │      ╲
   ╱      └─────┘       ╲
  ╱──────────────────────╲   ← base line at y = 380
  ██████████████████████████
```

The card sits centered horizontally in the arch. Its bottom nearly touches the base line (≈0.4 px gap). Its top reaches approximately y ≈ 302 − 70·cos(10°) + 50·sin(10°) ≈ 302 − 68.94 + 8.68 ≈ 241.7 px — about 104 px below the apex. This leaves generous breathing room above and on both sides of the card.

---

## 4. Warm Glow (Optional, Recommended)

A subtle warm glow from deep inside the arch, behind the card. This is a **flat layered semi-ellipse** — no gradients.

### 4.1 Geometry

| Parameter | Value |
|---|---|
| Shape | Half-ellipse (bottom half of a full ellipse) |
| Width | 200 px (full ellipse width) |
| Height | 120 px (full ellipse height; half = 60 px visible) |
| Center X | 256 px |
| Center Y | 330 px (the half-ellipse sits in the lower portion of the arch) |
| Fill | `#C9A227` |
| Opacity | 10% (`opacity="0.10"` or `fill-opacity="0.10"`) |

### 4.2 SVG

```svg
<path d="M 156 330 A 100 60 0 0 0 356 330 Z"
      fill="#C9A227" opacity="0.10" />
```

This draws the bottom half of an ellipse from (156, 330) to (356, 330) — the arc sweeps downward. The glow sits behind the card (drawn first in the SVG, before the card).

### 4.3 Z-Order (Back to Front)

1. Background `#16130F` rect — full canvas
2. Warm glow half-ellipse
3. Arch path (stroked)
4. Base line (stroked)
5. Card (filled rounded rect, rotated)

---

## 5. Maskable Variant

### 5.1 Assessment

The core motif already sits **entirely within the 80% safe zone**:

| Element | X range | Y range | Within safe zone? |
|---|---|---|---|
| Arch | 116–396 | 137.5–380 | ✅ X: 116 ≥ 51.2, 396 ≤ 460.8 · Y: 137.5 ≥ 51.2, 380 ≤ 460.8 |
| Base line | 108–404 | 380 | ✅ |
| Card | ≈ 166–346 (after rot.) | ≈ 242–380 | ✅ |
| Glow | 156–356 | 300–390 | ✅ |

The arch occupies roughly the center-bottom portion of the safe zone, with:
- ~86 px headroom above the apex to the safe-zone top
- ~80 px below the base line to the safe-zone bottom
- ~55 px on each side to the safe-zone edges

### 5.2 Instructions

**No geometry changes needed for the maskable variant.** The 512 × 512 maskable icon uses the exact same artwork. The maskable safe-zone trim (applied by the platform, e.g., Android adaptive icons) will crop to the central 409.6 × 409.6 px region, which fully contains the motif.

Export as `icon-maskable-512.png` using the same SVG render — no separate artwork required.

### 5.3 Verification

Render the maskable icon with a circular mask at 83.33% of the canvas diameter (common Android adaptive icon crop) to confirm: the pointed arch apex and base line remain visible, and the card is fully inside the crop region.

---

## 6. Small-Size Behaviour

### 6.1 At 192 × 192 px (Scale Factor: 0.375)

| Element | 512 px | 192 px | Readable? |
|---|---|---|---|
| Arch stroke | 16 px | 6 px | ✅ Clearly visible |
| Arch width | 280 px | 105 px | ✅ Distinct pointed shape |
| Card width | 100 px | 37.5 px | ✅ Recognizable rectangle |
| Card height | 140 px | 52.5 px | ✅ |
| Card corner radius | 12 px | 4.5 px | ✅ Rounded corners visible |
| Glow | 200 × 60 px | 75 × 22.5 px | ✅ Subtle but present |

**Silhouette at 192 px:** A gold pointed arch with a visible light rectangle inside. Clearly not a circle.

### 6.2 At 48 × 48 px (Scale Factor: ~0.094)

| Element | 512 px | 48 px |
|---|---|---|
| Arch stroke | 16 px | ~1.5 px |
| Card width | 100 px | ~9.4 px |
| Card height | 140 px | ~13.1 px |

**Silhouette at 48 px:** The gold pointed arch dominates. The card is a small light rectangle inside. The warm glow is effectively invisible — drop it.

### 6.3 At 32 × 32 px (Scale Factor: 0.0625)

| Element | 512 px | 32 px |
|---|---|---|
| Arch stroke | 16 px | 1.0 px |
| Card width | 100 px | 6.25 px |
| Card height | 140 px | 8.75 px |

**What remains as the recognizable silhouette:**
- The **gold pointed arch** — the strongest single shape. At 1 px stroke it is thin but still human-readable.
- The **kraft card** — a small light block inside the arch, ~6 × 9 px.
- Combined, the silhouette reads as "a doorway/alcove shape with something inside" — completely distinct from a solid circle (vinyl record icon).

### 6.4 Recommended Small-Size Adjustments

For exports at 48 px and below, apply these tweaks **programmatically** (do not alter the 512 px master):

| Adjustment | 48 px | 32 px |
|---|---|---|
| Arch stroke | 2 px (bump from 1.5) | 2 px (bump from 1.0) |
| Card corner radius | 3 px | 2 px (or square — remove rounding) |
| Warm glow | Remove | Remove |
| Base line | Merge with arch visually (no separate stroke) | Same |

**Rationale:** At 1 px, the arch stroke is fragile and may anti-alias into near-invisibility on some displays. Thickening to 2 px at 32 px (~3.1 px equivalent at 512) ensures the arch remains a confident silhouette. The card can lose its corner radius entirely at 32 px — it becomes a simple small rectangle, which is perfectly readable.

---

## 7. Wordmark Option (512 px Only)

An optional "halcova" wordmark in Fraunces, placed below the arch.

### 7.1 Specification

| Parameter | Value |
|---|---|
| Text | `halcova` (all lowercase) |
| Font | Fraunces, 72 pt (regular weight, ~400) |
| Color | `#C9A227` (gold) |
| Text anchor | `middle` (centered on X) |
| Position X | 256 px (canvas center) |
| Position Y | 460 px (baseline) |
| Letter-spacing | 0.05 em (slightly tracked out for elegance) |

### 7.2 SVG

```svg
<text x="256" y="460"
      font-family="Fraunces, Georgia, serif"
      font-size="72"
      font-weight="400"
      fill="#C9A227"
      text-anchor="middle"
      letter-spacing="0.05em">
  halcova
</text>
```

### 7.3 Visual Relationship

At y = 460, the wordmark sits 80 px below the base line (y = 380). With 72 pt Fraunces, the cap-height is approximately 52 px, so the wordmark occupies roughly y = 408 to y = 460. This leaves a ~28 px gap between the base line (380) and the top of the wordmark (~408).

**The wordmark intentionally extends below the 80% maskable safe zone** (which ends at y = 460.8). The wordmark should be present only in the **non-maskable 512 px icon** (used for iOS, web favicons, PWA manifest `icons[].src` with `"purpose": "any"`). The maskable variant omits it entirely.

### 7.4 Alternative — No Wordmark

The icon works equally well without the wordmark. The arch + card composition is self-contained and distinctive. If the wordmark is omitted:
- The arch could optionally shift down ~20 px to better fill the safe zone vertically (move springing points from y = 380 to y = 400; recalculate apex accordingly; card follows).
- This is a judgment call for the implementer. The spec above assumes the wordmark is included in the non-maskable 512 px variant.

---

## 8. Complete SVG — 512 px Master

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     width="512" height="512"
     viewBox="0 0 512 512">

  <!-- 1. Background -->
  <rect width="512" height="512" fill="#16130F" />

  <!-- 2. Warm glow (behind everything) -->
  <path d="M 156 330 A 100 60 0 0 0 356 330 Z"
        fill="#C9A227" opacity="0.10" />

  <!-- 3. Gothic pointed arch (stroked outline) -->
  <path d="M 116 380 A 280 280 0 0 1 256 137.5 A 280 280 0 0 1 396 380"
        stroke="#C9A227" stroke-width="16" fill="none"
        stroke-linecap="round" stroke-linejoin="round" />

  <!-- 4. Horizontal base line -->
  <line x1="108" y1="380" x2="404" y2="380"
        stroke="#C9A227" stroke-width="16" stroke-linecap="round" />

  <!-- 5. Inner card (tilted rounded rectangle) -->
  <rect x="-50" y="-70" width="100" height="140" rx="12" ry="12"
        fill="#EFE6D8"
        transform="translate(256, 302) rotate(10)" />

  <!-- 6. Wordmark (non-maskable only) -->
  <text x="256" y="460"
        font-family="Fraunces, Georgia, serif"
        font-size="72" font-weight="400"
        fill="#C9A227"
        text-anchor="middle" letter-spacing="0.05em">
    halcova
  </text>

</svg>
```

### Export Checklist

| File | Size | Wordmark? | Small-size tweaks? | Source |
|---|---|---|---|---|
| `icon-512.png` | 512 × 512 | ✅ Yes | No | Full SVG above |
| `icon-maskable-512.png` | 512 × 512 | ❌ No | No | Remove `<text>` block |
| `icon-192.png` | 192 × 192 | ❌ No | No | Scale down, no tweaks needed |
| `favicon.png` | 32 × 32 | ❌ No | ✅ Yes (see §6.4) | Simplified variant |
| `apple-touch-icon.png` | 180 × 180 | ❌ No | No | Scale down from 512 |

---

## 9. Distinctiveness from Current Icon

| Attribute | Current Icon | Treasure Nook |
|---|---|---|
| Dominant shape | Circle (vinyl record) | Pointed arch |
| Interior | Concentric rings + center label | Single tilted rectangle |
| Silhouette at 32 px | Filled circle with center dot | Pointed-doorway outline with inner block |
| Color distribution | Large black area, gold accent ring | Gold arch outline dominates, small kraft shape |
| Metaphor | Music / vinyl | Architecture / treasure / collection |

The pointed arch silhouette at any size is **unambiguously different** from a circle. No user will confuse the two icons on a home screen.

---

## 10. Implementation Notes

1. **Render the SVG at 512 × 512** using a headless browser (Puppeteer/Playwright), `sharp` (Node.js), `resvg-js`, or `inkscape --export-png`. Do not rasterize in a canvas at smaller sizes and scale up.

2. **For small sizes (§6.4), generate a separate simplified SVG** rather than scaling the master and hoping anti-aliasing handles it. The 32 px variant should have:
   - Arch stroke: 2 px
   - Card: plain rectangle (no corner radius), 6 × 9 px, centered at (256, 302), rotated 10°
   - No glow, no wordmark

3. **Color profile:** Export PNGs as sRGB. The dark background `#16130F` should not be color-managed into a lighter tone.

4. **Verify maskable:** Render with a circular clip-path at 83.33% of canvas diameter centered on the canvas to confirm the arch + card are fully inside the crop region.

5. **Place exports in `public/`** — the PWA manifest (`vite.config.js`) and `index.html` reference these filenames. Do not change the filenames.

---

*Specification version 1.0 · 2026-08-12*
*For implementation by Runout Engineer*
