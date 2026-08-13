// Verify the FIXED self-hosting approach: string 'eng' + langPath directory
// containing eng.traineddata.gz (gzip:true). This is the well-supported v7
// form — initialize gets 'eng', not stringified traineddata bytes.
import { createWorker } from 'tesseract.js'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
// Self-hosted tessdata dir (like public/tessdata in the real app).
const tessDir = mkdtempSync(join(tmpdir(), 'tessdata-'))
copyFileSync(
  join(here, '../node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),
  join(tessDir, 'eng.traineddata.gz'),
)

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

const worker = await createWorker('eng', 1, {
  langPath: tessDir,
  gzip: true,
  logger: () => {},
  errorHandler: (e) => console.log('worker errorHandler:', e),
})

const { data: res } = await worker.recognize(png, {}, { text: true, blocks: true })
console.log('TEXT:\n' + res.text)
const lines = []
for (const b of res.blocks || []) {
  for (const p of b.paragraphs || []) {
    for (const l of p.lines || []) {
      if (l && typeof l.text === 'string' && l.text.trim()) lines.push({ text: l.text, confidence: l.confidence })
    }
  }
}
console.log('LINES:', JSON.stringify(lines, null, 2))
await worker.terminate()
process.exit(0)
