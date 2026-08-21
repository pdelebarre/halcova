// @vitest-environment node
// Unit tests for the AI secret protection (ADMIN-3.2, #304): AES-256-GCM
// encrypt-at-rest, tamper detection, and masked display.

import { describe, expect, it } from 'vitest'
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  secretKeyFromEnv,
  AI_SECRET_KEY_ENV,
} from './ai-secrets'

const KEY = Buffer.alloc(32, 7)
const env = { [AI_SECRET_KEY_ENV]: 'test-secret-key-1234' }

describe('ai-secrets (#304)', () => {
  it('round-trips a secret under a configured key', () => {
    const cipher = encryptSecret('sk-test-abc123', KEY)
    expect(cipher).not.toContain('sk-test-abc123')
    expect(decryptSecret(cipher, KEY)).toBe('sk-test-abc123')
  })

  it('is nondeterministic (fresh IV each time) and GCM-authenticated', () => {
    const a = encryptSecret('sk-aaa', KEY)
    const b = encryptSecret('sk-aaa', KEY)
    expect(a).not.toBe(b)
    expect(decryptSecret(a, KEY)).toBe('sk-aaa')
    expect(decryptSecret(b, KEY)).toBe('sk-aaa')
  })

  it('rejects tampered ciphertext (auth tag fails) — never yields plaintext', () => {
    const cipher = encryptSecret('sk-secret-value', KEY)
    const buf = Buffer.from(cipher, 'base64')
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff // flip a byte in the body
    const tampered = buf.toString('base64')
    expect(() => decryptSecret(tampered, KEY)).toThrow()
  })

  it('throws when no key is configured (never persists a weakly-protected secret)', () => {
    expect(() => encryptSecret('sk-anything', null)).toThrow(/not configured/)
    expect(() => decryptSecret('AAAA', null)).toThrow(/not configured/)
  })

  it('rejects an empty/non-string secret', () => {
    expect(() => encryptSecret('', KEY)).toThrow(/secret value/)
    expect(() => encryptSecret(null, KEY)).toThrow()
  })

  it('derives a 32-byte key from the env secret (or null when absent)', () => {
    expect(secretKeyFromEnv(env)).toHaveLength(32)
    expect(secretKeyFromEnv({})).toBeNull()
    expect(secretKeyFromEnv({ [AI_SECRET_KEY_ENV]: '' })).toBeNull()
  })

  it('masks a secret showing only the tail', () => {
    expect(maskSecret('sk-abcdef')).toBe('••••••cdef')
    expect(maskSecret('')).toBe('')
    expect(maskSecret(null)).toBe('')
  })
})
