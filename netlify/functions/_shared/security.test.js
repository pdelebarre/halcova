// @vitest-environment node
//
// Tests for the shared web-security + validation module (SEC-EPIC-3):
//   - SEC-3.4 (#197): security headers are present on every JSON response.
//   - SEC-3.7 (#200): a thrown error surfaces as a generic 500 INTERNAL, never
//     the internal message/stack; request id echo is sanitized.
//   - SEC-3.2 (#195): oversized bodies → 413, malformed JSON → 400.
//   - SEC-3.1 (#194): validators reject type mismatch / over-length / out-of-
//     enum / junk / unknown (protected) fields with clean { error, code }.

import { describe, expect, it, vi } from 'vitest'
import {
  arrayOfStrings,
  badRequest,
  boolean,
  check,
  inEnum,
  intInRange,
  json,
  readJsonBody,
  rejectUnknown,
  requestId,
  safeError,
  securityHeaders,
  str,
} from './security'

describe('SEC-3.4 (#197) — security headers on JSON responses', () => {
  it('the json responder carries the full security header set', async () => {
    const res = json(200, { ok: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()')
  })

  it('caller headers can extend/override the security defaults', () => {
    const res = json(429, { error: 'x', code: 'RATE_LIMIT' }, { 'Retry-After': '5' })
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('SEC-3.7 (#200) — safe error responses', () => {
  it('a thrown error becomes a generic 500 INTERNAL, never the internal message', async () => {
    const err = new Error('syntax error at or near "DROP" near connection')
    const res = safeError(err, { headers: { get: () => null } })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL')
    expect(body.error).not.toContain('DROP')
    expect(body.error).not.toContain('syntax error')
    expect(body.error).toBe('Something went wrong. Please try again.')
  })

  it('safeError scrubs secrets from the logged message (NIT M5)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const err = new Error('lookup failed for RU-ABCD-EFGH-JKLM and sk_live_1234567890abcdef')
      safeError(err, { headers: { get: () => null } })
      const logged = spy.mock.calls[0].join(' ')
      expect(logged).not.toContain('RU-ABCD-EFGH-JKLM')
      expect(logged).not.toContain('sk_live_1234567890abcdef')
      expect(logged).toContain('REDACTED')
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('echoes a safe request id and strips an unsafe one', () => {
    const safe = safeError(new Error('x'), { headers: { get: () => 'abc-123_9' } })
    expect(safe.headers.get('X-Request-Id')).toBe('abc-123_9')
    const dirty = safeError(new Error('x'), { headers: { get: () => 'bad\r\nInjected: 1' } })
    expect(dirty.headers.get('X-Request-Id')).toBeNull()
  })

  it('requestId accepts only a safe charset', () => {
    expect(requestId({ headers: { get: () => 'a-b_c.9' } })).toBe('a-b_c.9')
    expect(requestId({ headers: { get: () => 'bad\r\nx: 1' } })).toBeNull()
    expect(requestId({ headers: { get: () => '' } })).toBeNull()
    expect(requestId({ headers: { get: () => 'a'.repeat(100) } })).toBeNull()
  })
})

describe('SEC-3.2 (#195) — request body size limits', () => {
  const req = (raw) => ({ text: async () => raw })

  it('accepts a body under the cap', async () => {
    const { value } = await readJsonBody(req('{"ok":true}'))
    expect(value).toEqual({ ok: true })
  })

  it('rejects an oversized body with 413 PAYLOAD_TOO_LARGE before parsing', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(70 * 1024) })
    const { error } = await readJsonBody(req(big))
    expect(error.status).toBe(413)
    const body = await error.json()
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('honors an endpoint-specific cap', async () => {
    const { error } = await readJsonBody(req('{"ok":true}'), { maxBytes: 4 })
    expect(error.status).toBe(413)
  })

  it('rejects malformed JSON with a clean 400 INVALID_JSON', async () => {
    const { error } = await readJsonBody(req('{not json'))
    expect(error.status).toBe(400)
    const body = await error.json()
    expect(body.code).toBe('INVALID_JSON')
  })
})

describe('SEC-3.1 (#194) — reusable validators', () => {
  it('str: trims, requires, and caps length', () => {
    expect(str('  hi  ')).toEqual({ value: 'hi' })
    expect(str('', { required: true }).error.code).toBe('REQUIRED')
    expect(str(42).error.code).toBe('TYPE_ERROR')
    expect(str('a'.repeat(6000), { max: 5000 }).error.code).toBe('TOO_LONG')
  })

  it('intInRange: type + range', () => {
    expect(intInRange(2020, { min: 1000, max: 2100 })).toEqual({ value: 2020 })
    expect(intInRange(1.5, { min: 1, max: 5 }).error.code).toBe('TYPE_ERROR')
    expect(intInRange('3', { min: 1, max: 5 }).error.code).toBe('TYPE_ERROR')
    expect(intInRange(99, { min: 1, max: 5 }).error.code).toBe('OUT_OF_RANGE')
    expect(intInRange(undefined).value).toBeUndefined()
  })

  it('boolean: type check', () => {
    expect(boolean(true)).toEqual({ value: true })
    expect(boolean('true').error.code).toBe('TYPE_ERROR')
  })

  it('inEnum: allowlist', () => {
    const set = new Set(['a', 'b'])
    expect(inEnum('a', set)).toEqual({ value: 'a' })
    expect(inEnum('c', set).error.code).toBe('INVALID_ENUM')
    expect(inEnum(undefined, set).value).toBeUndefined()
  })

  it('arrayOfStrings: array type + length caps', () => {
    expect(arrayOfStrings(['x'])).toEqual({ value: ['x'] })
    expect(arrayOfStrings('nope').error.code).toBe('TYPE_ERROR')
    expect(arrayOfStrings(['x', 42]).error.code).toBe('TYPE_ERROR')
    expect(arrayOfStrings(Array(101).fill('x'), { max: 100 }).error.code).toBe('TOO_LONG')
  })

  it('rejectUnknown: blocks junk/protected properties', () => {
    const allowed = new Set(['title', 'year'])
    expect(rejectUnknown({ title: 't', ownerId: 'owner' }, allowed)).toMatchObject({ code: 'UNKNOWN_FIELD' })
    expect(rejectUnknown({ title: 't', year: 2020 }, allowed)).toBeNull()
    expect(rejectUnknown(null, allowed)).toBeNull()
  })

  it('check: returns the first violation or null', () => {
    const violation = check(str('ok'), intInRange(99, { min: 1, max: 5 }))
    expect(violation.code).toBe('OUT_OF_RANGE')
    expect(check(str('ok'))).toBeNull()
  })

  it('badRequest turns a violation into a 400 { error, code }', async () => {
    const res = badRequest({ code: 'TOO_LONG', message: 'Must be at most 5 characters.' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ error: 'Must be at most 5 characters.', code: 'TOO_LONG' })
  })
})
