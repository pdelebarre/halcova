// @vitest-environment node
//
// Tests for the AI fallback provider logic (ADMIN-3.8, #310). Covers cooldown
// management, retryable error detection, and fallback execution.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setCooldown,
  isInCooldown,
  clearCooldowns,
  getCooldownState,
  isRetryableError,
  withFallback,
} from './ai-fallback'
import { ProviderErrorCode } from './provider'

describe('cooldown management', () => {
  beforeEach(() => {
    clearCooldowns()
  })

  it('sets and checks cooldown', () => {
    setCooldown('provider-1', 1000)
    expect(isInCooldown('provider-1')).toBe(true)
  })

  it('returns false for unknown provider', () => {
    expect(isInCooldown('unknown')).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isInCooldown(null)).toBe(false)
    expect(isInCooldown(undefined)).toBe(false)
  })

  it('expires cooldown after duration', async () => {
    setCooldown('provider-1', 10) // 10ms
    expect(isInCooldown('provider-1')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(isInCooldown('provider-1')).toBe(false)
  })

  it('clears all cooldowns', () => {
    setCooldown('provider-1', 10000)
    setCooldown('provider-2', 10000)
    clearCooldowns()
    expect(isInCooldown('provider-1')).toBe(false)
    expect(isInCooldown('provider-2')).toBe(false)
  })

  it('getCooldownState returns active cooldowns', () => {
    setCooldown('provider-1', 10000)
    const state = getCooldownState()
    expect(state.length).toBe(1)
    expect(state[0].providerId).toBe('provider-1')
    expect(state[0].remainingMs).toBeGreaterThan(0)
  })
})

describe('isRetryableError', () => {
  it('returns true for timeout, rate-limit, and failure', () => {
    expect(isRetryableError(ProviderErrorCode.TIMEOUT)).toBe(true)
    expect(isRetryableError(ProviderErrorCode.RATE_LIMIT)).toBe(true)
    expect(isRetryableError(ProviderErrorCode.FAILURE)).toBe(true)
  })

  it('returns false for auth, bad-request, and invalid-output', () => {
    expect(isRetryableError(ProviderErrorCode.AUTH)).toBe(false)
    expect(isRetryableError(ProviderErrorCode.BAD_REQUEST)).toBe(false)
    expect(isRetryableError(ProviderErrorCode.INVALID_OUTPUT)).toBe(false)
  })
})

describe('withFallback', () => {
  beforeEach(() => {
    clearCooldowns()
  })

  it('returns primary result on success', async () => {
    const primary = { name: 'openai', model: 'gpt-4o-mini' }
    const callFn = vi.fn().mockResolvedValue('ok')
    const result = await withFallback({
      primaryProvider: primary,
      primaryId: 'p1',
      callFn,
    })
    expect(result).toBe('ok')
    expect(callFn).toHaveBeenCalledTimes(1)
  })

  it('retries primary on retryable error then succeeds', async () => {
    const primary = { name: 'openai', model: 'gpt-4o-mini' }
    const callFn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: ProviderErrorCode.TIMEOUT }))
      .mockResolvedValueOnce('ok')
    const result = await withFallback({
      primaryProvider: primary,
      primaryId: 'p1',
      callFn,
    })
    expect(result).toBe('ok')
    expect(callFn).toHaveBeenCalledTimes(2)
  })

  it('falls back to secondary when primary exhausts retries', async () => {
    const primary = { name: 'openai', model: 'gpt-4o-mini' }
    const fallback = { name: 'openai-fallback', model: 'gpt-3.5-turbo' }
    const primaryFn = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: ProviderErrorCode.TIMEOUT }))
    const fallbackFn = vi.fn().mockResolvedValue('fallback-ok')
    const result = await withFallback({
      primaryProvider: primary,
      primaryId: 'p1',
      fallbackProvider: fallback,
      fallbackId: 'p2',
      callFn: (provider) => provider === primary ? primaryFn() : fallbackFn(),
      options: { maxRetries: 1 },
    })
    expect(result).toBe('fallback-ok')
    expect(primaryFn).toHaveBeenCalledTimes(2) // 1 initial + 1 retry
    expect(fallbackFn).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on non-retryable error', async () => {
    const primary = { name: 'openai', model: 'gpt-4o-mini' }
    const callFn = vi.fn().mockRejectedValue(Object.assign(new Error('auth'), { code: ProviderErrorCode.AUTH }))
    await expect(withFallback({
      primaryProvider: primary,
      primaryId: 'p1',
      callFn,
    })).rejects.toThrow('auth')
    expect(callFn).toHaveBeenCalledTimes(1)
  })

  it('skips primary when in cooldown and uses fallback', async () => {
    const primary = { name: 'openai', model: 'gpt-4o-mini' }
    const fallback = { name: 'openai-fallback', model: 'gpt-3.5-turbo' }
    setCooldown('p1', 10000)
    const primaryFn = vi.fn()
    const fallbackFn = vi.fn().mockResolvedValue('fallback-ok')
    const result = await withFallback({
      primaryProvider: primary,
      primaryId: 'p1',
      fallbackProvider: fallback,
      fallbackId: 'p2',
      callFn: (provider) => provider === primary ? primaryFn() : fallbackFn(),
    })
    expect(result).toBe('fallback-ok')
    expect(primaryFn).not.toHaveBeenCalled()
    expect(fallbackFn).toHaveBeenCalledTimes(1)
  })

  it('throws when both primary and fallback fail', async () => {
    const primary = { name: 'openai', model: 'gpt-4o-mini' }
    const fallback = { name: 'openai-fallback', model: 'gpt-3.5-turbo' }
    const primaryFn = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: ProviderErrorCode.TIMEOUT }))
    const fallbackFn = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { code: ProviderErrorCode.FAILURE }))
    await expect(withFallback({
      primaryProvider: primary,
      primaryId: 'p1',
      fallbackProvider: fallback,
      fallbackId: 'p2',
      callFn: (provider) => provider === primary ? primaryFn() : fallbackFn(),
      options: { maxRetries: 0 },
    })).rejects.toThrow()
  })
})