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

// The full registry, keyed by capability id.
export const CAPABILITIES = Object.freeze({
  [CLASSIFY.id]: CLASSIFY,
  [DEDUPLICATE.id]: DEDUPLICATE,
  [PRIORITIZE.id]: PRIORITIZE,
  [GENERATE_ISSUE_EPIC.id]: GENERATE_ISSUE_EPIC,
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