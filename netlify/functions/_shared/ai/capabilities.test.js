// @vitest-environment node
//
// Unit suite for the capability contracts
// (netlify/functions/_shared/ai/capabilities.js, ADMIN-3.1 #303). Verifies the
// registry, input validation, provider capability gating, and the defense-in-
// depth output re-validation that keeps product logic isolated from provider
// specifics.
import { describe, expect, it, vi } from 'vitest'
import {
  CAPABILITIES,
  CLASSIFY,
  COMPLETE_METADATA,
  DEDUPLICATE,
  FIND_DUPLICATES,
  PRIORITIZE,
  GENERATE_ISSUE_EPIC,
  getCapability,
  runCapability,
} from './capabilities'
import { ProviderError, ProviderErrorCode } from './provider'

// A fake provider that returns a canned content value.
function fakeProvider({ content, supports = true, completeImpl } = {}) {
  return {
    supports: () => supports,
    complete: vi.fn(completeImpl ?? (async () => ({ content, model: 'fake' }))),
  }
}

describe('capability registry', () => {
  it('exposes all four capability contracts', () => {
    expect(CAPABILITIES.classify).toBe(CLASSIFY)
    expect(CAPABILITIES.deduplicate).toBe(DEDUPLICATE)
    expect(CAPABILITIES.prioritize).toBe(PRIORITIZE)
    expect(CAPABILITIES.generateIssueEpic).toBe(GENERATE_ISSUE_EPIC)
  })

  it('looks up a capability by id and rejects unknown ids', () => {
    expect(getCapability('classify')).toBe(CLASSIFY)
    expect(getCapability('nope')).toBeNull()
  })

  it('declares bounded token ceilings', () => {
    expect(CLASSIFY.maxTokens).toBeLessThanOrEqual(1024)
    expect(DEDUPLICATE.maxTokens).toBeLessThanOrEqual(1024)
    expect(PRIORITIZE.maxTokens).toBeLessThanOrEqual(1024)
    expect(GENERATE_ISSUE_EPIC.maxTokens).toBeLessThanOrEqual(1024)
  })
})

describe('runCapability', () => {
  it('returns the schema-validated result for a valid classify input', async () => {
    const provider = fakeProvider({ content: { category: 'books', confidence: 0.9 } })
    const out = await runCapability(provider, 'classify', {
      title: 'A Book',
      description: 'A description',
    })
    expect(out).toEqual({ category: 'books', confidence: 0.9 })
  })

  it('passes the output schema and bounded maxTokens to the provider', async () => {
    const provider = fakeProvider({ content: { category: 'x', confidence: 0.5 } })
    await runCapability(provider, 'classify', { title: 't', description: 'd' })
    const [request] = provider.complete.mock.calls[0]
    expect(request.schema).toBe(CLASSIFY.outputSchema)
    expect(request.options.maxTokens).toBe(CLASSIFY.maxTokens)
  })

  it('rejects an unknown capability id', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'nope', {}))
      .rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('rejects a provider that does not support the capability', async () => {
    const provider = fakeProvider({ content: {}, supports: false })
    await expect(runCapability(provider, 'classify', { title: 't', description: 'd' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('rejects a provider without a complete() method', async () => {
    await expect(runCapability({}, 'classify', { title: 't', description: 'd' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('rejects a null provider', async () => {
    await expect(runCapability(null, 'classify', { title: 't', description: 'd' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

it('proceeds when supports() is not a function (no gating)', async () => {
    const provider = { complete: vi.fn(async () => ({ content: { category: 'x', confidence: 0.5 } })), supports: 'not-a-function' }
    const out = await runCapability(provider, 'classify', { title: 't', description: 'd' })
    expect(out.category).toBe('x')
    expect(provider.complete).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed input before calling the provider', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'classify', { title: 't' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
    expect(provider.complete).not.toHaveBeenCalled()
  })

  it('rejects output that fails the schema even if the adapter passed it through', async () => {
    // A misbehaving adapter returns junk; the runner must still fail closed.
    const provider = fakeProvider({ content: { category: 'books', confidence: 'high' } })
    await expect(runCapability(provider, 'classify', { title: 't', description: 'd' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('propagates a ProviderError thrown by the provider', async () => {
    const provider = fakeProvider({
      completeImpl: async () => {
        throw new ProviderError(ProviderErrorCode.RATE_LIMIT, 'slow down')
      },
    })
    await expect(runCapability(provider, 'classify', { title: 't', description: 'd' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.RATE_LIMIT })
  })

  it('runs the deduplicate capability end to end', async () => {
    const provider = fakeProvider({ content: { matches: [{ index: 0, score: 0.8 }] } })
    const out = await runCapability(provider, 'deduplicate', {
      candidates: [{ title: 'Same Book' }],
    })
    expect(out.matches).toEqual([{ index: 0, score: 0.8 }])
  })

  it('runs the prioritize capability end to end', async () => {
    const provider = fakeProvider({ content: { ranked: [{ id: 'a', score: 0.9 }] } })
    const out = await runCapability(provider, 'prioritize', {
      items: [{ id: 'a', summary: 'Fix the scanner' }],
    })
    expect(out.ranked).toEqual([{ id: 'a', score: 0.9 }])
  })

  it('runs the issue/epic capability end to end', async () => {
    const provider = fakeProvider({
      content: { title: 'Scanner bug', summary: 'It crashes', acceptanceCriteria: ['Repro'] },
    })
    const out = await runCapability(provider, 'generateIssueEpic', {
      feedback: 'The scanner crashes on iOS',
      kind: 'issue',
    })
    expect(out.title).toBe('Scanner bug')
    expect(out.acceptanceCriteria).toEqual(['Repro'])
  })

  // ---------------------------------------------------------------------------
  // COMPLETE_METADATA capability tests
  // ---------------------------------------------------------------------------

  it('exposes COMPLETE_METADATA in the registry', () => {
    expect(CAPABILITIES.completeMetadata).toBe(COMPLETE_METADATA)
    expect(getCapability('completeMetadata')).toBe(COMPLETE_METADATA)
  })

  it('declares a bounded token ceiling for COMPLETE_METADATA', () => {
    expect(COMPLETE_METADATA.maxTokens).toBeLessThanOrEqual(1024)
  })

  it('runs completeMetadata end to end with valid input', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'Abbey Road', artist: 'The Beatles', year: '1969' },
        confidence: 0.95,
        source: 'openai',
      },
    })
    const out = await runCapability(provider, 'completeMetadata', {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: { title: 'Abbey' },
    })
    expect(out.suggestedFields.title).toBe('Abbey Road')
    expect(out.confidence).toBe(0.95)
    expect(out.source).toBe('openai')
  })

  it('rejects completeMetadata input missing required itemId', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'completeMetadata', {
      existingFields: { title: 'Abbey' },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
    expect(provider.complete).not.toHaveBeenCalled()
  })

  it('rejects completeMetadata input with invalid itemId type', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'completeMetadata', {
      itemId: 123,
      existingFields: { title: 'Abbey' },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects completeMetadata output missing required fields', async () => {
    const provider = fakeProvider({ content: { suggestedFields: { title: 'A' } } })
    await expect(runCapability(provider, 'completeMetadata', {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: { title: 'A' },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects completeMetadata output with confidence out of range', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'A' },
        confidence: 1.5,
        source: 'test',
      },
    })
    await expect(runCapability(provider, 'completeMetadata', {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: { title: 'A' },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects completeMetadata output with unknown properties', async () => {
    const provider = fakeProvider({
      content: {
        suggestedFields: { title: 'A' },
        confidence: 0.9,
        source: 'test',
        extraField: 'not allowed',
      },
    })
    await expect(runCapability(provider, 'completeMetadata', {
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      existingFields: { title: 'A' },
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  // ---------------------------------------------------------------------------
  // FIND_DUPLICATES capability tests
  // ---------------------------------------------------------------------------

  it('exposes FIND_DUPLICATES in the registry', () => {
    expect(CAPABILITIES.findDuplicates).toBe(FIND_DUPLICATES)
    expect(getCapability('findDuplicates')).toBe(FIND_DUPLICATES)
  })

  it('declares a bounded token ceiling for FIND_DUPLICATES', () => {
    expect(FIND_DUPLICATES.maxTokens).toBeLessThanOrEqual(1024)
  })

  it('runs findDuplicates end to end with valid input', async () => {
    const provider = fakeProvider({
      content: {
        pairs: [
          {
            itemA: { id: 'a1', title: 'Abbey Road' },
            itemB: { id: 'b1', title: 'Abbey Road (Remastered)' },
            score: 0.92,
            reason: 'Same title, different edition',
          },
        ],
      },
    })
    const out = await runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'Abbey Road' },
        { id: 'b1', title: 'Abbey Road (Remastered)' },
      ],
    })
    expect(out.pairs).toHaveLength(1)
    expect(out.pairs[0].score).toBe(0.92)
    expect(out.pairs[0].itemA.id).toBe('a1')
  })

  it('rejects findDuplicates input with fewer than 2 candidates', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [{ id: 'a1', title: 'Only One' }],
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
    expect(provider.complete).not.toHaveBeenCalled()
  })

  it('rejects findDuplicates input with more than 50 candidates', async () => {
    const provider = fakeProvider({ content: {} })
    const manyCandidates = Array.from({ length: 51 }, (_, i) => ({ id: `id${i}`, title: `Item ${i}` }))
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: manyCandidates,
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects findDuplicates output with missing required fields', async () => {
    const provider = fakeProvider({ content: { pairs: [{ itemA: { id: 'a1', title: 'A' } }] } })
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'A' },
        { id: 'b1', title: 'B' },
      ],
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects findDuplicates output with score out of range', async () => {
    const provider = fakeProvider({
      content: {
        pairs: [
          {
            itemA: { id: 'a1', title: 'A' },
            itemB: { id: 'b1', title: 'B' },
            score: 1.5,
          },
        ],
      },
    })
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'A' },
        { id: 'b1', title: 'B' },
      ],
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects findDuplicates output with unknown properties', async () => {
    const provider = fakeProvider({
      content: {
        pairs: [
          {
            itemA: { id: 'a1', title: 'A' },
            itemB: { id: 'b1', title: 'B' },
            score: 0.8,
            extra: 'not allowed',
          },
        ],
      },
    })
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'A' },
        { id: 'b1', title: 'B' },
      ],
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects findDuplicates input with threshold below 0.5', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'A' },
        { id: 'b1', title: 'B' },
      ],
      threshold: 0.1,
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects findDuplicates input with threshold above 1.0', async () => {
    const provider = fakeProvider({ content: {} })
    await expect(runCapability(provider, 'findDuplicates', {
      collectionType: 'records',
      candidates: [
        { id: 'a1', title: 'A' },
        { id: 'b1', title: 'B' },
      ],
      threshold: 2.0,
    })).rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })
})