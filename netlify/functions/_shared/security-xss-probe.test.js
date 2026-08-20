import { describe, it, expect } from 'vitest'
import { str, arrayOfStrings, isDangerousContent } from './security'
import { validateItem } from './item-fields'

// Independent Tester re-probe of the #409 XSS guard — adversarial cases that
// exercise the whole-class fail-closed guard and the genre/style array path.
describe('Tester probe #409 — array & whole-class XSS guard', () => {
  it('arrayOfStrings rejects script + onerror payloads in ANY entry', () => {
    const probes = [
      '<script>alert(1)</script>',
      '<SCRIPT SRC=x></SCRIPT>',
      '<img src=x onerror=alert(1)>',
      '<img src=x onError=alert(1)>', // case mix
      'x onerror=alert(1)',
      '<svg onload=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      'java&#x73;cript:alert(1)',
      '<scr&#x69;pt>alert(1)</scr&#x69;pt>',
      '<img src=x onmouseover=alert(1)>',
    ]
    for (const payload of probes) {
      expect(arrayOfStrings(['benign', payload], { max: 100, itemMax: 1000 }).error?.code, `array entry: ${payload}`)
        .toBe('HTML_REJECTED')
    }
  })

  it('scalar str() rejects the same class', () => {
    const probes = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<img src=x onfocusin=alert(1)>',
      '<video onloadedmetadata=alert(1)>',
      '<iframe src=evil></iframe>',
      '<object data=evil></object>',
      '<base href=evil>',
      '<meta http-equiv=refresh>',
      '<svg onload=alert(1)>',
      'javascript:alert(1)',
      'javascript \t: alert(1)', // whitespace between scheme and colon (covered by \s*)
      'x onerror=alert(1)',
      '<img src="> onerror=alert(1)">', // embedded-`>` trick
    ]
    for (const payload of probes) {
      expect(str(payload).error?.code, `scalar: ${payload}`).toBe('HTML_REJECTED')
    }
  })

  it('validateItem rejects array payloads via POST-like whole item', () => {
    expect(validateItem({ title: 'A', genre: ['<script>alert(1)</script>'] }).error.code).toBe('HTML_REJECTED')
    expect(validateItem({ title: 'A', style: ['x onerror=alert(1)'] }).error.code).toBe('HTML_REJECTED')
    expect(validateItem({ title: 'A', genre: ['Rock', '<img src=x onerror=alert(1)>'] }).error.code).toBe('HTML_REJECTED')
    // hostile entry in a mixed array must still reject the whole write
    const r = validateItem({ title: 'A', genre: ['Rock', 'Jazz', '<script>alert(1)</script>'] })
    expect(r.error.code).toBe('HTML_REJECTED')
  })

  it('benign array/scalar text still validates (no false positives)', () => {
    expect(arrayOfStrings(['Rock', 'Jazz', 'Funk', 'one = two', 'a > b, c < d'])).toEqual({
      value: ['Rock', 'Jazz', 'Funk', 'one = two', 'a > b, c < d'],
    })
    expect(str('only the ongoing = now')).toEqual({ value: 'only the ongoing = now' })
    expect(str('notes on monday = fun')).toEqual({ value: 'notes on monday = fun' })
    expect(isDangerousContent('plain text')).toBe(false)
    expect(isDangerousContent('C# is a language, a<b but a&b')).toBe(false)
  })
})
