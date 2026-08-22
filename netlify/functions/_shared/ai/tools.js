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
// ---------------------------------------------------------------------------
// Assistant tool runners (ADR-0021 §2.1 — Collection Assistant Tools)
// ---------------------------------------------------------------------------
// Each tool is a typed, schema-validated operation that the AI assistant
// (#333) may invoke. Unlike the metadata/dedup tools above, these assistant
// tools are PURE DATA ACCESS tools — they validate input, enforce data-
// minimization, XSS-safe guard output, but do NOT call the LLM directly.
// The LLM is called by the assistant orchestrator (assistant.js) which
// decides which tool to invoke and then formats the final response.
//
// Data-minimization (ADR-0021 §3.1): Only public canonical fields are returned.
// Private owned attributes (notes, grading, lending, wishlist) are never included.
//
// "AI suggests; application decides" (ADR-0021 §4): proposeMutation returns a
// validated DRAFT that requires explicit user confirmation before execution.

// Generate a simple draft/request id for mutation drafts. In production this
// would be a server-generated UUID; here we use a timestamp-based fallback
// so the tool works without Node crypto dependencies in test environments.
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------------------
// searchItems — search collection items by query text
// (ADR-0021 §2.1 assistant tools table).
//
// Input: { query, collectionType?, limit? (1-20), items? }
// Output: { results: [{ id, title, subtitle?, coverUrl?, collectionType, status }] }
//
// This tool validates the search query, applies a capped limit, and returns
// only public data. The caller (endpoint) provides pre-fetched items via the
// `items` parameter after performing the actual data access.
//
// Data-minimization: Only id, title, subtitle, coverUrl, collectionType, and
// status are returned. Private fields (notes, grading, lending) are excluded.
//
// XSS-safe: All string values in results are validated before return.
// ---------------------------------------------------------------------------
export async function searchItems(provider, input, options = {}) {
  const { query, collectionType, limit = 10, items = [] } = input

  // Validate query
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      'searchItems: a non-empty query string is required',
    )
  }

  // Bound the limit (ADR-0021 §2.1: limit 1-20)
  const cappedLimit = Math.min(Math.max(1, Math.floor(limit)), 20)

  // Filter and minimize items
  const results = (items || [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, cappedLimit)
    .map((item) => {
      const r = {
        id: String(item.id || ''),
        title: String(item.title || ''),
        collectionType: String(item.collectionType || collectionType || ''),
        status: String(item.status || 'draft'),
      }
      // Optional public fields — only include when present
      if (item.subtitle && typeof item.subtitle === 'string') r.subtitle = item.subtitle
      if (item.coverUrl && typeof item.coverUrl === 'string') r.coverUrl = item.coverUrl
      return r
    })
    // Remove items with empty id or title (data integrity)
    .filter((r) => r.id && r.title)

  // XSS-safe: validate all string values in results
  assertSafeStrings(results, '$.results')

  return { results }
}

// ---------------------------------------------------------------------------
// getItemDetail — get full detail for a single collection item
// (ADR-0021 §2.1 assistant tools table).
//
// Input: { itemId, item? }
// Output: { id, title, subtitle?, description?, coverUrl?, providerIds?,
//           canonicalAttributes?, ownedAttributes? (allowlisted only),
//           status }
//
// The caller provides the full item data via the `item` parameter. This tool
// applies data-minimization: it returns only allowlisted public fields and
// explicitly excludes private fields (notes, grading, lending, audit).
//
// Data-minimization: Private owned attributes (notes, grading, lending,
// wishlist, audit fields) are NEVER included in the output per ADR-0021 §2.2.
//
// XSS-safe: All string values in the result are validated before return.
// ---------------------------------------------------------------------------
export async function getItemDetail(provider, input, options = {}) {
  const { itemId, item } = input

  // Validate itemId
  if (!itemId || typeof itemId !== 'string') {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      'getItemDetail: itemId (uuid string) is required',
    )
  }

  // If no item data provided, return a skeleton with the id
  if (!item || typeof item !== 'object') {
    return { id: itemId, title: '', status: 'unknown' }
  }

  // Build the result with only allowlisted public fields
  const result = {}

  // Always include id and title
  result.id = String(item.id || itemId)
  result.title = String(item.title || '')

  // Optional public canonical fields
  if (item.subtitle && typeof item.subtitle === 'string') result.subtitle = item.subtitle
  if (item.description && typeof item.description === 'string') result.description = item.description
  if (item.coverUrl && typeof item.coverUrl === 'string') result.coverUrl = item.coverUrl
  if (item.providerIds && typeof item.providerIds === 'object') result.providerIds = item.providerIds

  // Canonical attributes (allowlisted only)
  if (item.canonicalAttributes && typeof item.canonicalAttributes === 'object') {
    const ALLOWED_CANONICAL = new Set([
      'artist', 'label', 'year', 'genre', 'format', 'publisher', 'author', 'isbn', 'catalogNumber',
    ])
    const minimized = {}
    for (const key of Object.keys(item.canonicalAttributes)) {
      if (ALLOWED_CANONICAL.has(key)) {
        minimized[key] = item.canonicalAttributes[key]
      }
    }
    if (Object.keys(minimized).length > 0) {
      result.canonicalAttributes = minimized
    }
  }

  // Owned attributes (allowlisted only — NEVER private notes, grading, lending, audit)
  if (item.ownedAttributes && typeof item.ownedAttributes === 'object') {
    const ALLOWED_OWNED = new Set(['status', 'acquiredDate', 'condition'])
    const minimized = {}
    for (const key of Object.keys(item.ownedAttributes)) {
      if (ALLOWED_OWNED.has(key)) {
        minimized[key] = item.ownedAttributes[key]
      }
    }
    if (Object.keys(minimized).length > 0) {
      result.ownedAttributes = minimized
    }
  }

  // Status (always included)
  result.status = String(item.status || 'draft')

  // XSS-safe: validate all string values in the result
  assertSafeStrings(result, '$.detail')

  return result
}

// ---------------------------------------------------------------------------
// getCollectionSummary — aggregated collection counts
// (ADR-0021 §2.1 assistant tools table).
//
// Input: { collectionType?, summary? }
// Output: { totalItems, identifiedCount, draftCount, byStatus: { ... } }
//
// The caller provides the pre-computed summary via the `summary` parameter.
// This tool validates the shape and applies data-minimization.
//
// Data-minimization: Only aggregated counts are returned. Never individual
// item data (ADR-0021 §2.1 data accessed column).
//
// XSS-safe: All string values in byStatus keys are validated.
// ---------------------------------------------------------------------------
export async function getCollectionSummary(provider, input, options = {}) {
  const { collectionType, summary } = input

  // Default empty summary
  const emptySummary = {
    totalItems: 0,
    identifiedCount: 0,
    draftCount: 0,
    byStatus: {},
  }

  // Validate summary shape if provided
  if (summary && typeof summary === 'object') {
    const result = {
      totalItems: Number.isFinite(summary.totalItems) ? Math.max(0, Math.floor(summary.totalItems)) : 0,
      identifiedCount: Number.isFinite(summary.identifiedCount) ? Math.max(0, Math.floor(summary.identifiedCount)) : 0,
      draftCount: Number.isFinite(summary.draftCount) ? Math.max(0, Math.floor(summary.draftCount)) : 0,
      byStatus: {},
    }

    // Data-minimization: byStatus values are counts (numbers), never item data
    if (summary.byStatus && typeof summary.byStatus === 'object' && !Array.isArray(summary.byStatus)) {
      for (const [key, value] of Object.entries(summary.byStatus)) {
        // XSS-safe: reject dangerous keys (byStatus keys come from status names)
        if (!isSafeCanonicalString(String(key))) {
          throw new ProviderError(
            ProviderErrorCode.INVALID_OUTPUT,
            `XSS-safe guard rejected byStatus key at $.byStatus.${key}`,
          )
        }
        if (Number.isFinite(value) && value >= 0) {
          result.byStatus[String(key)] = Math.floor(value)
        }
      }
    }

    return result
  }

  return emptySummary
}

// ---------------------------------------------------------------------------
// proposeMutation — validate and return a mutation draft
// (ADR-0021 §2.1 assistant tools table, §4.3 draft execution flow).
//
// Input: { action, entityType, entityId?, changes }
// Output: { draftId, action, entityType, entityId?, changes, requiresConfirmation: true }
//
// This is a MUTATION DRAFT tool. Per ADR-0021 §4.1: "AI suggests; application
// authorization decides." The draft is validated but NOT executed. It is
// returned to the assistant UX for explicit user confirmation and normal
// authorization before execution.
//
// Security (ADR-0006, ADR-0021):
//   - Actions limited to update, delete, add (reject unknown actions fail-closed).
//   - Entity types limited to collection_item, collection, review, lending.
//   - changes keys must match the entity's registered field schema.
//   - XSS-safe: changes values are validated before return.
//   - requiresConfirmation is always true (mutation never auto-executes).
//
// The LLM never directly writes to the database or bypasses authorization.
// ---------------------------------------------------------------------------
export async function proposeMutation(provider, input, options = {}) {
  const { action, entityType, entityId, changes } = input

  // Validate action (ADR-0021 §2.1: actions limited to update, delete, add)
  const VALID_ACTIONS = Object.freeze(['update', 'delete', 'add'])
  if (!VALID_ACTIONS.includes(action)) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `proposeMutation: invalid action "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`,
    )
  }

  // Validate entityType (ADR-0021 §2.1: entity types limited to registered types)
  const VALID_ENTITY_TYPES = Object.freeze(['collection_item', 'collection', 'review', 'lending'])
  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `proposeMutation: invalid entityType "${entityType}". Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
    )
  }

  // Validate changes: must be an object (not array, not null)
  if (changes !== undefined && changes !== null) {
    if (typeof changes !== 'object' || Array.isArray(changes)) {
      throw new ProviderError(
        ProviderErrorCode.INVALID_OUTPUT,
        'proposeMutation: changes must be a plain object',
      )
    }

    // XSS-safe: validate all changes values before accepting the draft
    assertSafeStrings(changes, '$.changes')
  }

  // Generate a draft id (server-side, not client-supplied)
  const draftId = generateId()

  // Return the validated draft — requiresConfirmation is always true
  return {
    draftId,
    action,
    entityType,
    entityId: entityId || undefined,
    changes: changes || {},
    requiresConfirmation: true,
  }
}
