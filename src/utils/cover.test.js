import { describe, expect, it } from 'vitest'
import { proxyCoverUrl } from './cover'

const DISC = '/.netlify/functions/discogs'
const BOOKS = '/.netlify/functions/books'

describe('proxyCoverUrl', () => {
  it('rewrites an https cover to the proxy with action=cover and the encoded url', () => {
    const cover = 'https://i.discogs.com/hash/image-1.jpeg'
    const expected = `${DISC}?action=cover&url=${encodeURIComponent(cover)}`
    expect(proxyCoverUrl(DISC, cover)).toBe(expected)
  })

  it('uses the books proxy path for books covers', () => {
    const cover = 'https://books.google.com/books/content?id=abc&printsec=frontcover'
    const expected = `${BOOKS}?action=cover&url=${encodeURIComponent(cover)}`
    expect(proxyCoverUrl(BOOKS, cover)).toBe(expected)
  })

  it('leaves missing covers empty', () => {
    expect(proxyCoverUrl(DISC, '')).toBe('')
    expect(proxyCoverUrl(DISC, null)).toBe('')
    expect(proxyCoverUrl(DISC, undefined)).toBe('')
  })

  it('drops unsafe or malformed covers without throwing', () => {
    expect(proxyCoverUrl(DISC, 'not a url')).toBe('')
    expect(proxyCoverUrl(DISC, 'javascript:alert(1)')).toBe('')
    // http:// covers (mixed content) are not proxied — never crash on them.
    expect(proxyCoverUrl(DISC, 'http://i.discogs.com/hash/image-1.jpeg')).toBe('')
  })

  it('drops other non-https schemes — data:, ftp: and protocol-relative URLs', () => {
    expect(proxyCoverUrl(DISC, 'data:text/html,<script>alert(1)</script>')).toBe('')
    expect(proxyCoverUrl(DISC, 'ftp://i.discogs.com/hash/image-1.jpeg')).toBe('')
    // Protocol-relative (scheme-less) has no https protocol to vouch for.
    expect(proxyCoverUrl(DISC, '//i.discogs.com/hash/image-1.jpeg')).toBe('')
  })

  it('drops a non-string truthy cover without throwing', () => {
    expect(proxyCoverUrl(DISC, 42)).toBe('')
    expect(proxyCoverUrl(DISC, { url: 'https://i.discogs.com/x.jpeg' })).toBe('')
  })
})
