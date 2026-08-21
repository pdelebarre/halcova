// @vitest-environment node
//
// Unit suite for the provider-neutral contract (netlify/functions/_shared/ai/
// provider.js, ADMIN-3.1 #303). Covers the error taxonomy, the bounded request
// options (never loosened past safe defaults), and the abstract base class.
import { describe, expect, it } from 'vitest'
import {
  Provider,
  ProviderError,
  ProviderErrorCode,
  boundedOptions,
  mergeOptions,
  DEFAULT_REQUEST_OPTIONS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_RETRIES,
  DEFAULT_MAX_TOKENS,
} from './provider'

describe('ProviderError', () => {
  it('carries a stable code and retryable flag', () => {
    const err = new ProviderError(ProviderErrorCode.RATE_LIMIT, 'nope', { retryable: true })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('PROVIDER_RATE_LIMIT')
    expect(err.retryable).toBe(true)
    expect(err.message).toBe('nope')
  })

  it('defaults retryable to false', () => {
    const err = new ProviderError(ProviderErrorCode.TIMEOUT, 'slow')
    expect(err.retryable).toBe(false)
  })
})

describe('boundedOptions', () => {
  it('applies safe defaults when nothing is provided', () => {
    const o = boundedOptions()
    expect(o).toEqual({
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      retries: DEFAULT_RETRIES,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0,
    })
  })

  it('clamps a caller timeout above the default down to the default', () => {
    expect(boundedOptions({ timeoutMs: 120_000 }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('rejects a zero/negative timeout back to the default', () => {
    expect(boundedOptions({ timeoutMs: 0 }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(boundedOptions({ timeoutMs: -5 }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('clamps an oversized response cap down to the default', () => {
    expect(boundedOptions({ maxResponseBytes: 10 * 1024 * 1024 }).maxResponseBytes)
      .toBe(DEFAULT_MAX_RESPONSE_BYTES)
  })

  it('clamps retries above the default down to the default', () => {
    expect(boundedOptions({ retries: 10 }).retries).toBe(DEFAULT_RETRIES)
  })

  it('clamps maxTokens above the default down to the default', () => {
    expect(boundedOptions({ maxTokens: 100_000 }).maxTokens).toBe(DEFAULT_MAX_TOKENS)
  })

  it('clamps temperature into [0, 2]', () => {
    expect(boundedOptions({ temperature: 5 }).temperature).toBe(2)
    expect(boundedOptions({ temperature: -3 }).temperature).toBe(0)
  })

  it('ignores non-finite / non-numeric overrides', () => {
    const o = boundedOptions({ timeoutMs: NaN, retries: 'x', maxTokens: Infinity })
    expect(o.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(o.retries).toBe(DEFAULT_RETRIES)
    expect(o.maxTokens).toBe(DEFAULT_MAX_TOKENS)
  })

  it('allows a zero retry budget and a single-token ceiling', () => {
    expect(boundedOptions({ retries: 0 }).retries).toBe(0)
    expect(boundedOptions({ maxTokens: 1 }).maxTokens).toBe(1)
  })
})

describe('mergeOptions', () => {
  const base = { timeoutMs: 5000, maxResponseBytes: 1024, retries: 1, maxTokens: 128, temperature: 0 }

  it('preserves the base when no override is provided', () => {
    expect(mergeOptions(base, {})).toEqual(base)
  })

  it('applies a provided override', () => {
    expect(mergeOptions(base, { retries: 0 }).retries).toBe(0)
    expect(mergeOptions(base, { temperature: 1 }).temperature).toBe(1)
  })

  it('clamps a provided override into its safe range', () => {
    expect(mergeOptions(base, { timeoutMs: 999999 }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(mergeOptions(base, { retries: 50 }).retries).toBe(DEFAULT_RETRIES)
  })

  it('does not loosen a base bound when the override is absent', () => {
    // base maxResponseBytes is 1024; an override that omits it must not reset
    // it to the 64 KB default.
    expect(mergeOptions(base, { temperature: 0.5 }).maxResponseBytes).toBe(1024)
  })

  it('ignores an override that is not a finite number', () => {
    expect(mergeOptions(base, { timeoutMs: NaN }).timeoutMs).toBe(5000)
  })
})

describe('Provider base class', () => {
  it('exposes model metadata without credentials', () => {
    const p = new Provider({ name: 'test', model: 'm1', capabilities: ['classify'] })
    expect(p.modelMetadata()).toEqual({
      provider: 'test',
      model: 'm1',
      capabilities: ['classify'],
    })
  })

  it('reports capability support', () => {
    const p = new Provider({ name: 'test', model: 'm1', capabilities: ['classify'] })
    expect(p.supports('classify')).toBe(true)
    expect(p.supports('deduplicate')).toBe(false)
  })

  it('throws ProviderError from unimplemented complete()', async () => {
    const p = new Provider({ name: 'test', model: 'm1' })
    await expect(p.complete({})).rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('throws ProviderError from unimplemented health()', async () => {
    const p = new Provider({ name: 'test', model: 'm1' })
    await expect(p.health()).rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('defaults capabilities to empty and applies bounded options', () => {
    const p = new Provider({ name: 'test', model: 'm1' })
    expect(p.supports('anything')).toBe(false)
    expect(p.options).toEqual(DEFAULT_REQUEST_OPTIONS)
  })

  it('clamps constructor options into the safe bounded range', () => {
    const p = new Provider({ name: 'test', model: 'm1', options: { timeoutMs: 999999, retries: 9 } })
    expect(p.options.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(p.options.retries).toBe(DEFAULT_RETRIES)
  })
})