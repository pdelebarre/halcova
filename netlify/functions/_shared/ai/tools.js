// tools.js — AI collection tool runners for metadata completion & duplicate detection
// (#334, ADR-0021 §2.2/§2.3, epic #331).
//
// Each tool is a typed, schema-validated operation that the AI runtime may invoke.
// Tools enforce data-minimization (only minimum necessary context reaches the model)
// and XSS-safe rendering (output strings are validated before return).
//
// Security (ADR-0006, ADR-0021):
//   - LLM output is untrusted and schema-validated via runCapability.
//   - Data-minimization: only canonical identity fields are sent to the model.
//     Private owned attributes (notes, grading, lending, wishlist) are never included.
//   - XSS-safe: all returned string values pass isSafeCanonicalString.
//   - Fail-closed: malformed/schema-invalid output is rejected.
//   - Provider errors (timeout, rate-limit, oversized) propagate as ProviderError.
//
// Contract stability: #333 (assistant) consumes these tool runners. Do not change
// the exported function signatures without a coordinated change.

import { ProviderError, ProviderErrorCode } from './provider'
import { runCapability } from './capabilities'
import { isSafeCanonicalString } from '../providers/payload-guard'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Validate that every string value in an object (recursive, depth-bounded) is
// XSS-safe. Throws ProviderError(INVALID_OUTPUT) on the first dangerous value.
// This is the defense-in-depth guard after schema validation: even if the schema
// allowed a string through, we reject dangerous content fail-closed.
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

// Strip private owned attributes from an existingFields object before sending
// to the model. Only canonical identity fields are allowed through.
// Data-minimization rule (ADR-0021 §3.1): private owned attributes (notes,
// grading, lending, wishlist) are never sent to the model.
function minimizeExistingFields(fields) {
  if (!fields || typeof fields !== 'object') return {}
  const ALLOWED = new Set(['title', 'subtitle', 'description', 'providerIds'])
  const result = {}
  for (const key of Object.keys(fields)) {
    if (ALLOWED.has(key)) {
      result[key] = fields[key]
    }
  }
  return result
}

// Strip private fields from a candidate item before sending to the model.
// Only id, title, subtitle, and providerIds are allowed.
function minimizeCandidate(item) {
  if (!item || typeof item !== 'object') return item
  const ALLOWED = new Set(['id', 'title', 'subtitle', 'providerIds'])
  const result = {}
  for (const key of Object.keys(item)) {
    if (ALLOWED.has(key)) {
      result[key] = item[key]
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// completeMetadata — fill missing canonical fields from partial input
// (ADR-0021 §2.2).
//
// Input: { itemId, existingFields, providerHints? }
// Output: { suggestedFields, confidence, source }
//
// Data-minimization: only canonical identity fields (title, subtitle,
// description, providerIds) from existingFields are sent to the model.
// Private owned attributes are excluded.
//
// XSS-safe: all string values in suggestedFields are validated before return.
// ---------------------------------------------------------------------------
export async function completeMetadata(provider, input, options = {}) {
  // Apply data-minimization: strip private fields before sending to the model.
  const minimizedInput = {
    itemId: input.itemId,
    existingFields: minimizeExistingFields(input.existingFields),
  }
  // Only include providerHints when provided (optional field).
  if (Array.isArray(input.providerHints) && input.providerHints.length > 0) {
    minimizedInput.providerHints = input.providerHints
  }

  const result = await runCapability(provider, 'completeMetadata', minimizedInput, options)

  // XSS-safe: validate all returned string values.
  assertSafeStrings(result.suggestedFields, '$.suggestedFields')

  return result
}

// ---------------------------------------------------------------------------
// findDuplicates — find likely duplicate pairs within a collection
// (ADR-0021 §2.3).
//
// Input: { collectionType, candidates, threshold? }
// Output: { pairs: [{ itemA: { id, title }, itemB: { id, title }, score, reason? }] }
//
// Data-minimization: only id, title, subtitle, and providerIds from each
// candidate are sent to the model. Private fields are excluded.
//
// XSS-safe: all string values in pairs (title, reason) are validated before
// return.
// ---------------------------------------------------------------------------
export async function findDuplicates(provider, input, options = {}) {
  // Return empty pairs when there are fewer than 2 candidates (schema requires minItems: 2).
  const candidates = input.candidates || []
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return { pairs: [] }
  }

  // Apply data-minimization: strip private fields from each candidate.
  const minimizedInput = {
    collectionType: input.collectionType,
    candidates: candidates.map(minimizeCandidate),
  }
  // Only include threshold when provided (optional field).
  if (typeof input.threshold === 'number' && input.threshold >= 0.5 && input.threshold <= 1) {
    minimizedInput.threshold = input.threshold
  }

  const result = await runCapability(provider, 'findDuplicates', minimizedInput, options)

  // XSS-safe: validate all string values in the result pairs.
  assertSafeStrings(result.pairs, '$.pairs')

  return result
}

// ---------------------------------------------------------------------------
// getCompletionSuggestions — assistant-facing tool that returns items with
// missing canonical fields and AI-suggested completions
// (ADR-0021 §2.1 assistant tools table).
//
// Input: { collectionType?, limit? (1-20) }
// Output: { suggestions: [{ itemId, title, missingFields: string[],
//           suggestedValues: object }] }
//
// This is a higher-level tool that calls completeMetadata for each item with
// missing fields. In practice the caller (assistant or capability runner)
// batches items and calls completeMetadata per item.
// ---------------------------------------------------------------------------
export async function getCompletionSuggestions(provider, input, options = {}) {
  const { collectionType, limit = 10, items = [] } = input

  if (!Array.isArray(items) || items.length === 0) {
    return { suggestions: [] }
  }

  const capped = items.slice(0, Math.min(limit, 20))
  const suggestions = []

  for (const item of capped) {
    try {
      // Build existingFields with only defined values (data-minimization).
      const existingFields = {}
      if (item.title) existingFields.title = item.title
      if (item.subtitle) existingFields.subtitle = item.subtitle
      if (item.description) existingFields.description = item.description
      if (item.providerIds) existingFields.providerIds = item.providerIds

      const result = await completeMetadata(provider, {
        itemId: item.id,
        existingFields,
        providerHints: item.providerHints,
      }, options)

      // Determine which fields are missing (not in existingFields) and were suggested.
      const existingKeys = new Set(Object.keys(item.existingFields || {}))
      const missingFields = Object.keys(result.suggestedFields).filter(
        (k) => !existingKeys.has(k) && result.suggestedFields[k] !== undefined && result.suggestedFields[k] !== '',
      )

      if (missingFields.length > 0) {
        suggestions.push({
          itemId: item.id,
          title: item.title,
          missingFields,
          suggestedValues: result.suggestedFields,
          confidence: result.confidence,
        })
      }
    } catch {
      // Skip items that fail completion (provider error, invalid output, etc.)
      // The caller can retry individually if needed.
    }
  }

  return { suggestions }
}

// ---------------------------------------------------------------------------
// getDuplicateSuggestions — assistant-facing tool that returns duplicate
// candidate pairs with similarity scores
// (ADR-0021 §2.1 assistant tools table).
//
// Input: { collectionType?, limit? (1-20) }
// Output: { suggestions: [{ itemId, duplicateOfId, title, score, reason }] }
//
// This is a higher-level tool that calls findDuplicates and maps the result
// to the assistant-facing format.
// ---------------------------------------------------------------------------
export async function getDuplicateSuggestions(provider, input, options = {}) {
  const { collectionType, limit = 10, candidates = [] } = input

  if (!Array.isArray(candidates) || candidates.length < 2) {
    return { suggestions: [] }
  }

  const result = await findDuplicates(provider, {
    collectionType: collectionType || 'unknown',
    candidates,
    ...(typeof input.threshold === 'number' ? { threshold: input.threshold } : {}),
  }, options)

  // Map findDuplicates pairs to the assistant-facing suggestion format.
  const capped = (result.pairs || []).slice(0, Math.min(limit, 20))
  const suggestions = capped.map((pair) => ({
    itemId: pair.itemA.id,
    duplicateOfId: pair.itemB.id,
    title: pair.itemA.title,
    score: pair.score,
    reason: pair.reason || `Similar to "${pair.itemB.title}"`,
  }))

  return { suggestions }
}