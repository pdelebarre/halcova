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

  it('rejects arbitrary hosts — the SSRF guard', () => {
    expect(isAllowedCoverHost('example.com')).toBe(false)
    expect(isAllowedCoverHost('evil.com')).toBe(false)
    expect(isAllowedCoverHost('127.0.0.1')).toBe(false)
    expect(isAllowedCoverHost('localhost')).toBe(false)
    expect(isAllowedCoverHost('')).toBe(false)
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
