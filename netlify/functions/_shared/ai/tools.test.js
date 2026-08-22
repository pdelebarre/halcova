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
  identifyFromImage,
  searchItems,
  getItemDetail,
  getCollectionSummary,
  proposeMutation,
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

// ---------------------------------------------------------------------------
// searchItems
// ---------------------------------------------------------------------------

describe('searchItems', () => {
  const provider = { supports: () => true, complete: async () => ({ content: {}, model: 'fake' }) }

  const sampleItems = [
    { id: '1', title: 'Abbey Road', collectionType: 'records', status: 'identified', subtitle: '1969', coverUrl: 'https://example.com/cover.jpg' },
    { id: '2', title: 'Sgt. Pepper', collectionType: 'records', status: 'identified' },
    { id: '3', title: 'Revolver', collectionType: 'records', status: 'draft' },
  ]

  it('returns minimized results for a valid query', async () => {
    const result = await searchItems(provider, { query: 'Beatles', items: sampleItems })
    expect(result.results).toHaveLength(3)
    expect(result.results[0].id).toBe('1')
    expect(result.results[0].title).toBe('Abbey Road')
    expect(result.results[0].subtitle).toBe('1969')
    expect(result.results[0].coverUrl).toBe('https://example.com/cover.jpg')
  })

  it('respects the limit parameter (capped at 20)', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: `Item ${i}` }))
    const result = await searchItems(provider, { query: 'test', items, limit: 5 })
    expect(result.results).toHaveLength(5)
  })

  it('caps limit to 20 even when a larger value is passed', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: String(i), title: `Item ${i}` }))
    const result = await searchItems(provider, { query: 'test', items, limit: 100 })
    expect(result.results).toHaveLength(20)
  })

  it('uses minimum limit of 1', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `Item ${i}` }))
    const result = await searchItems(provider, { query: 'test', items, limit: -5 })
    expect(result.results).toHaveLength(1)
  })

  it('applies data-minimization: strips private fields', async () => {
    const itemsWithPrivate = [
      { id: '1', title: 'Abbey Road', notes: 'My private note', grading: 'Mint', lending: 'John' },
    ]
    const result = await searchItems(provider, { query: 'Beatles', items: itemsWithPrivate })
    expect(result.results[0].notes).toBeUndefined()
    expect(result.results[0].grading).toBeUndefined()
    expect(result.results[0].lending).toBeUndefined()
    // Public fields preserved
    expect(result.results[0].id).toBe('1')
    expect(result.results[0].title).toBe('Abbey Road')
  })

  it('rejects an empty query', async () => {
    await expect(searchItems(provider, { query: '', items: sampleItems }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects a missing query', async () => {
    await expect(searchItems(provider, { items: sampleItems }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in results', async () => {
    const dangerousItems = [
      { id: '1', title: '<script>alert(1)</script>', collectionType: 'records', status: 'identified' },
    ]
    await expect(searchItems(provider, { query: 'test', items: dangerousItems }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in subtitle', async () => {
    const dangerousItems = [
      { id: '1', title: 'Safe', subtitle: 'javascript:alert(1)', collectionType: 'records', status: 'identified' },
    ]
    await expect(searchItems(provider, { query: 'test', items: dangerousItems }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('filters out null/invalid items', async () => {
    const mixedItems = [
      { id: '1', title: 'Valid Item', collectionType: 'records', status: 'identified' },
      null,
      undefined,
      'string',
      42,
    ]
    const result = await searchItems(provider, { query: 'test', items: mixedItems })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].id).toBe('1')
  })

  it('filters out items with empty id or title', async () => {
    const items = [
      { id: '', title: 'No ID', collectionType: 'records', status: 'draft' },
      { id: '1', title: '', collectionType: 'records', status: 'draft' },
      { id: '2', title: 'Valid', collectionType: 'records', status: 'identified' },
    ]
    const result = await searchItems(provider, { query: 'test', items })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].id).toBe('2')
  })

  it('returns empty results when no items provided', async () => {
    const result = await searchItems(provider, { query: 'test' })
    expect(result.results).toEqual([])
  })

  it('sets default collectionType from input when item has none', async () => {
    const items = [{ id: '1', title: 'Item' }]
    const result = await searchItems(provider, { query: 'test', items, collectionType: 'books' })
    expect(result.results[0].collectionType).toBe('books')
  })

  it('preserves item-level collectionType when present', async () => {
    const items = [{ id: '1', title: 'Item', collectionType: 'records' }]
    const result = await searchItems(provider, { query: 'test', items, collectionType: 'books' })
    expect(result.results[0].collectionType).toBe('records')
  })
})

// ---------------------------------------------------------------------------
// getItemDetail
// ---------------------------------------------------------------------------

describe('getItemDetail', () => {
  const provider = { supports: () => true, complete: async () => ({ content: {}, model: 'fake' }) }

  const sampleItem = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'Abbey Road',
    subtitle: '1969 Stereo',
    description: 'The iconic Beatles album',
    coverUrl: 'https://example.com/cover.jpg',
    providerIds: { discogs: '123', musicbrainz: '456' },
    canonicalAttributes: { artist: 'The Beatles', year: '1969', label: 'Apple', genre: 'Rock' },
    ownedAttributes: { status: 'identified', acquiredDate: '2024-01-15', condition: 'Near Mint' },
    // Private fields that must never leak
    notes: 'My personal favorite',
    grading: 'Mint',
    lending: 'John',
    status: 'identified',
  }

  it('returns item detail with allowlisted fields', async () => {
    const result = await getItemDetail(provider, { itemId: sampleItem.id, item: sampleItem })
    expect(result.id).toBe(sampleItem.id)
    expect(result.title).toBe('Abbey Road')
    expect(result.subtitle).toBe('1969 Stereo')
    expect(result.description).toBe('The iconic Beatles album')
    expect(result.coverUrl).toBe('https://example.com/cover.jpg')
    expect(result.providerIds).toEqual({ discogs: '123', musicbrainz: '456' })
    expect(result.status).toBe('identified')
  })

  it('applies data-minimization: excludes private fields (notes, grading, lending)', async () => {
    const result = await getItemDetail(provider, { itemId: sampleItem.id, item: sampleItem })
    expect(result.notes).toBeUndefined()
    expect(result.grading).toBeUndefined()
    expect(result.lending).toBeUndefined()
  })

  it('returns allowlisted canonical attributes', async () => {
    const result = await getItemDetail(provider, { itemId: sampleItem.id, item: sampleItem })
    expect(result.canonicalAttributes.artist).toBe('The Beatles')
    expect(result.canonicalAttributes.year).toBe('1969')
    expect(result.canonicalAttributes.label).toBe('Apple')
    // Non-allowlisted canonical attributes are excluded
    expect(result.canonicalAttributes.rating).toBeUndefined()
  })

  it('returns allowlisted owned attributes and excludes private ones', async () => {
    const result = await getItemDetail(provider, { itemId: sampleItem.id, item: sampleItem })
    // Allowlisted owned attributes
    expect(result.ownedAttributes.status).toBe('identified')
    expect(result.ownedAttributes.acquiredDate).toBe('2024-01-15')
    expect(result.ownedAttributes.condition).toBe('Near Mint')
    // Private owned attributes excluded
    expect(result.ownedAttributes.notes).toBeUndefined()
    expect(result.ownedAttributes.grading).toBeUndefined()
    expect(result.ownedAttributes.lending).toBeUndefined()
  })

  it('rejects a missing itemId', async () => {
    await expect(getItemDetail(provider, { item: sampleItem }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects an empty itemId', async () => {
    await expect(getItemDetail(provider, { itemId: '' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('returns a skeleton when no item data is provided', async () => {
    const result = await getItemDetail(provider, { itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    expect(result.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result.title).toBe('')
    expect(result.status).toBe('unknown')
  })

  it('rejects XSS-dangerous content in title', async () => {
    const dangerous = { ...sampleItem, title: '<script>alert(1)</script>' }
    await expect(getItemDetail(provider, { itemId: 'id', item: dangerous }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in description', async () => {
    const dangerous = { ...sampleItem, description: 'javascript:alert(1)' }
    await expect(getItemDetail(provider, { itemId: 'id', item: dangerous }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in canonicalAttributes', async () => {
    const dangerous = {
      ...sampleItem,
      canonicalAttributes: { artist: '<img onerror=alert(1)>' },
    }
    await expect(getItemDetail(provider, { itemId: 'id', item: dangerous }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('handles missing optional fields gracefully', async () => {
    const minimalItem = { id: 'aaaa', title: 'Minimal' }
    const result = await getItemDetail(provider, { itemId: 'aaaa', item: minimalItem })
    expect(result.id).toBe('aaaa')
    expect(result.title).toBe('Minimal')
    expect(result.subtitle).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.canonicalAttributes).toBeUndefined()
    expect(result.ownedAttributes).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getCollectionSummary
// ---------------------------------------------------------------------------

describe('getCollectionSummary', () => {
  const provider = { supports: () => true, complete: async () => ({ content: {}, model: 'fake' }) }

  it('returns the provided summary with validated counts', async () => {
    const result = await getCollectionSummary(provider, {
      summary: { totalItems: 42, identifiedCount: 30, draftCount: 10, byStatus: { identified: 30, draft: 10, archived: 2 } },
    })
    expect(result.totalItems).toBe(42)
    expect(result.identifiedCount).toBe(30)
    expect(result.draftCount).toBe(10)
    expect(result.byStatus.identified).toBe(30)
    expect(result.byStatus.draft).toBe(10)
    expect(result.byStatus.archived).toBe(2)
  })

  it('returns empty summary when no summary provided', async () => {
    const result = await getCollectionSummary(provider, {})
    expect(result.totalItems).toBe(0)
    expect(result.identifiedCount).toBe(0)
    expect(result.draftCount).toBe(0)
    expect(result.byStatus).toEqual({})
  })

  it('returns empty summary when summary is not an object', async () => {
    const result = await getCollectionSummary(provider, { summary: null })
    expect(result.totalItems).toBe(0)
  })

  it('clamps negative counts to 0', async () => {
    const result = await getCollectionSummary(provider, {
      summary: { totalItems: -5, identifiedCount: -1, draftCount: 0 },
    })
    expect(result.totalItems).toBe(0)
    expect(result.identifiedCount).toBe(0)
    expect(result.draftCount).toBe(0)
  })

  it('handles non-finite counts gracefully', async () => {
    const result = await getCollectionSummary(provider, {
      summary: { totalItems: NaN, identifiedCount: Infinity, draftCount: undefined },
    })
    expect(result.totalItems).toBe(0)
    expect(result.identifiedCount).toBe(0)
    expect(result.draftCount).toBe(0)
  })

  it('validates byStatus values are non-negative numbers', async () => {
    const result = await getCollectionSummary(provider, {
      summary: { byStatus: { identified: 30, draft: -5, invalid: 'string', nullVal: null } },
    })
    expect(result.byStatus.identified).toBe(30)
    expect(result.byStatus.draft).toBeUndefined() // negative excluded
    expect(result.byStatus.invalid).toBeUndefined() // string excluded
    expect(result.byStatus.nullVal).toBeUndefined()
  })

  it('rejects XSS-dangerous content in byStatus keys', async () => {
    await expect(getCollectionSummary(provider, {
      summary: { byStatus: { '<script>alert(1)</script>': 5 } },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('applies data-minimization: byStatus contains only counts, never item data', async () => {
    const result = await getCollectionSummary(provider, {
      summary: {
        totalItems: 42,
        identifiedCount: 30,
        draftCount: 10,
        byStatus: { identified: 30, draft: 10 },
        // Extra fields in summary should be ignored
        privateData: 'should not appear',
      },
    })
    expect(result.privateData).toBeUndefined()
  })

  it('floors decimal counts to integers', async () => {
    const result = await getCollectionSummary(provider, {
      summary: { totalItems: 42.7, identifiedCount: 30.2, byStatus: { identified: 30.9 } },
    })
    expect(result.totalItems).toBe(42)
    expect(result.identifiedCount).toBe(30)
    expect(result.byStatus.identified).toBe(30)
  })

  it('accepts collectionType parameter (informational only)', async () => {
    const result = await getCollectionSummary(provider, { collectionType: 'records', summary: { totalItems: 10 } })
    expect(result.totalItems).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// proposeMutation
// ---------------------------------------------------------------------------

describe('proposeMutation', () => {
  const provider = { supports: () => true, complete: async () => ({ content: {}, model: 'fake' }) }

  it('returns a validated draft for an update action', async () => {
    const result = await proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
      entityId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      changes: { title: 'New Title' },
    })
    expect(result.action).toBe('update')
    expect(result.entityType).toBe('collection_item')
    expect(result.entityId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result.changes).toEqual({ title: 'New Title' })
    expect(result.requiresConfirmation).toBe(true)
    expect(result.draftId).toBeDefined()
  })

  it('returns a draft for a delete action', async () => {
    const result = await proposeMutation(provider, {
      action: 'delete',
      entityType: 'collection_item',
      entityId: 'aaaa-bbbb-cccc-dddd-eeee',
    })
    expect(result.action).toBe('delete')
    expect(result.requiresConfirmation).toBe(true)
  })

  it('returns a draft for an add action', async () => {
    const result = await proposeMutation(provider, {
      action: 'add',
      entityType: 'collection',
      changes: { title: 'New Collection' },
    })
    expect(result.action).toBe('add')
    expect(result.entityType).toBe('collection')
    expect(result.requiresConfirmation).toBe(true)
  })

  it('works with review entity type', async () => {
    const result = await proposeMutation(provider, {
      action: 'update',
      entityType: 'review',
      changes: { rating: 5 },
    })
    expect(result.entityType).toBe('review')
  })

  it('works with lending entity type', async () => {
    const result = await proposeMutation(provider, {
      action: 'update',
      entityType: 'lending',
      changes: { borrower: 'John' },
    })
    expect(result.entityType).toBe('lending')
  })

  it('rejects an invalid action', async () => {
    await expect(proposeMutation(provider, {
      action: 'destroy',
      entityType: 'collection_item',
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects an invalid entityType', async () => {
    await expect(proposeMutation(provider, {
      action: 'update',
      entityType: 'user',
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects changes that are not an object', async () => {
    await expect(proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
      changes: 'not an object',
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects changes that are an array', async () => {
    await expect(proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
      changes: ['a', 'b'],
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in changes', async () => {
    await expect(proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
      changes: { title: '<script>alert(1)</script>' },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in nested changes', async () => {
    await expect(proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
      changes: { metadata: { description: 'javascript:alert(1)' } },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('accepts null changes', async () => {
    const result = await proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
      changes: null,
    })
    expect(result.changes).toEqual({})
    expect(result.requiresConfirmation).toBe(true)
  })

  it('accepts undefined changes', async () => {
    const result = await proposeMutation(provider, {
      action: 'update',
      entityType: 'collection_item',
    })
    expect(result.changes).toEqual({})
  })

  it('makes entityId optional', async () => {
    const result = await proposeMutation(provider, {
      action: 'add',
      entityType: 'collection_item',
      changes: { title: 'New Item' },
    })
    expect(result.entityId).toBeUndefined()
  })

  it('generates a unique draftId each time', async () => {
    const r1 = await proposeMutation(provider, { action: 'update', entityType: 'collection_item', changes: { title: 'A' } })
    const r2 = await proposeMutation(provider, { action: 'update', entityType: 'collection_item', changes: { title: 'B' } })
    expect(r1.draftId).not.toBe(r2.draftId)
  })

  it('requiresConfirmation is always true', async () => {
    const result = await proposeMutation(provider, { action: 'update', entityType: 'collection_item', changes: {} })
    expect(result.requiresConfirmation).toBe(true)
  })
})

describe('identifyFromImage', () => {
  const validCandidates = {
    candidates: [
      { title: 'Abbey Road', confidence: 0.95, source: 'cover' },
      { title: 'Let It Be', confidence: 0.7, source: 'cover' },
    ],
  }

  it('returns candidates for a valid image URL', async () => {
    const prov = fakeProvider({ content: validCandidates })
    const result = await identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
    })
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].title).toBe('Abbey Road')
    expect(result.candidates[0].confidence).toBe(0.95)
  })

  it('passes hints to the capability', async () => {
    const prov = fakeProvider({ content: validCandidates })
    const result = await identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
      hints: { collectionType: 'records' },
    })
    expect(result.candidates).toHaveLength(2)
  })

  it('throws on empty imageUrl', async () => {
    const prov = fakeProvider({ content: validCandidates })
    await expect(identifyFromImage(prov, {
      imageUrl: '',
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('throws on missing imageUrl', async () => {
    const prov = fakeProvider({ content: validCandidates })
    await expect(identifyFromImage(prov, {})).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('throws on non-string imageUrl', async () => {
    const prov = fakeProvider({ content: validCandidates })
    await expect(identifyFromImage(prov, {
      imageUrl: 123,
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('propagates provider errors', async () => {
    const prov = fakeProvider({
      completeImpl: async () => { throw new ProviderError(ProviderErrorCode.TIMEOUT, 'timed out', { retryable: true }) },
    })
    await expect(identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
    })).rejects.toMatchObject({ code: ProviderErrorCode.TIMEOUT })
  })

  it('rejects XSS-dangerous content in candidate titles', async () => {
    const prov = fakeProvider({
      content: {
        candidates: [
          { title: '<script>alert(1)</script>', confidence: 0.9 },
        ],
      },
    })
    await expect(identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in candidate source', async () => {
    const prov = fakeProvider({
      content: {
        candidates: [
          { title: 'Album', confidence: 0.9, source: 'javascript:alert(1)' },
        ],
      },
    })
    await expect(identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('handles empty candidates gracefully', async () => {
    const prov = fakeProvider({ content: { candidates: [] } })
    const result = await identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
    })
    expect(result.candidates).toEqual([])
  })

  it('handles provider that does not support the capability', async () => {
    const prov = fakeProvider({ content: validCandidates, supports: false })
    await expect(identifyFromImage(prov, {
      imageUrl: 'signed-url-token',
    })).rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })
})