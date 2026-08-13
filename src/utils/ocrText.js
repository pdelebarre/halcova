// PURE OCR-text → search query + barcode extraction. No Tesseract import here
// (deliberately dependency-free so it's trivially unit-testable and safe to
// import anywhere). Consumes the flat `{ text, confidence, bbox }` lines that
// `src/utils/ocr.js` produces and returns something `searchByText` /
// `searchByBarcode` can run directly.

// Confidence floor for a line to count as "readable" (Tesseract reports
// 0–100; printed cover text we care about lands well above 60).
const MIN_CONFIDENCE = 60

// Junk lines: copyright / phonogram / trademark notices, rights boilerplate,
// production credits and other small print that OCR reliably misreads as
// "content". A match means the line is dropped from the query ranking.
const JUNK_PATTERNS = [
  /©/,
  /℗/,
  /®/,
  /™/,
  /ALL RIGHTS RESERVED/i,
  /ALL RIGHTS/i,
  /COPYRIGHT/i,
  /PRODUCED BY/i,
  /RECORDED (AT|BY|IN)/i,
  /PRESSED (AT|BY|IN)/i,
  /DISTRIBUTED BY/i,
  /PUBLISHED BY/i,
  /MADE IN/i,
  /PRINTED IN/i,
  /MANUFACTURED BY/i,
  /\.{3,}/, // "…" ellipsis separators in small print
]

// Visible barcode / ISBN on the cover — 9–13 digits plus an optional trailing
// check digit X (10–14 chars total: EAN-13, UPC-A, ISBN-10/13). A bare 9-digit
// run is only treated as a barcode when it carries the X check digit — that's
// the ISBN-10-with-X shape ("0 14 028333 X"); a plain 9-digit run is ambiguous
// with a truncated UPC/EAN-8 and must not be flagged. Covers print these big
// enough that OCR reads them well, and a barcode is authoritative.
const BARCODE_RE = /[0-9]{10,13}[Xx]?|[0-9]{9}[Xx]/

// A barcode line once its spaces/hyphens are stripped: OCR often reads the
// digits of a code with gaps ("0 76732-57341-2 9").
function isBarcodeLine(text) {
  return BARCODE_RE.test(String(text).replace(/[^0-9Xx]/g, ''))
}

// First barcode found across lines (barcodes live on their own line on a
// cover, so this avoids the cross-line concatenation pitfall of gluing a
// copyright year onto the code).
function findBarcode(all) {
  for (const l of all) {
    const stripped = String(l.text).replace(/[^0-9Xx]/g, '')
    const m = stripped.match(BARCODE_RE)
    if (m) return m[0].replace(/[^0-9Xx]/g, '')
  }
  return ''
}

function isJunk(text) {
  const trimmed = String(text).trim()
  if (!trimmed) return true
  // A lone year ("1978") or a label/catno fragment ("ST-61234") is small
  // print, not the artist/title we're after.
  if (/^[0-9]{4}$/.test(trimmed)) return true
  if (/^[A-Z0-9]{2,5}[- ][0-9]{3,6}$/.test(trimmed)) return true
  return JUNK_PATTERNS.some((re) => re.test(text))
}

// Rank lines by how much cover they occupy — covers print the artist + title
// biggest, so area is the strongest proxy for "the important line". Falls back
// to a width × length proxy when bbox is missing.
function lineArea(line) {
  const b = line.bbox || {}
  if (b.width && b.height) return b.width * b.height
  if (typeof b.x0 === 'number' && typeof b.x1 === 'number') {
    return Math.max(1, b.x1 - b.x0) * Math.max(1, line.text.length)
  }
  return line.text ? line.text.length * 10 : 0
}

/**
 * Turn Tesseract line output into a text-search query (plus any barcode the
 * cover shows). Returns `{ query, barcode }`; both are empty strings when
 * nothing readable comes through — we never fabricate a search from noise.
 *
 * @param {Array<{text:string, confidence?:number, bbox?:object}>} lines
 * @param {'records'|'books'} kind
 */
export function extractSearchQuery(lines, kind) {
  const all = Array.isArray(lines) ? lines.filter((l) => l && typeof l.text === 'string') : []

  // Barcode detection runs over EVERY line, not just the high-confidence ones —
  // a printed code is authoritative even when OCR is fuzzy about the text.
  const barcode = findBarcode(all)

  const usable = all
    .filter((l) => !isBarcodeLine(l.text))
    .filter((l) => l.confidence == null || l.confidence >= MIN_CONFIDENCE)
    .filter((l) => !isJunk(l.text))

  if (usable.length === 0) return { query: '', barcode }

  const [first, second] = [...usable].sort((a, b) => lineArea(b) - lineArea(a)).slice(0, 2)

  if (kind === 'books') {
    // Book covers put the title biggest, with the author just underneath.
    const title = first.text.trim()
    const author = second ? second.text.trim() : ''
    return { query: [title, author].filter(Boolean).join(' '), barcode }
  }

  // Records: the artist name is usually the most prominent line, title second.
  // If only one line survived, it becomes the whole query.
  const artist = first.text.trim()
  const title = second ? second.text.trim() : ''
  return { query: [artist, title].filter(Boolean).join(' '), barcode }
}
