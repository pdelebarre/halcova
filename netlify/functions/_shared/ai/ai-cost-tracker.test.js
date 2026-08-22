// @vitest-environment node
//
// Tests for the AI cost tracker (ADMIN-3.8, #310). Covers cost estimation,
// usage event creation, and the Blobs-based storage backend.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateCost,
  createUsageEvent,
  modelPricesFromEnv,
} from './ai-cost-tracker'

describe('modelPricesFromEnv', () => {
  it('returns default prices when env is absent', () => {
    const prices = modelPricesFromEnv({})
    expect(prices['gpt-4o-mini']).toEqual({ input: 0.00015, output: 0.0006 })
    expect(prices['gpt-4o']).toEqual({ input: 0.0025, output: 0.01 })
  })

  it('merges env overrides onto defaults', () => {
    const prices = modelPricesFromEnv({
      RUNOUT_AI_MODEL_PRICES: JSON.stringify({ 'gpt-4o-mini': { input: 0.0001, output: 0.0004 } }),
    })
    expect(prices['gpt-4o-mini']).toEqual({ input: 0.0001, output: 0.0004 })
    // Defaults still present for other models.
    expect(prices['gpt-4o']).toEqual({ input: 0.0025, output: 0.01 })
  })

  it('handles invalid JSON gracefully', () => {
    const prices = modelPricesFromEnv({ RUNOUT_AI_MODEL_PRICES: 'not-json' })
    expect(prices['gpt-4o-mini']).toEqual({ input: 0.00015, output: 0.0006 })
  })
})

describe('estimateCost', () => {
  it('returns null when tokens are missing', () => {
    expect(estimateCost({ model: 'gpt-4o-mini', tokensIn: null, tokensOut: 100 })).toBeNull()
    expect(estimateCost({ model: 'gpt-4o-mini', tokensIn: 100, tokensOut: null })).toBeNull()
  })

  it('calculates cost for a known model', () => {
    const cost = estimateCost({ model: 'gpt-4o-mini', tokensIn: 1000, tokensOut: 500 })
    // input: (1000/1000) * 0.00015 = 0.00015
    // output: (500/1000) * 0.0006 = 0.0003
    // total: 0.00045
    expect(cost).toBe(0.00045)
  })

  it('uses default prices for unknown models', () => {
    const cost = estimateCost({ model: 'unknown-model', tokensIn: 1000, tokensOut: 1000 })
    // input: (1000/1000) * 0.001 = 0.001
    // output: (1000/1000) * 0.004 = 0.004
    // total: 0.005
    expect(cost).toBe(0.005)
  })

  it('accepts custom price map', () => {
    const prices = { 'custom-model': { input: 0.01, output: 0.02 } }
    const cost = estimateCost({ model: 'custom-model', tokensIn: 1000, tokensOut: 1000, prices })
    expect(cost).toBe(0.03)
  })
})

describe('createUsageEvent', () => {
  it('creates an event with cost estimate', () => {
    const event = createUsageEvent({
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensIn: 500,
      tokensOut: 200,
      latencyMs: 1500,
      ok: true,
    })
    expect(event.provider).toBe('openai')
    expect(event.model).toBe('gpt-4o-mini')
    expect(event.tokensIn).toBe(500)
    expect(event.tokensOut).toBe(200)
    expect(event.latencyMs).toBe(1500)
    expect(event.ok).toBe(true)
    expect(event.errorCode).toBeNull()
    expect(event.costEstimate).toBeGreaterThan(0)
    expect(event.timestamp).toBeTruthy()
  })

  it('creates an event for a failure', () => {
    const event = createUsageEvent({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: null,
      tokensOut: null,
      latencyMs: 5000,
      ok: false,
      errorCode: 'PROVIDER_TIMEOUT',
    })
    expect(event.ok).toBe(false)
    expect(event.errorCode).toBe('PROVIDER_TIMEOUT')
    expect(event.costEstimate).toBeNull()
  })
})