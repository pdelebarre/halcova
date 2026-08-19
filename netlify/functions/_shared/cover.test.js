// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isAllowedCoverHost, isAllowedCoverUrl, coverCacheKey } from './cover'

describe('isAllowedCoverHost', () => {
  it('allows the Discogs image CDN and its legacy hosts', () => {
    expect(isAllowedCoverHost('i.discogs.com')).toBe(true)
    expect(isAllowedCoverHost('st.discogs.com')).toBe(true)
    expect(isAllowedCoverHost('img.discogs.com')).toBe(true)
    expect(isAllowedCoverHost('discogs.com')).toBe(true)
  })

  it('allows the Google Books and Amazon cover hosts', () => {
    expect(isAllowedCoverHost('books.google.com')).toBe(true)
    expect(isAllowedCoverHost('images-na.ssl-images-amazon.com')).toBe(true)
    expect(isAllowedCoverHost('m.media-amazon.com')).toBe(true)
  })

  it('allows Cover Art Archive hosts (MusicBrainz fallback covers, RES-1.2 T2)', () => {
    expect(isAllowedCoverHost('coverartarchive.org')).toBe(true)
  })

  it('allows the OpenLibrary cover host (books fallback covers, RES-1.3 T3)', () => {
    expect(isAllowedCoverHost('covers.openlibrary.org')).toBe(true)
  })

  it('rejects arbitrary hosts — the SSRF guard', () => {
    expect(isAllowedCoverHost('example.com')).toBe(false)
    expect(isAllowedCoverHost('evil.com')).toBe(false)
    expect(isAllowedCoverHost('127.0.0.1')).toBe(false)
    expect(isAllowedCoverHost('localhost')).toBe(false)
    expect(isAllowedCoverHost('')).toBe(false)
    // Subdomains or suffix tricks of coverartarchive are NOT allowed.
    expect(isAllowedCoverHost('coverartarchive.org.evil.com')).toBe(false)
    // Subdomains or suffix tricks of covers.openlibrary.org are NOT allowed.
    expect(isAllowedCoverHost('covers.openlibrary.org.evil.com')).toBe(false)
    expect(isAllowedCoverHost('openlibrary.org')).toBe(false) // only the cover host, not the API
  })

  it('matches the Discogs suffix on a dot boundary only', () => {
    expect(isAllowedCoverHost('discogs.com.evil.com')).toBe(false)
    expect(isAllowedCoverHost('notdiscogs.com')).toBe(false)
    expect(isAllowedCoverHost('i.discogs.com.evil.com')).toBe(false)
  })
})

describe('isAllowedCoverUrl', () => {
  it('accepts https covers from an allowed host', () => {
    expect(isAllowedCoverUrl('https://i.discogs.com/hash/image-1.jpeg')).toBe(true)
    expect(isAllowedCoverUrl('https://books.google.com/books/content?id=abc&printsec=frontcover')).toBe(true)
  })

  it('accepts Cover Art Archive covers (RES-1.2 T2 #288) but only https + exact host', () => {
    expect(isAllowedCoverUrl('https://coverartarchive.org/release/b7f9f0b2-6a5d-4d24-8f4a-0f0e3c1c9a12/front-250')).toBe(true)
    expect(isAllowedCoverUrl('http://coverartarchive.org/release/x/front-250')).toBe(false)
    expect(isAllowedCoverUrl('https://coverartarchive.org.evil.com/x.jpg')).toBe(false)
  })

  it('accepts OpenLibrary covers (RES-1.3 T3 #283) but only https + exact host', () => {
    expect(isAllowedCoverUrl('https://covers.openlibrary.org/b/id/8654919-M.jpg')).toBe(true)
    expect(isAllowedCoverUrl('http://covers.openlibrary.org/b/id/1-M.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://covers.openlibrary.org.evil.com/x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://openlibrary.org/b/id/1-M.jpg')).toBe(false) // API host is not a cover host
  })

  it('rejects non-https covers even on an allowed host', () => {
    expect(isAllowedCoverUrl('http://i.discogs.com/hash/image-1.jpeg')).toBe(false)
  })

  it('rejects hosts off the allowlist', () => {
    expect(isAllowedCoverUrl('https://example.com/cat.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://127.0.0.1/secret.png')).toBe(false)
    expect(isAllowedCoverUrl('https://i.discogs.com.evil.com/x.jpg')).toBe(false)
  })

  it('rejects missing and malformed URLs without throwing', () => {
    expect(isAllowedCoverUrl('')).toBe(false)
    expect(isAllowedCoverUrl(null)).toBe(false)
    expect(isAllowedCoverUrl(undefined)).toBe(false)
    expect(isAllowedCoverUrl('not a url')).toBe(false)
  })

  // ---- SEC-6.3 (#217) — comprehensive SSRF edge cases. ----
  it('rejects scheme confusion and protocol-relative URLs', () => {
    expect(isAllowedCoverUrl('//i.discogs.com/x.jpg')).toBe(false) // protocol-relative (invalid)
    expect(isAllowedCoverUrl('http://i.discogs.com/x.jpg')).toBe(false) // downgraded
    expect(isAllowedCoverUrl('ftp://i.discogs.com/x.jpg')).toBe(false)
    // NOTE: WHATWG normalizes a single-slash "https:/host" to "https://host",
    // and the ALLOWLIST is then applied to the NORMALIZED hostname (i.discogs.com),
    // so it is allowed but the connect host is still i.discogs.com — not a bypass.
    expect(isAllowedCoverUrl('https:/i.discogs.com/x.jpg')).toBe(true)
  })

  it('rejects private / link-local / loopback IP hosts', () => {
    const ipTargets = [
      'https://127.0.0.1/x.png',
      'https://localhost/x.png',
      'https://0.0.0.0/x.png',
      'https://169.254.169.254/latest/meta-data/', // cloud metadata
      'https://10.0.0.1/x.png', // RFC1918
      'https://192.168.1.1/x.png',
      'https://172.16.0.1/x.png',
      'https://[::1]/x.png', // IPv6 loopback
      'https://[fd00::1]/x.png', // IPv6 ULA
      // Percent-encoded dots in an IP host are normalized, then still rejected.
      'https://127%2e0%2e0%2e1/x.png',
    ]
    for (const url of ipTargets) expect(isAllowedCoverUrl(url)).toBe(false)
  })

  it('rejects look-alike / suffix-bypass hosts', () => {
    const lookalikes = [
      'https://evil-discogs.com/x.jpg',
      'https://discogs.com.evil.com/x.jpg',
      'https://i.discogs.com.evil.com/x.jpg',
      'https://notdiscogs.com/x.jpg',
      'https://discogs.com.attacker.io/x.jpg',
      'https://books.google.com.evil.com/x.jpg',
      'https://m.media-amazon.com.attacker.io/x.jpg',
    ]
    for (const url of lookalikes) expect(isAllowedCoverUrl(url)).toBe(false)
  })

  it('rejects encoded/punycode/trailing-dot host tricks', () => {
    // Encoded dots in a NON-allowlisted host normalize to the evil host and are
    // rejected by the allowlist.
    expect(isAllowedCoverUrl('https://i.discogs.com%2eevil.com/x.jpg')).toBe(false)
    // Punycode / trailing-dot hosts are never allowlisted.
    expect(isAllowedCoverUrl('https://xn--i-9qba.example/x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://i.discogs.com./x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://i.discogs.com%2e/x.jpg')).toBe(false)
    // NOTE: an encoded dot WITHIN an allowlisted host normalizes to a real dot
    // (i%2ediscogs.com -> i.discogs.com), so it is allowed — but the connect
    // host is still the allowlisted domain (normalization is applied before the
    // allowlist check), so this is not a bypass.
    expect(isAllowedCoverUrl('https://i%2ediscogs.com/x.jpg')).toBe(true)
  })

  it('does NOT let userinfo (user@host) smuggle a different connect host', () => {
    // userinfo points at an evil host but the actual connect host is evil.com —
    // must be rejected.
    expect(isAllowedCoverUrl('https://i.discogs.com@evil.com/x.jpg')).toBe(false)
    // userinfo on an allowed host does not change the connect host (still
    // i.discogs.com) — not a bypass, but document the behavior.
    expect(isAllowedCoverUrl('https://attacker@i.discogs.com/x.jpg')).toBe(true)
  })

  it('treats backslashes as slashes (WHATWG) without changing the connect host', () => {
    // For special schemes WHATWG normalizes backslashes to slashes, so the
    // host is still i.discogs.com (allowlisted) and the path gets the rest.
    expect(isAllowedCoverUrl('https://i.discogs.com\\@evil.com/x.jpg')).toBe(true)
    // But a backslash that ends the authority keeps the allowed host; the
    // alternate form below resolves to an evil HOST and must be rejected.
    expect(isAllowedCoverUrl('https://evil.com\\@i.discogs.com/x.jpg')).toBe(false)
  })
})

describe('coverCacheKey', () => {
  it('hashes the URL into a stable, fixed-size key', () => {
    const a = coverCacheKey('https://i.discogs.com/hash/image-1.jpeg')
    const b = coverCacheKey('https://i.discogs.com/hash/image-1.jpeg')
    const c = coverCacheKey('https://i.discogs.com/hash/image-2.jpeg')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^cover:[0-9a-f]{64}$/)
  })
})
