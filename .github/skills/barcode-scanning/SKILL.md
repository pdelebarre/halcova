---
name: barcode-scanning
description: "Work on Runout's camera barcode scanner (src/components/ScannerModal.jsx): zxing-wasm WASM decoder, custom camera loop, EAN13/EAN8/UPCA/UPCE/Code128 formats, frame downscaling and ~5fps throttling, self-hosted WASM + PWA precache, and iOS Safari behavior. Triggers: 'scanner', 'barcode', 'camera', 'scan', 'zxing', 'EAN', 'ISBN scan', 'decode'."
---
# Barcode Scanning

How Runout reads barcodes with the phone camera, and how to extend or debug it.

## When to Use
- Scanner bugs (no decode, wrong code, slow scanning).
- Adding or removing supported barcode formats.
- Changing the camera or decode pipeline for performance.

## How It Works (read `src/components/ScannerModal.jsx` first)
1. **Engine**: `zxing-wasm/reader` (`prepareZXingModule`, `readBarcodes`) — a
   WASM port of ZXing-C++ that decodes 1D codes reliably on iOS Safari (where
   the old `html5-qrcode` decoder was unreliable and there is no
   `BarcodeDetector`).
2. **Self-hosted WASM**: `import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'`
   + `prepareZXingModule({ overrides: { locateFile } })` so the decoder ships in
   our own bundle, is precached by the PWA (`.wasm` is in `vite.config.js`
   `globPatterns`), and doesn't depend on a third-party CDN.
3. **Camera loop**: `getUserMedia` (`facingMode: environment`, 1280×720 ideal)
   → `<video playsInline muted>` → downscale to ≤`MAX_DECODE_WIDTH` (640px) on
   an off-screen `<canvas>` → `readBarcodes(imageData, READER_OPTIONS)`.
4. **Throttling**: `DECODE_INTERVAL_MS` (180ms ≈ 5 decodes/s) keeps the WASM
   fast on mid-range phones; individual frame failures are swallowed (normal).
5. **Formats**: `READER_OPTIONS.formats` =
   `['EAN13','EAN8','UPCA','UPCE','Code128']` with `tryHarder: true` and
   `maxNumberOfSymbols: 1`.
6. **On success**: vibrate (60ms), stop the media tracks,
   `cancelAnimationFrame`, then `onDetected(code)`.
7. **Lazy-loading**: `ScannerModal` is lazy-imported in `CollectionView.jsx` so
   the ~heavy WASM only loads when the user actually taps Scan.

## Common Tasks
- **Add a format**: add it to `READER_OPTIONS.formats`. This app scans 1D
  retail codes, not QR.
- **Wrong or no result**: check the code is in the format list; try
  `tryHarder`; confirm the frame is sharp — small barcodes need more pixels
  (raise `MAX_DECODE_WIDTH`).
- **Slow decode**: lower `MAX_DECODE_WIDTH` or raise `DECODE_INTERVAL_MS`.
- **Camera denied / not found**: surfaces via `errorMsg`; the page must be
  served over HTTPS or `localhost`.

## Verification
- Run `npm run dev` and test in the integrated browser's camera (or the
  deployed HTTPS URL on a real phone).
- Confirm the PWA still precaches the wasm: the built service worker must
  reference `zxing_reader.wasm`.
