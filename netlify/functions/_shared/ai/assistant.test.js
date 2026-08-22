// @vitest-environment node
//
// Unit suite for the Natural-Language Collection Assistant orchestrator
// (netlify/functions/_shared/ai/assistant.js, #333, ADR-0021 §2.1/§4.3).
//
// Verifies:
//   - Happy-path assistant turn with valid query and response
//   - Data-minimization: private fields are stripped before reaching the model
//   - XSS-safe rendering: dangerous content in output is rejected fail-closed
//   - Provider error propagation (timeout, rate-limit, invalid output)
//   - Adversarial negatives: malformed/schema-invalid output rejected
//   - Mutation draft flow: requiresConfirmation is surfaced correctly
import { describe, expect, it, vi } from 'vitest'
import { ProviderError, ProviderErrorCode } from './provider'
import { runAssistantTurn } from './assistant'

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

// Default valid responses
const validResponse = {
  response: 'You own 3 Beatles albums: Abbey Road, Sgt. Pepper, and Revolver.',
  facts: ['You own 3 Beatles albums'],
  estimates: [],
  recommendations: ['Consider adding "Let It Be" to complete your collection'],
}

const validResponseWithDraft = {
  response: 'I can update the title to "Abbey Road (Remastered)".',
  facts: ['Current title is "Abbey Road"'],
  estimates: [],
  recommendations: [],
  requiresConfirmation: true,
  draftId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
}

// ---------------------------------------------------------------------------
// runAssistantTurn
// ---------------------------------------------------------------------------

describe('runAssistantTurn', () => {
  it('returns a conversational response for a valid query', async () => {
    const provider = fakeProvider({ content: validResponse })
    const result = await runAssistantTurn(provider, {
      query: 'Which Beatles records do I own?',
      collectionType: 'records',
    })
    expect(result.response).toBe(validResponse.response)
    expect(result.facts).toEqual(validResponse.facts)
    expect(result.recommendations).toEqual(validResponse.recommendations)
  })

  it('passes the query and collectionType to the assistantQuery capability', async () => {
    const provider = fakeProvider({ content: validResponse })
    await runAssistantTurn(provider, {
      query: 'What is my most valuable item?',
      collectionType: 'records',
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    expect(sentInput.query).toBe('What is my most valuable item?')
    expect(sentInput.collectionType).toBe('records')
  })

  it('includes conversation history (capped at last 10 turns)', async () => {
    const provider = fakeProvider({ content: validResponse })
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${i}`,
    }))
    await runAssistantTurn(provider, {
      query: 'Tell me more',
      conversationHistory: history,
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    // Should be capped at 10 entries
    expect(sentInput.conversationHistory.length).toBe(10)
    expect(sentInput.conversationHistory[0].content).toBe('Turn 5')
  })

  it('applies data-minimization: strips private fields from availableData', async () => {
    const provider = fakeProvider({ content: validResponse })
    await runAssistantTurn(provider, {
      query: 'Show my collection',
      availableData: {
        searchResults: [
          { id: '1', title: 'Abbey Road', notes: 'Private', grading: 'Mint' },
          { id: '2', title: 'Sgt. Pepper', lending: 'John' },
        ],
        collectionSummary: { totalItems: 42, identifiedCount: 30, draftCount: 10 },
      },
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    // Private fields must not be in the sent input
    expect(sentInput.availableData.searchResults[0].notes).toBeUndefined()
    expect(sentInput.availableData.searchResults[0].grading).toBeUndefined()
    expect(sentInput.availableData.searchResults[1].lending).toBeUndefined()
    // Public fields must be preserved
    expect(sentInput.availableData.searchResults[0].title).toBe('Abbey Road')
    expect(sentInput.availableData.searchResults[0].id).toBe('1')
    // Summary preserved
    expect(sentInput.availableData.collectionSummary.totalItems).toBe(42)
  })

  it('includes default availableTools when not provided', async () => {
    const provider = fakeProvider({ content: validResponse })
    await runAssistantTurn(provider, { query: 'Hello' })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    expect(sentInput.availableTools).toContain('searchItems')
    expect(sentInput.availableTools).toContain('proposeMutation')
  })

  it('passes custom availableTools when provided', async () => {
    const provider = fakeProvider({ content: validResponse })
    await runAssistantTurn(provider, {
      query: 'Find duplicates',
      availableTools: ['searchItems', 'getItemDetail'],
    })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    expect(sentInput.availableTools).toEqual(['searchItems', 'getItemDetail'])
  })

  it('rejects an empty query', async () => {
    const provider = fakeProvider({ content: validResponse })
    await expect(runAssistantTurn(provider, { query: '' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects a missing query', async () => {
    const provider = fakeProvider({ content: validResponse })
    await expect(runAssistantTurn(provider, {}))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects null provider', async () => {
    await expect(runAssistantTurn(null, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('rejects a provider without complete() method', async () => {
    await expect(runAssistantTurn({}, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.UNSUPPORTED })
  })

  it('rejects XSS-dangerous content in response', async () => {
    const provider = fakeProvider({
      content: { response: '<script>alert(1)</script>' },
    })
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in facts', async () => {
    const provider = fakeProvider({
      content: { response: 'Safe', facts: ['javascript:alert(1)'] },
    })
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in recommendations', async () => {
    const provider = fakeProvider({
      content: { response: 'Safe', recommendations: ['<img onerror=alert(1)>'] },
    })
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects XSS-dangerous content in estimates', async () => {
    const provider = fakeProvider({
      content: { response: 'Safe', estimates: ['<script>alert(1)</script>'] },
    })
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('provides default empty arrays for facts, estimates, recommendations', async () => {
    const provider = fakeProvider({
      content: { response: 'Just a response.' },
    })
    const result = await runAssistantTurn(provider, { query: 'Hello' })
    expect(result.response).toBe('Just a response.')
    expect(result.facts).toEqual([])
    expect(result.estimates).toEqual([])
    expect(result.recommendations).toEqual([])
  })

  it('propagates provider timeout error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.TIMEOUT, 'timed out')
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.TIMEOUT })
  })

  it('propagates provider rate-limit error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.RATE_LIMIT, 'rate limited')
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.RATE_LIMIT })
  })

  it('propagates provider invalid output error', async () => {
    const provider = fakeProviderThatThrows(ProviderErrorCode.INVALID_OUTPUT, 'bad output')
    await expect(runAssistantTurn(provider, { query: 'Hello' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('surfaces requiresConfirmation when the LLM returns it', async () => {
    const provider = fakeProvider({ content: validResponseWithDraft })
    const result = await runAssistantTurn(provider, { query: 'Update title' })
    expect(result.requiresConfirmation).toBe(true)
    expect(result.draftId).toBe(validResponseWithDraft.draftId)
  })

  it('sets requiresConfirmation to false by default', async () => {
    const provider = fakeProvider({ content: validResponse })
    const result = await runAssistantTurn(provider, { query: 'Hello' })
    expect(result.requiresConfirmation).toBe(false)
  })

  it('includes toolCalls when the LLM returns them', async () => {
    const provider = fakeProvider({
      content: {
        ...validResponse,
        toolCalls: [
          { tool: 'searchItems', args: { query: 'Beatles', collectionType: 'records' } },
        ],
      },
    })
    const result = await runAssistantTurn(provider, { query: 'Find Beatles records' })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].tool).toBe('searchItems')
    expect(result.toolCalls[0].args.query).toBe('Beatles')
  })

  it('hard-caps query length at 2000 characters', async () => {
    const provider = fakeProvider({ content: validResponse })
    const longQuery = 'x'.repeat(5000)
    await runAssistantTurn(provider, { query: longQuery })
    const [request] = provider.complete.mock.calls[0]
    const sentInput = JSON.parse(request.user)
    expect(sentInput.query.length).toBe(2000)
  })

  it('works with trivial conversation history', async () => {
    const provider = fakeProvider({ content: validResponse })
    const result = await runAssistantTurn(provider, {
      query: 'Hello',
      conversationHistory: [],
    })
    expect(result.response).toBeDefined()
  })

  it('works without collectionType', async () => {
    const provider = fakeProvider({ content: validResponse })
    const result = await runAssistantTurn(provider, { query: 'What do I own?' })
    expect(result.response).toBeDefined()
  })

  it('handles null conversationHistory (coerces to empty array)', async () => {
    const provider = fakeProvider({ content: validResponse })
    const result = await runAssistantTurn(provider, { query: 'Hello', conversationHistory: null })
    expect(result.response).toBeDefined()
  })
})