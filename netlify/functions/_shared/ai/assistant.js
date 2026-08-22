// assistant.js — Natural-Language Collection Assistant orchestrator
// (#333, ADR-0021 §2.1/§4.3, epic #331).
//
// The assistant lets users interact with their collection via natural language.
// It uses the ASSISTANT_QUERY capability to interpret queries, then returns
// a structured response that the caller (assistant endpoint or UX) renders.
//
// Architecture (ADR-0021 §1):
//   Browser / PWA  →  AI Endpoint  →  AI Runtime (this module)
//       ├── Provider Adapter → LLM (schema-validated output)
//       ├── Collection Tools (read-only search/read)
//       └── Mutation Drafts (validated application commands)
//
// Security (ADR-0006, ADR-0021):
//   - LLM output is untrusted and schema-validated via runCapability.
//   - "AI suggests; application decides" — mutations are returned as drafts.
//   - Data-minimization: only minimum necessary context reaches the model.
//   - XSS-safe: all returned string values are validated before return.
//   - Cost bounded: per-call limits and per-user quotas (enforced by caller).

import { ProviderError, ProviderErrorCode } from './provider'
import { runCapability } from './capabilities'
import { isSafeCanonicalString } from '../providers/payload-guard'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Validate that every string value in an object (recursive, depth-bounded) is
// XSS-safe. Throws ProviderError(INVALID_OUTPUT) on the first dangerous value.
function assertSafeStrings(value, path = '$', depth = 0) {
  if (depth > 8) return // safety valve — stop descending
  if (typeof value === 'string') {
    if (!isSafeCanonicalString(value)) {
      throw new ProviderError(
        ProviderErrorCode.INVALID_OUTPUT,
        `XSS-safe guard rejected content at ${path}`,
      )
    }
    return
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assertSafeStrings(value[key], `${path}.${key}`, depth + 1)
    }
  }
}

// Strip private owned attributes from availableData before sending to the
// model. Only public canonical fields are allowed through.
// Data-minimization rule (ADR-0021 §3.1): private owned attributes (notes,
// grading, lending, wishlist) are never sent to the model.
function minimizeAvailableData(data) {
  if (!data || typeof data !== 'object') return {}

  const result = {}

  // Minimize searchResults — only allow public fields
  if (Array.isArray(data.searchResults)) {
    result.searchResults = data.searchResults.map((item) => {
      const r = {}
      if (item.id) r.id = item.id
      if (item.title) r.title = item.title
      if (item.subtitle) r.subtitle = item.subtitle
      if (item.collectionType) r.collectionType = item.collectionType
      if (item.status) r.status = item.status
      return r
    })
  }

  // Pass through collectionSummary (aggregated counts only — no item data)
  if (data.collectionSummary && typeof data.collectionSummary === 'object') {
    result.collectionSummary = {
      totalItems: data.collectionSummary.totalItems,
      identifiedCount: data.collectionSummary.identifiedCount,
      draftCount: data.collectionSummary.draftCount,
    }
  }

  return result
}

// Define the default set of tools the assistant may call.
// These names match the exported functions from tools.js.
const DEFAULT_AVAILABLE_TOOLS = Object.freeze([
  'searchItems',
  'getItemDetail',
  'getCollectionSummary',
  'proposeMutation',
])

// ---------------------------------------------------------------------------
// runAssistantTurn — execute a single assistant turn
//
// Input (from caller/endpoint):
//   { query, collectionType?, conversationHistory?, availableData?,
//     availableTools? }
//
// Output (to caller/UX):
//   { response, facts?, estimates?, recommendations?, requiresConfirmation?,
//     draftId? }
//
// The caller is responsible for:
//   1. Authenticating the user and authorizing the request.
//   2. Enforcing per-user quotas and rate limits.
//   3. Executing any mutation drafts after user confirmation.
//   4. Providing the actual collection data via availableData.
//
// The LLM never directly writes to the database, calls internal APIs, or
// bypasses authorization (ADR-0021 §4.1).
// ---------------------------------------------------------------------------
export async function runAssistantTurn(provider, input, options = {}) {
  const {
    query,
    collectionType,
    conversationHistory = [],
    availableData = {},
    availableTools = DEFAULT_AVAILABLE_TOOLS,
  } = input

  // Validate query
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      'runAssistantTurn: a non-empty query string is required',
    )
  }

  // Validate provider
  if (!provider || typeof provider.complete !== 'function') {
    throw new ProviderError(
      ProviderErrorCode.UNSUPPORTED,
      'runAssistantTurn: a provider implementing complete() is required',
    )
  }

  // Build the capability input with data-minimization
  const capabilityInput = {
    query: query.trim().slice(0, 2000), // hard cap on query length
    conversationHistory: Array.isArray(conversationHistory)
      ? conversationHistory.slice(-10) // keep last 10 turns for context
      : [],
    availableTools: Array.isArray(availableTools) ? availableTools : DEFAULT_AVAILABLE_TOOLS,
    availableData: minimizeAvailableData(availableData),
  }
  // Only include collectionType when present (optional field)
  if (collectionType) {
    capabilityInput.collectionType = collectionType
  }

  // Call the LLM to interpret the query (schema-validated output)
  const result = await runCapability(provider, 'assistantQuery', capabilityInput, options)

  // XSS-safe: validate all string values in the output
  assertSafeStrings(result.response, '$.response')
  if (result.facts) assertSafeStrings(result.facts, '$.facts')
  if (result.estimates) assertSafeStrings(result.estimates, '$.estimates')
  if (result.recommendations) assertSafeStrings(result.recommendations, '$.recommendations')

  // Build the response for the caller
  const response = {
    response: result.response,
    facts: result.facts || [],
    estimates: result.estimates || [],
    recommendations: result.recommendations || [],
    requiresConfirmation: result.requiresConfirmation === true,
  }

  // Include draftId when present (mutation draft flow, ADR-0021 §4.3)
  if (result.draftId) {
    response.draftId = result.draftId
  }

  // Include toolCalls when present (for the endpoint to dispatch)
  if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
    response.toolCalls = result.toolCalls
  }

  return response
}
