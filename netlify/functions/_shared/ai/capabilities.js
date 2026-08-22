// capabilities.js — typed capability contracts for the AI runtime
// (ADMIN-3.1, #303, epic #302).
//
// The application does not call the provider directly with free-form prompts.
// Instead it invokes a small set of typed capabilities (classification,
// deduplication, prioritization, issue/epic generation). Each capability
// declares its input schema, its required output schema, and a bounded token
// ceiling. `runCapability` validates the input, calls the provider with the
// output schema, and returns the schema-validated result — so product/domain
// logic never touches provider-specific code (ADR-0006 isolation).
//
// Contract stability: #305 (feedback intelligence) consumes these contracts.
// Do not rename capability ids or change output schemas without a coordinated
// change.

import { ProviderError, ProviderErrorCode } from './provider'
import { validateSchema } from './schema'

// ---------------------------------------------------------------------------
// Capability registry.
// ---------------------------------------------------------------------------

// Classification: assign a category/visibility label to an item.
export const CLASSIFY = Object.freeze({
  id: 'classify',
  description: 'Classify an item into a category with a confidence score.',
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 500 },
      description: { type: 'string', maxLength: 4000 },
    },
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['category', 'confidence'],
    properties: {
      category: { type: 'string', minLength: 1, maxLength: 100 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  }),
  maxTokens: 256,
})

// Deduplication: given a candidate list, return the likely duplicate matches.
export const DEDUPLICATE = Object.freeze({
  id: 'deduplicate',
  description: 'Find likely duplicate matches among candidate items.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            subtitle: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  },
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['matches'],
    properties: {
      matches: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'score'],
          properties: {
            index: { type: 'integer', minimum: 0 },
            score: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  }),
  maxTokens: 512,
})

// Prioritization: rank a set of items by importance.
export const PRIORITIZE = Object.freeze({
  id: 'prioritize',
  description: 'Rank a set of items by priority.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'summary'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 100 },
            summary: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
  },
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['ranked'],
    properties: {
      ranked: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'score'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 100 },
            score: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  }),
  maxTokens: 512,
})

// Issue/epic generation: turn feedback into a structured issue/epic.
export const GENERATE_ISSUE_EPIC = Object.freeze({
  id: 'generateIssueEpic',
  description: 'Generate a structured issue or epic from feedback.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['feedback'],
    properties: {
      feedback: { type: 'string', minLength: 1, maxLength: 4000 },
      kind: { type: 'string', enum: ['issue', 'epic'] },
    },
  },
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      summary: { type: 'string', minLength: 1, maxLength: 2000 },
      acceptanceCriteria: {
        type: 'array',
        maxItems: 20,
        items: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  }),
  maxTokens: 1024,
})

// Metadata completion: fill missing canonical fields from partial input.
export const COMPLETE_METADATA = Object.freeze({
  id: 'completeMetadata',
  description: 'Suggest missing canonical fields (title, artist, label, year, genre, format) from partial input.',
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['itemId', 'existingFields'],
    properties: {
      itemId: { type: 'string', minLength: 36, maxLength: 36 },
      existingFields: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {
          title: { type: 'string', maxLength: 500 },
          subtitle: { type: 'string', maxLength: 500 },
          description: { type: 'string', maxLength: 4000 },
          providerIds: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } },
        },
      },
      providerHints: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', maxLength: 100 },
      },
    },
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['suggestedFields', 'confidence', 'source'],
    properties: {
      suggestedFields: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {
          title: { type: 'string', maxLength: 500 },
          subtitle: { type: 'string', maxLength: 500 },
          artist: { type: 'string', maxLength: 500 },
          label: { type: 'string', maxLength: 500 },
          year: { type: 'string', maxLength: 10 },
          genre: { type: 'string', maxLength: 200 },
          format: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 4000 },
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      source: { type: 'string', minLength: 1, maxLength: 200 },
    },
  }),
  maxTokens: 1024,
})

// Duplicate detection: find likely duplicate pairs within a collection.
export const FIND_DUPLICATES = Object.freeze({
  id: 'findDuplicates',
  description: 'Find likely duplicate items within a collection by comparing titles and provider ids.',
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['collectionType', 'candidates'],
    properties: {
      collectionType: { type: 'string', minLength: 1, maxLength: 100 },
      candidates: {
        type: 'array',
        minItems: 2,
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 36 },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            subtitle: { type: 'string', maxLength: 500 },
            providerIds: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } },
          },
        },
      },
      threshold: { type: 'number', minimum: 0.5, maximum: 1 },
    },
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['pairs'],
    properties: {
      pairs: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['itemA', 'itemB', 'score'],
          properties: {
            itemA: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'title'],
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 36 },
                title: { type: 'string', minLength: 1, maxLength: 500 },
              },
            },
            itemB: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'title'],
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 36 },
                title: { type: 'string', minLength: 1, maxLength: 500 },
              },
            },
            score: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  }),
  maxTokens: 1024,
})

// Assistant query: interpret a natural-language collection query and return a
// structured response with optional tool calls. This is the central capability
// for the conversational assistant (#333, ADR-0021 §2.1).
//
// The LLM receives the user's query, optional collection context, and available
// tool definitions. Its output tells the AI runtime what tools to call and how
// to phrase the final response.
//
// Data-minimization (ADR-0021 §3.1):
//   - Only the query text and allowlisted context fields are sent to the model.
//   - Private owned attributes (notes, grading, lending, wishlist) are never included.
//   - availableData is pre-minimized by the caller.
//
// "AI suggests; application decides" (ADR-0021 §4):
//   - Tool calls that produce mutations (proposeMutation) are returned as drafts.
//   - The LLM may suggest mutations but never executes them directly.
//   - requiresConfirmation: true means the caller must confirm before executing.
//
// XSS-safe (ADR-0021 §7):
//   - The output response text is validated by the caller via assertSafeStrings.
//   - toolCall arguments are schema-validated before dispatch.
export const ASSISTANT_QUERY = Object.freeze({
  id: 'assistantQuery',
  description: 'Answer a natural-language question about the user\'s collection by choosing which tools to call and generating a conversational response.',
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 2000 },
      collectionType: { type: 'string', maxLength: 100 },
      conversationHistory: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'content'],
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string', maxLength: 4000 },
          },
        },
      },
      availableTools: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', maxLength: 50 },
      },
      availableData: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {
          // Pre-fetched data that the assistant can reference without tool calls.
          // Data-minimization: only public/minimized fields are included.
          searchResults: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [],
              properties: {
                id: { type: 'string', maxLength: 36 },
                title: { type: 'string', maxLength: 500 },
                subtitle: { type: 'string', maxLength: 500 },
                collectionType: { type: 'string', maxLength: 100 },
                status: { type: 'string', maxLength: 50 },
              },
            },
          },
          collectionSummary: {
            type: 'object',
            additionalProperties: false,
            required: [],
            properties: {
              totalItems: { type: 'integer', minimum: 0 },
              identifiedCount: { type: 'integer', minimum: 0 },
              draftCount: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['response'],
    properties: {
      response: { type: 'string', minLength: 1, maxLength: 4000 },
      facts: {
        type: 'array',
        maxItems: 20,
        items: { type: 'string', maxLength: 500 },
      },
      estimates: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', maxLength: 500 },
      },
      recommendations: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', maxLength: 500 },
      },
      requiresConfirmation: { type: 'boolean' },
      toolCalls: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['tool', 'args'],
          properties: {
            tool: {
              type: 'string',
              enum: ['searchItems', 'getItemDetail', 'getCollectionSummary', 'proposeMutation', 'getCompletionSuggestions', 'getDuplicateSuggestions'],
            },
            args: { type: 'object' },
          },
        },
      },
      draftId: { type: 'string', maxLength: 36 },
    },
  }),
  maxTokens: 1024,
})

// The full registry, keyed by capability id.
export const CAPABILITIES = Object.freeze({
  [CLASSIFY.id]: CLASSIFY,
  [DEDUPLICATE.id]: DEDUPLICATE,
  [PRIORITIZE.id]: PRIORITIZE,
  [GENERATE_ISSUE_EPIC.id]: GENERATE_ISSUE_EPIC,
  [COMPLETE_METADATA.id]: COMPLETE_METADATA,
  [FIND_DUPLICATES.id]: FIND_DUPLICATES,
  [ASSISTANT_QUERY.id]: ASSISTANT_QUERY,
})

export function getCapability(id) {
  return CAPABILITIES[id] ?? null
}

// ---------------------------------------------------------------------------
// Capability runner.
// ---------------------------------------------------------------------------

// Validate `input` against a capability's input schema. Throws
// ProviderError(INVALID_OUTPUT) on violation — the caller passed a malformed
// payload, so fail closed rather than sending junk to the model.
function assertValidInput(capability, input) {
  const result = validateSchema(input, capability.inputSchema)
  if (!result.valid) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `Invalid ${capability.id} input: ${result.errors.join('; ')}`,
    )
  }
}

// Run a capability against a provider and return the schema-validated result.
//   provider — a Provider adapter that supports the capability.
//   capabilityId — one of the capability ids above.
//   input — the capability input payload.
//   options — optional bounded request overrides (timeoutMs, maxResponseBytes,
//             retries, temperature).
export async function runCapability(provider, capabilityId, input, options = {}) {
  const capability = getCapability(capabilityId)
  if (!capability) {
    throw new ProviderError(ProviderErrorCode.UNSUPPORTED, `Unknown capability: ${capabilityId}`)
  }
  if (!provider || typeof provider.complete !== 'function') {
    throw new ProviderError(ProviderErrorCode.UNSUPPORTED, 'A provider implementing complete() is required.')
  }
  if (typeof provider.supports === 'function' && !provider.supports(capabilityId)) {
    throw new ProviderError(ProviderErrorCode.UNSUPPORTED, `Provider does not support capability: ${capabilityId}`)
  }

  assertValidInput(capability, input)

  const result = await provider.complete({
    user: JSON.stringify(input),
    schema: capability.outputSchema,
    options: { ...options, maxTokens: capability.maxTokens },
  })

  // The adapter already schema-validated the output, but re-validate here as a
  // defense-in-depth guard so a misbehaving adapter can never pass junk through.
  const check = validateSchema(result.content, capability.outputSchema)
  if (!check.valid) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `Provider output failed ${capability.id} validation: ${check.errors.join('; ')}`,
    )
  }
  return result.content
}