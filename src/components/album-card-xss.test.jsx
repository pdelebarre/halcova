// SEC-3.3 (#196) — stored-XSS attack surface regression.
//
// A source-wide grep for unsafe sinks (dangerouslySetInnerHTML, innerHTML,
// document.write, eval) across src/ returns nothing — the app renders every
// user/import-controlled string (titles, notes, names, reviews, genres) as JSX
// text, which React escapes. This test locks that in for the most common
// import-controlled string (an item title) and the album artist split from it:
// a malicious `<img onerror=…>` payload must render as inert, escaped text and
// must NOT be executed.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AlbumCard from './AlbumCard'

// A realistic stored-XSS payload in a catalog title. If the title were ever
// rendered as HTML, this would execute window.__xss = 1 and inject an <img>.
const PAYLOAD_TITLE = '<img src=x onerror="window.__xss=1">'
const PAYLOAD_NOTE = '<svg/onload=alert(1)>'

describe('SEC-3.3 (#196) — imported/user-controlled strings render inert', () => {
  it('a malicious title is rendered as escaped text, never executed', () => {
    const { container } = render(
      <AlbumCard
        item={{ title: `Artist - ${PAYLOAD_TITLE}`, formatType: 'LP' }}
        onOpen={() => {}}
      />,
    )

    // The payload must NOT inject a real <img> element.
    expect(container.querySelector('img')).toBeNull()
    // The onerror handler must never run.
    expect(window.__xss).toBeUndefined()
    // The payload appears as literal TEXT (React-escaped), not markup.
    expect(container.textContent).toContain(PAYLOAD_TITLE)
  })

  it('a malicious string in the artist/album split is also escaped', () => {
    const { container } = render(
      <AlbumCard
        item={{ title: `${PAYLOAD_NOTE} - Some Album`, formatType: 'LP' }}
        onOpen={() => {}}
      />,
    )
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toContain(PAYLOAD_NOTE)
  })
})
