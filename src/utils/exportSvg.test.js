import { describe, expect, it } from 'vitest'
import { serializeSvgNode } from './exportSvg'

describe('serializeSvgNode (leak-safe SVG export)', () => {
  it('drops on* and data-* attributes from the exported string (root + nested)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('data-secret', 'RU-1234-5678-9012')
    svg.setAttribute('onclick', 'alert(1)')
    svg.setAttribute('id', 'keep-me')

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('data-isbn', '9783161484100')
    g.setAttribute('onmouseover', 'steal()')
    svg.appendChild(g)

    const out = serializeSvgNode(svg)
    // Allowed attributes survive.
    expect(out).toContain('id="keep-me"')
    // Handlers and data attributes are stripped everywhere.
    expect(out).not.toContain('data-secret')
    expect(out).not.toContain('data-isbn')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onmouseover')
  })

  it('emits a standalone card with xmlns/width/height and returns "" for a non-node', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const out = serializeSvgNode(svg)
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('width="1080"')
    expect(out).toContain('height="1350"')
    expect(serializeSvgNode(null)).toBe('')
    expect(serializeSvgNode({})).toBe('')
  })
})
