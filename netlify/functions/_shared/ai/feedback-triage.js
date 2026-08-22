// feedback-triage.js — AI feedback triage: classification + priority + duplicate
// recommendation (#306, ADR-0021 §11, epic #302).
//
// Uses the FEEDBACK_TRIAGE capability to classify incoming feedback, assign
// product area and priority, and recommend duplicate candidates from existing
// feedback entries.
//
// Security (ADR-0006, ADR-0021):
//   - LLM output is untrusted and schema-validated via runCapability.
//   - Data-minimization: only feedback text and metadata are sent to model.
//     Author identity, session tokens, and private fields are never included.
//   - Controlled-value rejection: classification labels, product areas, and
//     priorities are allow-listed; unknown values are rejected fail-closed.
//   - Prompt-injection content: feedback text is treated as untrusted data.
//   - Low-confidence results remain recommendations requiring review.
//   - No GitHub mutation occurs in this tool (#306 scope boundary).

import { ProviderError, ProviderErrorCode } from './provider'
import { runCapability, FEEDBACK_TRIAGE } from './capabilities'
import { isSafeCanonicalString } from '../providers/payload-guard'

// ---------------------------------------------------------------------------
// Controlled-value allow-lists (repository allow-lists per AC-3/AC-4).
// ---------------------------------------------------------------------------

// Classification labels the model may output. Unknown values are rejected.
const CLASSIFICATION_LABELS = new Set([
  'bug', 'enhancement', 'documentation', 'security', 'performance',
])

// Product areas from the repository allow-list. Unknown values are rejected.
const PRODUCT_AREAS = new Set([
  'scanner', 'auth', 'billing', 'collection', 'search', 'catalog', 'sync',
  'ui', 'api', 'other',
])

// Priority levels. Unknown values are rejected.
const PRIORITY_LEVELS = new Set(['critical', 'high', 'medium', 'low'])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Validate that every string value in an object (recursive, depth-bounded) is
// XSS-safe. Throws ProviderError(INVALID_OUTPUT) on the first dangerous value.
// Mirror of tools.js assertSafeStrings.
function assertSafeStrings(value, path = '$', depth = 0) {
  if (depth > 8) return
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

// Apply data-minimization: strip author identity and private fields from the
// feedback input before sending to the model. Only message, type, category,
// url, appVersion, and existingFeedback (with minimal fields) are passed.
function minimizeInput(input) {
  const result = {
    message: String(input.message || '').trim(),
  }

  // Forward optional feedback metadata (never author identity).
  if (input.type !== undefined) result.type = input.type
  if (input.category !== undefined) result.category = input.category
  if (input.url) result.url = String(input.url).slice(0, 2000)
  if (input.appVersion) result.appVersion = String(input.appVersion).slice(0, 100)

  // Minimize existingFeedback entries: only id, message, type, category.
  if (Array.isArray(input.existingFeedback) && input.existingFeedback.length > 0) {
    result.existingFeedback = input.existingFeedback
      .slice(0, 20)
      .map((f) => {
        const entry = { id: String(f.id || ''), message: String(f.message || '').slice(0, 4000) }
        if (f.type) entry.type = String(f.type).slice(0, 50)
        if (f.category) entry.category = String(f.category).slice(0, 50)
        return entry
      })
  }

  return result
}

// Validate that the model's output stays within controlled-value allow-lists.
// Throws ProviderError(INVALID_OUTPUT) if any controlled value is unknown —
// fail-closed per AC-5: "Unknown labels/areas/priorities are rejected."
function assertControlledValues(output) {
  if (output.classification) {
    if (!CLASSIFICATION_LABELS.has(output.classification.label)) {
      throw new ProviderError(
        ProviderErrorCode.INVALID_OUTPUT,
        `Unknown classification label: "${output.classification.label}". Allowed: ${[...CLASSIFICATION_LABELS].join(', ')}`,
      )
    }
  }
  if (output.productArea && !PRODUCT_AREAS.has(output.productArea)) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `Unknown product area: "${output.productArea}". Allowed: ${[...PRODUCT_AREAS].join(', ')}`,
    )
  }
  if (output.priority && !PRIORITY_LEVELS.has(output.priority)) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `Unknown priority: "${output.priority}". Allowed: ${[...PRIORITY_LEVELS].join(', ')}`,
    )
  }
}

// Detect low-confidence results. Per AC-7: "Low-confidence results remain
// recommendations requiring review." When classification confidence < 0.5
// OR priorityConfidence < 0.5, the result is flagged.
function isLowConfidence(output) {
  const classConf = output.classification?.confidence ?? 0
  const priConf = output.priorityConfidence ?? 0
  return classConf < 0.5 || priConf < 0.5
}

// ---------------------------------------------------------------------------
// triageFeedback — classify, assign priority, and recommend duplicates
// (the main exported function).
//
// Input: { message (required), type?, category?, url?, appVersion?,
//          existingFeedback?: [{ id, message, type?, category? }] }
// Output: { classification: { label, confidence }, productArea, priority,
//           priorityConfidence, summary, duplicateCandidates?,
//           isLowConfidence }
//
// Security:
//   - Data-minimization: author identity is stripped before calling the model.
//   - Controlled values: classification labels, product areas, and priorities
//     are enforced against allow-lists; unknown values are rejected fail-closed.
//   - XSS-safe: all returned string values are validated before return.
//   - Prompt-injection: feedback text is treated as untrusted input; output
//     schema validation rejects malformed/injection attempts.
//   - Low-confidence: results below confidence threshold are flagged.
// ---------------------------------------------------------------------------
export async function triageFeedback(provider, input, options = {}) {
  // Apply data-minimization before sending to the model.
  const minimizedInput = minimizeInput(input)

  // Run the capability (validates input/output schemas automatically).
  const result = await runCapability(provider, 'feedbackTriage', minimizedInput, options)

  // Controlled-value enforcement: reject unknown labels/areas/priorities
  // fail-closed. This runs AFTER schema validation as an additional guard.
  assertControlledValues(result)

  // XSS-safe: validate all returned string values.
  assertSafeStrings(result, '$')

  // Add isLowConfidence flag for the caller.
  const lowConfidence = isLowConfidence(result)

  return {
    ...result,
    isLowConfidence: lowConfidence,
  }
}

// ---------------------------------------------------------------------------
// getTriageSummary — convenience function that returns a human-readable
// summary of a triage result (useful for inbox display).
// ---------------------------------------------------------------------------
export function getTriageSummary(triageResult) {
  if (!triageResult) return ''
  const label = triageResult.classification?.label || 'unknown'
  const area = triageResult.productArea || 'other'
  const priority = triageResult.priority || 'medium'
  const confidence = triageResult.classification?.confidence ?? 0
  const pct = Math.round(confidence * 100)
  const dupCount = triageResult.duplicateCandidates?.length || 0
  const warning = triageResult.isLowConfidence ? ' [LOW CONFIDENCE — review required]' : ''
  const dups = dupCount > 0 ? ` | ${dupCount} duplicate candidate(s)` : ''
  return `[${label}] ${area} | priority: ${priority} (${pct}% confidence)${dups}${warning}`
}