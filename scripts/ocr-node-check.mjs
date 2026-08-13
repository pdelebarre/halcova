// Quick verification that the SELF-HOSTED OCR path (embedded-wasm LSTM core +
// @tesseract.js-data/eng gz data + recognize with blocks) actually returns
// readable lines. Runs in Node with the node adapter — the browser worker path
// is verified separately (see scripts/ocr-check.html).
import { createWorker } from 'tesseract.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Synthetic cover: artist big + title below, light text on dark (like a sleeve).
const svg = Buffer.from(`
<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="600" fill="#16130F"/>
  <text x="400" y="280" font-family="Arial, Helvetica, sans-serif" font-size="96"
        font-weight="bold" fill="#FFFFFF" text-anchor="middle">Miles Davis</text>
  <text x="400" y="380" font-family="Arial, Helvetica, sans-serif" font-size="56"
        fill="#C9A227" text-anchor="middle">Kind of Blue</text>
</svg>
`)

const png = await sharp(svg).png().toBuffer()

// Self-hosted assets — the SAME files the built app precaches.
const data = new Uint8Array(
  await readFile(fileURLToPath(new URL('../node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', import.meta.url))),
)

const worker = await createWorker(
  [{ code: 'eng', data }],
  1, // LSTM_ONLY
  { gzip: true, logger: () => {}, errorHandler: (e) => console.log('worker errorHandler:', e) },
)

const t0 = Date.now()
const { data: res } = await worker.recognize(png, {}, { text: true, blocks: true })
console.log('OCR took', Date.now() - t0, 'ms')
console.log('TEXT:\n' + res.text)

const lines = []
for (const block of res.blocks || []) {
  for (const p of block.paragraphs || []) {
    for (const l of p.lines || []) {
      if (l && typeof l.text === 'string' && l.text.trim()) {
        lines.push({ text: l.text, confidence: l.confidence })
      }
    }
  }
}
console.log('LINES:', JSON.stringify(lines, null, 2))
await worker.terminate()
process.exit(0)
