// ISSUE #365 (ARCH-0.3.2) — Optimize deferred scanner & OCR chunks without
// breaking offline PWA.
//
// Guards the acceptance criteria at the source/config level:
//   1. ZXing (barcode) and Tesseract (cover OCR) runtime code are NOT in the
//      eager initial shell. ScannerModal and CoverScanModal are loaded with
//      React.lazy; the OCR orchestrator (utils/ocr) and the heavy Tesseract
//      runtime (tesseract.js) are reached through dynamic `import()` only —
//      they initialize ONLY when the user actually scans a barcode / cover,
//      never when the collection view mounts.
//   2. Offline-first installation still has the required deferred assets
//      precached: the self-hosted scanner wasm (zxing_reader.wasm), the
//      Tesseract worker (worker.min.js), the LSTM core
//      (tesseract-core-lstm.wasm.js) and the English traineddata
//      (eng.traineddata.gz). This mirrors the precache-level invariant checks
//      that `offline-isolation.test.js` performs for the service-worker
//      boundary.
//
// The >500 kB entries (zxing wasm, tesseract core) are intentionally deferred
// feature assets of fixed inherent size — see docs/technical.md §15. No split
// is warranted; these tests lock in that they stay deferred + precached and
// never regress back into the eager shell or drop out of the precache.
import { describe, expect, it } from 'vitest'

async function readFile(rel) {
  const { readFile } = await import('node:fs/promises')
  const path = (await import('node:path')).default
  const { fileURLToPath } = await import('node:url')
  const abs = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', rel)
  return readFile(abs, 'utf8')
}

describe('scanner + cover-OCR initialize ONLY on invocation (lazy), not on shell mount', () => {
  it('CollectionView lazy-loads both camera modals via React.lazy', async () => {
    const src = await readFile('src/CollectionView.jsx')
    // ScannerModal and CoverScanModal must never be statically imported into
    // the eager shell.
    expect(src).not.toMatch(/^import\s+ScannerModal/m)
    expect(src).not.toMatch(/^import\s+CoverScanModal/m)
    expect(src).not.toMatch(/^import\s+.*['"]\.\/components\/ScannerModal['"]/m)
    expect(src).not.toMatch(/^import\s+.*['"]\.\/components\/CoverScanModal['"]/m)
    // They are pulled in React.lazy(() => import(...)) instead.
    expect(src).toMatch(/const\s+ScannerModal\s*=\s*lazy\(\(\)\s*=>\s*import\(['"]\.\/components\/ScannerModal['"]\)\)/)
    expect(src).toMatch(/const\s+CoverScanModal\s*=\s*lazy\(\(\)\s*=>\s*import\(['"]\.\/components\/CoverScanModal['"]\)\)/)
    // No Tesseract/OCR import in CollectionView — OCR is dynamic, per scan.
    // T8 (#286): the cover-OCR orchestrator lives in useLookup.runOcr, so the
    // dynamic import moved to the hook (still never on shell mount).
    expect(src).not.toMatch(/^import\s+.*['"]\.\/utils\/ocr['"]/m)
    expect(src).not.toContain("'tesseract.js'")
    const hookSrc = await readFile('src/hooks/useLookup.js')
    expect(hookSrc).toMatch(/await\s+import\(['"]\.\.\/utils\/ocr['"]\)/)
    expect(hookSrc).not.toMatch(/^import\s+.*['"]\.\.\/utils\/ocr['"]/m)
    expect(hookSrc).not.toContain("'tesseract.js'")
  })

  it('the OCR orchestrator pulls the heavy Tesseract runtime via dynamic import only', async () => {
    const src = await readFile('src/utils/ocr.js')
    // No static import of the heavy tesseract.js runtime module. (The
    // `?url` worker/core asset imports below are bundled URLs — harmless.)
    expect(src).not.toMatch(/^import\s+[^'\n]*['"]tesseract\.js['"]/m)
    // The heavy CJS runtime is reached via dynamic import inside getWorker(),
    // which only runs on the first cover scan.
    expect(src).toMatch(/await\s+import\(['"]tesseract\.js['"]\)/)
  })

  it('CoverScanModal does not statically drag in OCR/Tesseract', async () => {
    const src = await readFile('src/components/CoverScanModal.jsx')
    // The cover modal only captures/downscales a photo; OCR runs in the parent
    // via the dynamic import. So mounting the modal never loads Tesseract.
    expect(src).not.toMatch(/^import\s+.*ocr/m)
    expect(src).not.toMatch(/^import\s+.*tesseract/m)
  })

  it('ScannerModal loads ZXing only when the modal itself loads (deferred)', async () => {
    const collectionSrc = await readFile('src/CollectionView.jsx')
    // The shell entry must not reference zxing-wasm anywhere.
    expect(collectionSrc).not.toContain('zxing-wasm')
    // ZXing lives only inside the lazy ScannerModal module.
    const scannerSrc = await readFile('src/components/ScannerModal.jsx')
    expect(scannerSrc).toMatch(/from\s+['"]zxing-wasm\/reader['"]/)
    expect(scannerSrc).toMatch(/zxing_reader\.wasm\?url/)
  })
})

describe('offline-first precache still holds the required scanner/OCR assets', () => {
  it('workbox globPatterns covers wasm + gz (scanner wasm + OCR traineddata)', async () => {
    const cfg = await readFile('vite.config.js')
    const glob = cfg.match(/globPatterns:\s*\[([^\]]*)\]/)?.[1] || ''
    expect(glob).toMatch(/wasm/) // scanner decoder precached for offline
    expect(glob).toMatch(/gz/) // Tesseract eng.traineddata.gz precached
  })

  it('precache cap is large enough for the OCR core + traineddata (no silent drop)', async () => {
    const cfg = await readFile('vite.config.js')
    // worker.min (~111 kB), zxing wasm (~1.1 MB), tesseract-core (~3.9 MB),
    // eng.traineddata.gz (~10.9 MB) all exceed Workbox's 2 MiB default — the
    // explicit 30 MB ceiling is what keeps them precached (offline capability).
    expect(cfg).toMatch(/maximumFileSizeToCacheInBytes:\s*30\s*\*\s*1024\s*\*\s*1024/)
  })

  it('self-hosted zxing wasm + tesseract worker/core/traineddata are wired (source-level)', async () => {
    const scannerSrc = await readFile('src/components/ScannerModal.jsx')
    // Self-hosted, same-origin WASM via ?url import + locateFile override.
    expect(scannerSrc).toMatch(/zxing_reader\.wasm\?url/)
    expect(scannerSrc).toMatch(/locateFile/)

    const ocrSrc = await readFile('src/utils/ocr.js')
    // Self-hosted worker + embedded core + English traineddata dir.
    expect(ocrSrc).toMatch(/tesseract\.js\/dist\/worker\.min\.js\?url/)
    expect(ocrSrc).toMatch(/tesseract-core-lstm\.wasm\.js\?url/)
    expect(ocrSrc).toMatch(/tessdata/)
    expect(ocrSrc).toMatch(/eng\.traineddata\.gz/)
  })

  it('Offline Architect boundary: the SW precache manifest includes the deferred assets (build output)', async () => {
    // Read the built service worker (produced by `npm run build`) and confirm
    // every deferred scanner/OCR asset is listed in the precache manifest.
    const { readdir } = await import('node:fs/promises')
    const path = (await import('node:path')).default
    const { fileURLToPath } = await import('node:url')
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
    const hasSw = await readdir(distDir).then((f) => f.includes('sw.js')).catch(() => false)
    // Only meaningful when dist/ exists (post-build). Skip cleanly otherwise so
    // `npm test` doesn't depend on a prior build.
    if (!hasSw) return
    const { readFile } = await import('node:fs/promises')
    const sw = await readFile(path.join(distDir, 'sw.js'), 'utf8')
    expect(sw).toMatch(/zxing_reader[^"']*\.wasm/)
    expect(sw).toMatch(/worker\.min[^"']*\.js/)
    expect(sw).toMatch(/tesseract-core-lstm\.wasm[^"']*\.js/)
    expect(sw).toMatch(/eng\.traineddata\.gz/)
  })

  it('the eager shell never includes zxing or tesseract chunk references (build output)', async () => {
    const path = (await import('node:path')).default
    const { fileURLToPath } = await import('node:url')
    const { readFile, readdir } = await import('node:fs/promises')
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
    const files = await readdir(distDir).catch(() => [])
    if (!files.includes('index.html')) return // requires `npm run build`
    const html = await readFile(path.join(distDir, 'index.html'), 'utf8')
    // Shell <script>/<link modulepreload> must reference scan/ocr chunks.
    expect(html).not.toContain('ScannerModal')
    expect(html).not.toContain('CoverScanModal')
    expect(html).not.toContain('.wasm')
    expect(html).not.toContain('tesseract')
    // But it does load the split shell chunks (index/vendor-react/vendor).
    expect(html).toMatch(/assets\/index-[^"']*\.js/)
    expect(html).toMatch(/assets\/vendor-react-[^"']*\.js/)
    expect(html).toMatch(/assets\/vendor-[^"']*\.js/)
  })
})
