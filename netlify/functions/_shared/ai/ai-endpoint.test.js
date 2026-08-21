// @vitest-environment node
// Unit tests for the SSRF-safe AI endpoint validation (ADMIN-3.2, #304).

import { describe, expect, it } from 'vitest'
import { validateAiEndpoint, AI_ENDPOINT_ALLOWLIST_ENV } from './ai-endpoint'

describe('validateAiEndpoint (#304 SSRF gate)', () => {
  it('accepts a public HTTPS endpoint', () => {
    expect(validateAiEndpoint('https://api.openai.com/v1')).toEqual({ value: 'https://api.openai.com/v1' })
    expect(validateAiEndpoint('https://api.openai.com/v1/')).toEqual({ value: 'https://api.openai.com/v1' })
  })

  it('rejects missing/empty endpoints', () => {
    expect(validateAiEndpoint('').error).toBeTruthy()
    expect(validateAiEndpoint(null).error).toBeTruthy()
    expect(validateAiEndpoint(undefined).error).toBeTruthy()
  })

  it('rejects non-HTTPS endpoints', () => {
    expect(validateAiEndpoint('http://api.example.com/v1').error.code).toBe('INSECURE_ENDPOINT')
    expect(validateAiEndpoint('ftp://api.example.com').error).toBeTruthy()
  })

  it('rejects localhost and private/loopback IP-literal targets', () => {
    for (const bad of [
      'https://localhost/v1',
      'https://localhost.localdomain/v1',
      'https://myhost.local/v1',
      'https://127.0.0.1/v1',
      'https://10.0.0.1/v1',
      'https://10.255.255.255/v1',
      'https://192.168.1.10/v1',
      'https://172.16.0.1/v1',
      'https://172.31.255.254/v1',
      'https://169.254.169.254/v1', // cloud metadata
      'https://0.0.0.0/v1',
      'https://0.1.2.3/v1',
      'https://100.64.0.1/v1', // CGNAT
      'https://198.18.0.1/v1', // benchmarking
      'https://192.0.2.1/v1', // TEST-NET-1
      'https://198.51.100.1/v1', // TEST-NET-2
      'https://203.0.113.1/v1', // TEST-NET-3
      'https://[::1]/v1',
      'https://[fe80::1]/v1',
      'https://[::ffff:127.0.0.1]/v1',
    ]) {
      const res = validateAiEndpoint(bad)
      expect(res.error, bad).toBeTruthy()
      expect(res.error.code, bad).toBe('UNSAFE_ENDPOINT')
    }
  })

  it('rejects a non-hostname (bare dotted-quad / malformed) target', () => {
    expect(validateAiEndpoint('https://8.8.8.8/v1').error.code).toBe('UNSAFE_ENDPOINT')
    expect(validateAiEndpoint('https://999.1.1.1/v1').error).toBeTruthy() // octet > 255
    expect(validateAiEndpoint('https://-bad.example.com/v1').error).toBeTruthy()
    expect(validateAiEndpoint('https://bad-.example.com/v1').error).toBeTruthy()
    expect(validateAiEndpoint('https://bad..example.com/v1').error).toBeTruthy()
  })

  it('enforces the optional allowlist when configured (defense in depth)', () => {
    const env = { [AI_ENDPOINT_ALLOWLIST_ENV]: 'api.example.com' }
    expect(validateAiEndpoint('https://api.example.com/v1', env).value).toBeTruthy()
    expect(validateAiEndpoint('https://sub.api.example.com/v1', env).value).toBeTruthy()
    expect(validateAiEndpoint('https://api.other.com/v1', env).error.code).toBe('ENDPOINT_NOT_ALLOWED')
  })

  it('no allowlist env means any public host is allowed', () => {
    expect(validateAiEndpoint('https://anything.else.io/v1', {}).value).toBeTruthy()
  })
})
