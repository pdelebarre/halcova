import { describe, expect, it } from 'vitest'
import { isDangerousContent, sanitizeForRender, sanitizeForRenderWithFallback } from '../utils/isDangerousContent'

describe('isDangerousContent', () => {
  // Safe strings
  it('returns false for a plain text string', () => {
    expect(isDangerousContent('Kind of Blue')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isDangerousContent('')).toBe(false)
  })

  it('returns false for alphanumeric strings with punctuation', () => {
    expect(isDangerousContent('Miles Davis - Kind of Blue (1959) [LP]')).toBe(false)
  })

  it('returns false for strings with numbers and symbols', () => {
    expect(isDangerousContent('0767325734129')).toBe(false)
  })

  it('returns false for title with ampersand', () => {
    expect(isDangerousContent('Tom & Jerry')).toBe(false)
  })

  // Dangerous strings - fail closed
  it('returns true for null', () => {
    expect(isDangerousContent(null)).toBe(true)
  })

  it('returns true for undefined', () => {
    expect(isDangerousContent(undefined)).toBe(true)
  })

  it('returns true for non-string values (numbers)', () => {
    expect(isDangerousContent(123)).toBe(true)
  })

  it('returns true for non-string values (objects)', () => {
    expect(isDangerousContent({})).toBe(true)
  })

  // XSS vectors
  it('detects HTML tags in strings', () => {
    expect(isDangerousContent('<script>alert("xss")</script>')).toBe(true)
  })

  it('detects event handlers', () => {
    expect(isDangerousContent('Click me onmouseover="evil()"')).toBe(true)
  })

  it('detects javascript: URIs', () => {
    expect(isDangerousContent('javascript:alert(1)')).toBe(true)
  })

  it('detects data: URIs with text/html', () => {
    expect(isDangerousContent('data:text/html,<script>alert(1)</script>')).toBe(true)
  })

  it('detects vbscript: URIs', () => {
    expect(isDangerousContent('vbscript:msgbox("xss")')).toBe(true)
  })

  it('detects document.cookie access', () => {
    expect(isDangerousContent('document.cookie')).toBe(true)
  })

  it('detects document.location access', () => {
    expect(isDangerousContent('document.location="http://evil.com"')).toBe(true)
  })

  it('detects window.location access', () => {
    expect(isDangerousContent('window.location.href="http://evil.com"')).toBe(true)
  })

  it('detects eval() calls', () => {
    expect(isDangerousContent('eval("malicious code")')).toBe(true)
  })

  it('detects HTML-encoded tags (&lt;)', () => {
    expect(isDangerousContent('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(true)
  })
})

describe('sanitizeForRender', () => {
  it('returns the string when safe', () => {
    expect(sanitizeForRender('Kind of Blue')).toBe('Kind of Blue')
  })

  it('returns empty string when dangerous', () => {
    expect(sanitizeForRender('<script>alert(1)</script>')).toBe('')
  })

  it('returns empty string for null', () => {
    expect(sanitizeForRender(null)).toBe('')
  })
})

describe('sanitizeForRenderWithFallback', () => {
  it('returns the string when safe', () => {
    expect(sanitizeForRenderWithFallback('Kind of Blue')).toBe('Kind of Blue')
  })

  it('returns the fallback when dangerous', () => {
    expect(sanitizeForRenderWithFallback('<script>alert(1)</script>')).toBe('[...]')
  })

  it('returns the custom fallback when dangerous', () => {
    expect(sanitizeForRenderWithFallback('<script>alert(1)</script>', '[unsafe]')).toBe('[unsafe]')
  })

  it('returns fallback for null', () => {
    expect(sanitizeForRenderWithFallback(null, '[unknown]')).toBe('[unknown]')
  })
})