// Thin, guarded helpers for exporting the persona share card as a
// self-contained SVG file (release 1.1 — no new dependency, `[VALIDATE]` #5).
// The card renders as inline SVG in the DOM; export serializes that same
// markup to a standalone file. Never throws (dark-screen safety).

const SVG_NS = 'http://www.w3.org/2000/svg'
const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350

/**
 * Serialize a rendered SVG node into a standalone SVG string with explicit
 * width/height (the in-DOM card is responsive via viewBox; the exported file
 * needs physical dimensions). Returns '' on any failure — never throws.
 */
export function serializeSvgNode(node) {
  try {
    if (!node || typeof node.cloneNode !== 'function') return ''
    const clone = node.cloneNode(true)
    clone.setAttribute('xmlns', SVG_NS)
    clone.setAttribute('width', String(CARD_WIDTH))
    clone.setAttribute('height', String(CARD_HEIGHT))
    return new XMLSerializer().serializeToString(clone)
  } catch {
    return ''
  }
}

/**
 * Trigger a browser download of an SVG node as a .svg file. Returns true on
 * success, false on any failure (no endpoint, missing APIs, etc.) — never
 * throws. Callers own any tracking side effects.
 */
export function downloadSvg(node, filename = 'halcova-persona.svg') {
  try {
    const svg = serializeSvgNode(node)
    if (!svg) return false
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
