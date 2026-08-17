// @vitest-environment node
//
// Tests for the structured security-audit-event + redaction module
// (netlify/functions/_shared/audit.js, SEC-6.4 #218 / SEC-6.5 #219).
//
// Proves:
//   - redactString scrubs known secret patterns (access codes, Stripe keys,
//     bearer/session tokens, emails),
//   - redactFields DROPS secret-keyed fields entirely (code/token/secret/…),
//   - logAudit emits a stable `AUDIT <json>` line whose JSON never contains a
//     secret value or a raw email/name,
//   - emailHash is a stable, non-reversible hash of a normalized email (the
//     only email-derived value allowed in an event),
//   - safeLog redacts free-text + extra fields before logging.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emailHash, logAudit, redactFields, redactString, safeLog } from './audit'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('redactString — secret patterns', () => {
  it('redacts an RU- access code', () => {
    expect(redactString('code is RU-ABCD-EFGH-JKLM here')).toContain('REDACTED_CODE')
    expect(redactString('RU-ABCD-EFGH-JKLM')).not.toContain('RU-ABCD')
  })

  it('redacts Stripe secret / restricted / webhook keys', () => {
    expect(redactString('sk_live_abc123')).toBe('REDACTED_STRIPE')
    expect(redactString('whsec_xyz987')).toBe('REDACTED_STRIPE')
    expect(redactString('rk_test_123')).toBe('REDACTED_STRIPE')
  })

  it('redacts Bearer tokens and any long opaque token', () => {
    expect(redactString('Authorization: Bearer abc123XYZ_~+/def=')).toContain('Bearer REDACTED')
    expect(redactString('token=' + 'A'.repeat(48))).toContain('REDACTED_TOKEN')
  })

  it('redacts email addresses (PII)', () => {
    expect(redactString('contact ada@example.com now')).toContain('REDACTED_EMAIL')
    expect(redactString('ada@example.com')).not.toContain('ada@example.com')
  })
})

describe('redactFields — drops secret-keyed fields', () => {
  it('drops fields named code/token/secret/password and nested equivalents', () => {
    const out = redactFields({
      code: 'RU-ABCD-EFGH-JKLM',
      token: 'secret-token',
      secretKey: 'sk_live_x',
      password: 'hunter2',
      safe: 'keep-me',
      userId: 'u-123',
    })
    expect(out).not.toHaveProperty('code')
    expect(out).not.toHaveProperty('token')
    expect(out).not.toHaveProperty('secretKey')
    expect(out).not.toHaveProperty('password')
    expect(out.safe).toBe('keep-me')
    expect(out.userId).toBe('u-123')
  })

  it('redacts raw email and name fields (PII) and recurses into nested objects', () => {
    const out = redactFields({ email: 'ada@example.com', name: 'Ada', meta: { token: 'x', count: 3 } })
    expect(out).not.toHaveProperty('email')
    expect(out).not.toHaveProperty('name')
    expect(out.meta).toEqual({ count: 3 })
  })

  it('scrubs secret patterns from free-text string values', () => {
    const out = redactFields({ note: 'issued RU-ABCD-EFGH-JKLM to ada@example.com' })
    expect(JSON.stringify(out)).not.toContain('RU-ABCD')
    expect(JSON.stringify(out)).not.toContain('ada@example.com')
  })
})

describe('logAudit — stable, secret-free JSON lines', () => {
  it('emits a single AUDIT-prefixed JSON line with ts + type + safe fields', () => {
    logAudit('auth.login_failed', { userId: 'u-1', status: 401, attempt: 3 })
    const [line] = console.log.mock.calls[0]
    expect(line.startsWith('AUDIT ')).toBe(true)
    const event = JSON.parse(line.slice('AUDIT '.length))
    expect(event.ts).toBeTruthy()
    expect(event.type).toBe('auth.login_failed')
    expect(event.userId).toBe('u-1')
    expect(event.status).toBe(401)
    expect(event.attempt).toBe(3)
  })

  it('never emits a secret value or raw PII even when fields carry them', () => {
    logAudit('admin.approve', {
      code: 'RU-ABCD-EFGH-JKLM',
      sessionToken: 'S'.repeat(48),
      email: 'ada@example.com',
      name: 'Ada',
      emailHash: emailHash('ada@example.com'),
      userId: 'u-1',
    })
    const line = console.log.mock.calls[0][0]
    expect(line).not.toContain('RU-ABCD')
    expect(line).not.toContain('S'.repeat(48))
    expect(line).not.toContain('ada@example.com')
    expect(line).not.toContain('"name"')
    // The email-hash (safe) and user id (safe) ARE present.
    expect(line).toContain('emailHash')
    expect(line).toContain('u-1')
  })
})

describe('emailHash', () => {
  it('is stable and normalized (case/whitespace-insensitive)', () => {
    expect(emailHash('Ada@Example.com')).toBe(emailHash('ada@example.com'))
    expect(emailHash('ada@example.com')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns undefined for empty input', () => {
    expect(emailHash('')).toBeUndefined()
    expect(emailHash(null)).toBeUndefined()
  })
})

describe('safeLog — redacts free-text + extra fields', () => {
  it('redacts the message and extra fields before logging', () => {
    safeLog('info', 'issued RU-ABCD-EFGH-JKLM', { email: 'ada@example.com', userId: 'u-1' })
    const [line] = console.log.mock.calls[0]
    expect(line).not.toContain('RU-ABCD')
    expect(line).not.toContain('ada@example.com')
    expect(line).toContain('u-1')
  })

  it('routes error level to console.error', () => {
    safeLog('error', 'boom', { userId: 'u-1' })
    expect(console.error).toHaveBeenCalled()
  })
})
