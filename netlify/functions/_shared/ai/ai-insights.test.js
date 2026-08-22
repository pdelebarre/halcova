// @vitest-environment node
//
// Unit tests for ai-insights.js — collection insights generation
// (FEAT-9.4, #335). Tests the cache behavior, input validation,
// data-minimization, and error handling.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateCollectionInsights, clearInsightsCache, getInsightsCacheStats } from './ai-insights'
import * as capabilities from './capabilities'
import * as fallback from './ai-fallback'

// Mock the fallback module so we control which provider is active
vi.mock('./ai-fallback', () => ({
  getActiveProvider: vi.fn(),
}))

// Mock the capabilities module so we control runCapability
vi.mock('./capabilities', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    runCapability: vi.fn(),
    COLLECTION_INSIGHTS: actual.COLLECTION_INSIGHTS,
  }
})

const MOCK_ITEMS = [
  { id: '1', title: 'Album A', artist: 'Artist 1', genre: 'Rock', year: '1975', format: 'LP' },
  { id: '2', title: 'Album B', artist: 'Artist 2', genre: 'Jazz', year: '1980', format: 'CD' },
  { id: '3', title: 'Album C', artist: 'Artist 1', genre: 'Rock', year: '1978', format: 'LP' },
]

const MOCK_INSIGHTS = {
  completionSuggestions: [
    { title: 'Suggested Album', artist: 'Artist 3', reason: 'Completes your collection', evidence: 'You have other albums by this artist', estimated: false },
  ],
  recommendations: [
    { title: 'Recommended Album', artist: 'Artist 4', reason: 'Similar to your taste', evidence: 'Based on your Rock collection', estimated: true },
  ],
  gaps: [
    { description: 'Missing early 80s releases', reason: 'Your collection jumps from 1978 to 1985', evidence: 'Decade gap detected', estimated: false },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  clearInsightsCache()
  fallback.getActiveProvider.mockResolvedValue({
    name: 'test-provider',
    model: 'test-model',
    supports: () => true,
    complete: vi.fn(),
  })
  capabilities.runCapability.mockResolvedValue({ insights: MOCK_INSIGHTS })
})

describe('generateCollectionInsights', () => {
  it('returns insights for valid input', async () => {
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.error).toBeUndefined()
    expect(result.insights).toEqual(MOCK_INSIGHTS)
    expect(result.cached).toBe(false)
    expect(capabilities.runCapability).toHaveBeenCalledTimes(1)
  })

  it('returns cached result on second call within TTL', async () => {
    await generateCollectionInsights('records', MOCK_ITEMS)
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.cached).toBe(true)
    // runCapability should only have been called once
    expect(capabilities.runCapability).toHaveBeenCalledTimes(1)
  })

  it('returns error for missing collectionType', async () => {
    const result = await generateCollectionInsights('', MOCK_ITEMS)
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('INVALID_INPUT')
  })

  it('returns error for empty items array', async () => {
    const result = await generateCollectionInsights('records', [])
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('INVALID_INPUT')
  })

  it('returns error when no active provider', async () => {
    fallback.getActiveProvider.mockResolvedValue(null)
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('NO_ACTIVE_PROVIDER')
  })

  it('returns error when getActiveProvider throws', async () => {
    fallback.getActiveProvider.mockRejectedValue(new Error('Provider error'))
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('NO_ACTIVE_PROVIDER')
  })

  it('returns error when runCapability fails', async () => {
    capabilities.runCapability.mockRejectedValue(new Error('Capability failed'))
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('INSIGHTS_FAILURE')
  })

  it('data-minimization: sends only canonical fields to the model', async () => {
    const itemsWithPrivate = [
      ...MOCK_ITEMS,
      {
        id: '4',
        title: 'Album D',
        artist: 'Artist 5',
        genre: 'Pop',
        year: '1990',
        format: 'CD',
        // Private fields that should NOT be sent
        notes: 'My private note',
        grading: 'Mint',
        lending: 'lent-to-friend',
        wishlist: true,
      },
    ]
    await generateCollectionInsights('records', itemsWithPrivate)

    // Check that runCapability was called with minimized data
    const callArg = capabilities.runCapability.mock.calls[0]
    const input = callArg[2] // third argument is the input
    expect(input.items).toHaveLength(4)
    // Private fields should not be in the sent items
    for (const item of input.items) {
      expect(item.notes).toBeUndefined()
      expect(item.grading).toBeUndefined()
      expect(item.lending).toBeUndefined()
      expect(item.wishlist).toBeUndefined()
    }
  })

  it('uses temperature 0.3 for slight creativity', async () => {
    await generateCollectionInsights('records', MOCK_ITEMS)
    const callArg = capabilities.runCapability.mock.calls[0]
    const options = callArg[3] // fourth argument is options
    expect(options.temperature).toBe(0.3)
  })
})

describe('clearInsightsCache', () => {
  it('clears cache for a specific collection type', async () => {
    await generateCollectionInsights('records', MOCK_ITEMS)
    clearInsightsCache('records')
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.cached).toBe(false)
    expect(capabilities.runCapability).toHaveBeenCalledTimes(2)
  })

  it('clears entire cache when no type specified', async () => {
    await generateCollectionInsights('records', MOCK_ITEMS)
    await generateCollectionInsights('books', MOCK_ITEMS)
    clearInsightsCache()
    const result = await generateCollectionInsights('records', MOCK_ITEMS)
    expect(result.cached).toBe(false)
  })
})

describe('getInsightsCacheStats', () => {
  it('returns cache stats with entries and TTL', async () => {
    await generateCollectionInsights('records', MOCK_ITEMS)
    const stats = getInsightsCacheStats()
    expect(stats.entries).toBe(1)
    expect(stats.ttlMs).toBe(5 * 60 * 1000)
    expect(typeof stats.expired).toBe('number')
  })
})