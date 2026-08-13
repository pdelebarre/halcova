// On-device cover OCR via Tesseract.js. Lazily spins up ONE worker on first
// use and reuses it — the wasm core + English traineddata are the expensive
// part, so they load once, not per scan.
//
// Asset loading (all self-hosted, no third-party CDN at runtime):
// - The worker script (`tesseract.js/dist/worker.min.js`) and the LSTM core
//   (`tesseract-core-lstm.wasm.js`, whose wasm is EMBEDDED as base64 so there
//   is no separate .wasm fetch) come through Vite `?url` imports and are
//   precached by the service worker.
// - The English traineddata lives at `public/tessdata/eng.traineddata.gz`,
//   served at `/tessdata/eng.traineddata.gz` and precached via the `gz` entry
//   in vite.config.js workbox globPatterns. The worker fetches it with
//   `gzip: true` and gunzips it in-thread.
//
// WHY the language is passed as the STRING `'eng'` and not a `Lang` object:
// tesseract.js v7's `createWorker` advertises `[{ code, data }]` in its types,
// but its `initialize` handler builds the language string with
// `_langs.map((l) => l.data).join('+')` — i.e. it stringifies the raw
// traineddata bytes as the language name. `api.Init` then fails, and because
// the worker-init promise chain swallows errors with `.catch(() => {})`, the
// `createWorker` promise NEVER settles → the first cover scan hangs forever on
// "Looking it up…". Passing the string `'eng'` with a self-hosted `langPath`
// is the supported form and works on both loadLanguage and initialize.
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'

// OCR Engine Mode: LSTM_ONLY — the accurate engine shipped by the embedded
// `tesseract-core-lstm.wasm.js` core (works on every browser with WebAssembly,
// iOS Safari included).
const OEM_LSTM_ONLY = 1

// Self-hosted English traineddata directory (public/tessdata/eng.traineddata.gz).
// The worker fetches `${langPath}/eng.traineddata.gz` itself.
const LANG_PATH = `${import.meta.env.BASE_URL}tessdata`

// Hard ceiling for a single OCR step so a wedged worker (network stall, hung
// wasm init) surfaces as an error instead of an eternal spinner.
const OCR_TIMEOUT_MS = 45_000

// Race `promise` against a timeout; rejects with a coded Error so the caller
// can map it to user-facing copy. Clears the timer either way.
function withTimeout(promise, ms, code) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('OCR timed out')
      err.code = code
      reject(err)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// One shared worker, created on first call. Reset on failure so a later retry
// re-initializes instead of silently reusing a broken worker.
let workerPromise = null

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Heavy CJS dependency — pulled in only when OCR is actually used.
      const { createWorker } = await import('tesseract.js')
      // `workerBlobURL: false` keeps the worker a plain same-origin classic
      // worker so its internal `importScripts(corePath)` stays same-origin.
      // `errorHandler` must be supplied: without it tesseract.js v7 throws an
      // uncaught main-thread error on ANY job rejection (not just 'load').
      return withTimeout(
        createWorker('eng', OEM_LSTM_ONLY, {
          workerPath: workerUrl,
          // Ends in `.js` → the worker uses it verbatim (no SIMD detection).
          corePath: coreUrl,
          langPath: LANG_PATH,
          workerBlobURL: false,
          gzip: true,
          logger: () => {}, // keep the progress chatter quiet
          errorHandler: () => {}, // never let a job rejection escape as an uncaught throw
        }),
        OCR_TIMEOUT_MS,
        'OCR_TIMEOUT',
      )
    })()
    // Swallow-and-reset so an init failure doesn't leave an unhandled
    // rejection, and the next call gets a fresh attempt.
    workerPromise.catch(() => { workerPromise = null })
  }
  return workerPromise
}

// Tesseract's `blocks` output is a block → paragraph → line tree. Flatten it
// to the flat `{ text, confidence, bbox }` lines `extractSearchQuery` expects.
// Defensive: never assumes the tree is well-formed (no error boundary).
function flattenLines(blocks) {
  const lines = []
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
      for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
        if (line && typeof line.text === 'string' && line.text.trim()) {
          lines.push({ text: line.text, confidence: line.confidence, bbox: line.bbox })
        }
      }
    }
  }
  return lines
}

/**
 * OCR a cover image (Blob/File) on-device.
 *
 * @param {Blob} blob - A JPEG/PNG cover image, e.g. from a camera frame or
 *   gallery pick (CoverScanModal hands this over after downscaling).
 * @returns {Promise<{ text: string, lines: Array<{text,confidence,bbox}> }>}
 *   Rejects with `{ code: 'OCR_TIMEOUT' }` if a step exceeds OCR_TIMEOUT_MS.
 */
export async function recognizeImage(blob) {
  const worker = await getWorker()
  // `blocks: true` is what v7 uses to hand back the line tree (`data.lines` no
  // longer exists as a top-level convenience in Tesseract.js ≥ 6).
  const { data } = await withTimeout(
    worker.recognize(blob, {}, { text: true, blocks: true }),
    OCR_TIMEOUT_MS,
    'OCR_TIMEOUT',
  )
  return { text: data?.text || '', lines: flattenLines(data?.blocks) }
}
