// @vitest-environment node
//
// Unit suite for the AI collection tool runners
// (netlify/functions/_shared/ai/tools.js, #334, ADR-0021 §2.2/§2.3).
//
// Verifies:
//   - Happy-path completion and dedup flows
//   - Data-minimization: private fields are stripped before reaching the model
//   - XSS-safe rendering: dangerous content in output is rejected fail-closed
//   - Provider error propagation (timeout, rate-limit, invalid output)
//   - Adversarial negatives: malformed/schema-invalid output rejected
import { describe, expect, it, vi } from 'vitest'
import { ProviderError, ProviderErrorCode } from './provider'
import {
  completeMetadata,
  findDuplicates,
  getCompletionSuggestions,
  getDuplicateSuggestions,
} from './tools'

// ---------------------------------------------------------------------------
// Fake provider helpers
// ---------------------------------------------------------------------------

function fakeProvider({ content, supports = true, completeImpl } = {}) {
  return {
    supports: () => supports,
    complete: vi.fn(completeImpl ?? (async () => ({ content, model: 'fake' }))),
  }
}

function fakeProviderThatThrows(code, message) {
  return fakeProvider({
    completeImpl: async () => {
      throw new ProviderError(code, message)
    },
  })
}

// ---------------------------------------------------------------------------
// completeMetadata
// ---------------------------------------------------------------------------

describe('completeMetadata', () => {
  const validInput = {
    itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    existingFields: { title: 'Abbey' },
  }

  const validOutput = {
    suggestedFields: { title: 'Abbey Road', artist: 'The Beatles', year: '1969' },
    confidence: 0.95,
    source: 'openai',
  }

  it('returns suggested fields with confidence and source', async () => {
    const provider = fakeProvider({ content: validOutput })
    const result = await completeMetadata(provider, validInput)
    expect(result.suggestedFields.title).toBe('Abbey Road')
    expect(result.confidence).toBe(0.95)
    expect(result.source).toBe('openai')
  })

  it('applies data-minimization: strips private fields from existingFields', async () => {
    const provider = fakeProvider({ content: validOutput })
    await completeMetadata(provider, {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: {
        title: 'Abbey',
        notes: 'My private note',
        grading: 'Mint',
        lending: 'John',
        wishlist: true,
      },
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    // Private fields must not be in the sent input
    expect(sentInput.existingFields.notes).toBeUndefined()
    expect(sentInput.existingFields.grading).toBeUndefined()
    expect(sentInput.existingFields.lending).toBeUndefined()
    expect(sentInput.existingFields.wishlist).toBeUndefined()
    // Canonical fields must be preserved
    expect(sentInput.existingFields.title).toBe('Abbey')
  })

  it('passes providerHints through to the model', async () => {
    const provider = fakeProvider({ content: validOutput })
    await completeMetadata(provider, {
      ...validInput,
      providerHints: ['discogs', 'musicbrainz'],
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    expect(sentInput.providerHints).toEqual(['discogs', 'musicbrainz'])
  })

  it('rejects XSS-dangerous content in suggestedFields', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: '<script>alert(1)</script>' },
        confidence: 0.9,
        source: 'test',
      },
    })
    await expect(completeMetadata(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in nested suggestedFields', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'Safe', description: 'javascript:alert(1)' },
        confidence: 0.9,
        source: 'test',
      },
    })
    await expect(completeMetadata(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('propagates provider timeout error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.TIMEOUT, 'timed out')
    await expect(completeMetadata(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.TIMEOUT })
  })

  it('propagates provider rate-limit error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.RATE_LIMIT, 'rate limited')
    await expect(completeMetadata(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.RATE_LIMIT })
  })

  it('propagates provider invalid output error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.INVALID_OUTPUT, 'bad output')
    await expect(completeMetadata(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('works with empty existingFields', async () => {
    const provider = fakeProvider({ content: validOutput })
    const result = await completeMetadata(provider, {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: {},
    })
    expect(result.suggestedFields).toBeDefined()
  })

  it('works with null existingFields (treated as empty)', async () => {
    const provider = fakeProvider({ content: validOutput })
    const result = await completeMetadata(provider, {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: null,
    })
    expect(result.suggestedFields).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// findDuplicates
// ---------------------------------------------------------------------------

describe('findDuplicates', () => {
  const validInput = {
    collectionType: 'records',
    candidates: [
      { id: 'a1', title: 'Abbey Road' },
      { id: 'b1', title: 'Abbey Road (Remastered)' },
    ],
  }

  const validOutput = {
    pairs: [
      {
        itemA: { id: 'a1', title: 'Abbey Road' },
        itemB: { id: 'b1', title: 'Abbey Road (Remastered)' },
        score: 0.92,
        reason: 'Same title, different edition',
      },
    ],
  }

  it('returns duplicate pairs with scores', async () => {
    const provider = fakeProvider({ content: validOutput })
    const result = await findDuplicates(provider, validInput)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0].score).toBe(0.92)
    expect(result.pairs[0].itemA.id).toBe('a1')
    expect(result.pairs[0].itemB.id).toBe('b1')
  })

  it('applies data-minimization: strips private fields from candidates', async () => {
    const provider = fakeProvider({ content: validOutput })
    await findDuplicates(provider, {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'Abbey Road', notes: 'private', grading: 'Mint' },
        { id: 'b1', title: 'Abbey Road (Remastered)', lending: 'John' },
      ],
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    for (const c of sentInput.candidates) {
      expect(c.notes).toBeUndefined()
      expect(c.grading).toBeUndefined()
      expect(c.lending).toBeUndefined()
    }
    // Canonical fields must be preserved
    expect(sentInput.candidates[0].title).toBe('Abbey Road')
    expect(sentInput.candidates[0].id).toBe('a1')
  })

  it('passes threshold through to the model', async () => {
    const provider = fakeProvider({ content: validOutput })
    await findDuplicates(provider, { ...validInput, threshold: 0.8 })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    expect(sentInput.threshold).toBe(0.8)
  })

  it('rejects XSS-dangerous content in pair titles', async () => {
    const provider = fakeProvider({
      content: {
        pairs: [
          {
            itemA: { id: 'a1', title: '<script>alert(1)</script>' },
            itemB: { id: 'b1', title: 'Safe Title' },
            score: 0.9,
          },
        ],
      },
    })
    await expect(findDuplicates(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in pair reasons', async () => {
    const provider = fakeProvider({
      content: {
        pairs: [
          {
            itemA: { id: 'a1', title: 'Safe' },
            itemB: { id: 'b1', title: 'Safe' },
            score: 0.9,
            reason: 'javascript:alert(1)',
          },
        ],
      },
    })
    await expect(findDuplicates(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('propagates provider timeout error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.TIMEOUT, 'timed out')
    await expect(findDuplicates(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.TIMEOUT })
  })

  it('propagates provider rate-limit error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.RATE_LIMIT, 'rate limited')
    await expect(findDuplicates(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.RATE_LIMIT })
  })

  it('propagates provider invalid output error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.INVALID_OUTPUT, 'bad output')
    await expect(findDuplicates(provider, validInput))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('works with empty candidates array', async () => {
    const provider = fakeProvider({ content: { pairs: [] } })
    const result = await findDuplicates(provider, {
      collectionType: 'records',
      candidates: [],
    })
    expect(result.pairs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getCompletionSuggestions
// ---------------------------------------------------------------------------

describe('getCompletionSuggestions', () => {
  it('returns suggestions for items with missing fields', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'Abbey Road', artist: 'The Beatles', year: '1969' },
        confidence: 0.95,
        source: 'openai',
      },
    })
    const result = await getCompletionSuggestions(provider, {
      collectionType: 'records',
      items: [
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01',
          title: 'Abbey',
          existingFields: { title: 'Abbey' },
        },
      ],
    })
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].itemId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01')
    expect(result.suggestions[0].missingFields).toContain('artist')
    expect(result.suggestions[0].missingFields).toContain('year')
    expect(result.suggestions[0].suggestedValues.artist).toBe('The Beatles')
  })

  it('returns empty suggestions when no items provided', async () => {
    const provider = fakeProvider({ content: {} })
    const result = await getCompletionSuggestions(provider, {
      collectionType: 'records',
      items: [],
    })
    expect(result.suggestions).toEqual([])
  })

  it('returns empty suggestions when items array is not provided', async () => {
    const provider = fakeProvider({ content: {} })
    const result = await getCompletionSuggestions(provider, {
      collectionType: 'records',
    })
    expect(result.suggestions).toEqual([])
  })

  it('excludes items with no missing fields', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'Abbey Road' },
        confidence: 0.95,
        source: 'openai',
      },
    })
    const result = await getCompletionSuggestions(provider, {
      collectionType: 'records',
      items: [
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          title: 'Abbey Road',
          existingFields: { title: 'Abbey Road' },
        },
      ],
    })
    // title is already present in existingFields, so no missing fields
    expect(result.suggestions).toHaveLength(0)
  })

  it('respects the limit parameter', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'Full Title', artist: 'Artist' },
        confidence: 0.9,
        source: 'openai',
      },
    })
    const items = Array.from({ length: 5 }, (_, i) => {
      const id = `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(i).padStart(2, '0')}`
      return {
        id,
        title: `Item ${i}`,
        existingFields: { title: `Item ${i}` },
      }
    })
    const result = await getCompletionSuggestions(provider, {
      collectionType: 'records',
      items,
      limit: 2,
    })
    expect(result.suggestions.length).toBeLessThanOrEqual(2)
  })

  it('skips items where completeMetadata throws (graceful degradation)', async () => {
    const provider = fakeProvider({
      completeImpl: vi.fn()
        .mockRejectedValueOnce(new ProviderError(ProviderErrorCode.RATE_LIMIT, 'slow'))
        .mockResolvedValueOnce({
          content: {
            suggestedFields: { artist: 'Artist' },
            confidence: 0.9,
            source: 'openai',
          },
        }),
    })
    const result = await getCompletionSuggestions(provider, {
      collectionType: 'records',
      items: [
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01', title: 'Fail', existingFields: { title: 'Fail' } },
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee02', title: 'Success', existingFields: { title: 'Success' } },
      ],
    })
    // First item fails (rate-limited), second succeeds
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].itemId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee02')
  })
})

// ---------------------------------------------------------------------------
// getDuplicateSuggestions
// ---------------------------------------------------------------------------

describe('getDuplicateSuggestions', () => {
  const validOutput = {
    pairs: [
      {
        itemA: { id: 'a1', title: 'Abbey Road' },
        itemB: { id: 'b1', title: 'Abbey Road (Remastered)' },
        score: 0.92,
        reason: 'Same title, different edition',
      },
    ],
  }

  it('returns suggestions mapped from duplicate pairs', async () => {
    const provider = fakeProvider({ content: validOutput })
    const result = await getDuplicateSuggestions(provider, {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'Abbey Road' },
        { id: 'b1', title: 'Abbey Road (Remastered)' },
      ],
    })
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].itemId).toBe('a1')
    expect(result.suggestions[0].duplicateOfId).toBe('b1')
    expect(result.suggestions[0].score).toBe(0.92)
    expect(result.suggestions[0].reason).toBe('Same title, different edition')
  })

  it('returns empty suggestions when fewer than 2 candidates', async () => {
    const provider = fakeProvider({ content: {} })
    const result = await getDuplicateSuggestions(provider, {
      collectionType: 'records',
      candidates: [{ id: 'a1', title: 'Only One' }],
    })
    expect(result.suggestions).toEqual([])
  })

  it('returns empty suggestions when candidates array is empty', async () => {
    const provider = fakeProvider({ content: {} })
    const result = await getDuplicateSuggestions(provider, {
      collectionType: 'records',
      candidates: [],
    })
    expect(result.suggestions).toEqual([])
  })

  it('returns empty suggestions when candidates is not provided', async () => {
    const provider = fakeProvider({ content: {} })
    const result = await getDuplicateSuggestions(provider, {
      collectionType: 'records',
    })
    expect(result.suggestions).toEqual([])
  })

  it('respects the limit parameter', async () => {
    const provider = fakeProvider({
      content: {
        pairs: Array.from({ length: 5 }, (_, i) => ({
          itemA: { id: `a${i}`, title: `Item A${i}` },
          itemB: { id: `b${i}`, title: `Item B${i}` },
          score: 0.9 - i * 0.1,
          reason: `Reason ${i}`,
        })),
      },
    })
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `id${i}`,
      title: `Item ${i}`,
    }))
    const result = await getDuplicateSuggestions(provider, {
      collectionType: 'records',
      candidates,
      limit: 2,
    })
    expect(result.suggestions.length).toBeLessThanOrEqual(2)
  })

  it('propagates provider errors', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.TIMEOUT, 'timed out')
    await expect(getDuplicateSuggestions(provider, {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'A' },
        { id: 'b1', title: 'B' },
      ],
    })).rejects.toMatchObject({ code: ProviderErrorCode.TIMEOUT })
  })

  it('provides a default reason when reason is missing', async () => {
    const provider = fakeProvider({
      content: {
        pairs: [
          {
            itemA: { id: 'a1', title: 'Abbey Road' },
            itemB: { id: 'b1', title: 'Abbey Road (Remastered)' },
            score: 0.92,
          },
        ],
      },
    })
    const result = await getDuplicateSuggestions(provider, {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'Abbey Road' },
        { id: 'b1', title: 'Abbey Road (Remastered)' },
      ],
    })
    expect(result.suggestions[0].reason).toBe('Similar to "Abbey Road (Remastered)"')
  })
})