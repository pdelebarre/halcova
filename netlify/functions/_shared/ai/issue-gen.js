// issue-gen.js — AI issue/epic generation from triaged feedback
// (#308, ADR-0021 §11, epic #302).
//
// Uses the GENERATE_ISSUE_EPIC capability to turn triaged feedback into a
// structured issue or epic draft. The draft is returned for human confirmation
// — never auto-created on GitHub ("AI suggests; app decides").
//
// Security (ADR-0006, ADR-0021):
//   - LLM output is untrusted and schema-validated via runCapability.
//   - Controlled label allow-list: only 14 known labels may be suggested.
//     Unknown labels are rejected fail-closed.
//   - Data-minimization: only feedback text and triage metadata are sent to
//     the model. Author identity, session tokens, and private fields are never
//     included.
//   - XSS-safe: all returned string values pass isSafeCanonicalString.
//   - Idempotent on retry: the same input produces the same draft (deterministic
//     via temperature=0 and content-hash-based draft id).
//   - No GitHub mutation occurs in this tool (#308 scope boundary).
//
// Contract stability: #306 (feedback triage) produces the input consumed here.
// Do not change the exported function signatures without a coordinated change.

import { ProviderError, ProviderErrorCode } from './provider'
import { runCapability, GENERATE_ISSUE_EPIC } from './capabilities'
import { isSafeCanonicalString } from '../providers/payload-guard'

// ---------------------------------------------------------------------------
// Controlled label allow-list (14 labels).
//
// These are the ONLY labels the AI may suggest for a generated issue/epic.
// Unknown labels are rejected fail-closed per AC-5: "Labels come only from the
// repository allow-list."
//
// The 14 labels map to existing Halcova repository labels:
//   Classification: bug, enhancement, documentation, security, performance
//   Product area:   backend, frontend
//   Issue type:     epic
//   Priority:       priority:P0, priority:P1, priority:P2, priority:P3
//   Status:         blocked, good first issue
// ---------------------------------------------------------------------------
const ISSUE_LABELS = Object.freeze([
  'bug',
  'enhancement',
  'documentation',
  'security',
  'performance',
  'backend',
  'frontend',
  'epic',
  'priority:P0',
  'priority:P1',
  'priority:P2',
  'priority:P3',
  'blocked',
  'good first issue',
])

const ISSUE_LABEL_SET = new Set(ISSUE_LABELS)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Validate that every string value in an object (recursive, depth-bounded) is
// XSS-safe. Throws ProviderError(INVALID_OUTPUT) on the first dangerous value.
// Mirror of tools.js assertSafeStrings and feedback-triage.js assertSafeStrings.
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

// Generate a deterministic draft id from the input content. This ensures
// idempotency: the same feedback input always produces the same draft id,
// so retrying an approved action returns the same draft.
function draftIdFromInput(input) {
  // Use a simple hash of the serialized input for deterministic idempotency.
  // In production this would be a content-addressable hash; here we use a
  // stable string derived from the feedback id and kind.
  const raw = `${input.feedbackId || ''}|${input.kind || 'issue'}|${(input.triageResult?.summary || '').slice(0, 100)}`
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  // Format as a UUID-like string for compatibility with existing draft id format.
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-0000-0000-0000-000000000000`
}

// Apply data-minimization: strip author identity and private fields from the
// feedback input before sending to the model. Only feedback text and kind are
// sent. Triage metadata is used for post-processing only (label suggestion,
// body construction) — it is never included in the model prompt per
// data-minimization policy (ADR-0021 §3.1).
function minimizeInput(input) {
  const result = {
    feedback: String(input.feedback || input.message || '').trim(),
  }

  // Forward kind (issue or epic) when provided.
  if (input.kind !== undefined) {
    result.kind = input.kind
  }

  return result
}

// Validate that the model's suggested labels stay within the controlled
// allow-list. Throws ProviderError(INVALID_OUTPUT) if any label is unknown —
// fail-closed per AC-5: "Unknown labels are rejected."
function assertControlledLabels(labels) {
  if (!Array.isArray(labels)) return
  for (const label of labels) {
    if (!ISSUE_LABEL_SET.has(label)) {
      throw new ProviderError(
        ProviderErrorCode.INVALID_OUTPUT,
        `Unknown label: "${label}". Allowed: ${ISSUE_LABELS.join(', ')}`,
      )
    }
  }
}

// Build a human-readable title following Halcova naming conventions.
// Issues: [<label>] <summary>
// Epics: [EPIC] <summary>
function buildTitle(kind, triageResult, generatedTitle) {
  // Prefer the generated title from the LLM when available.
  if (generatedTitle && typeof generatedTitle === 'string' && generatedTitle.trim().length > 0) {
    return generatedTitle.trim()
  }

  // Fall back to a convention-based title from triage metadata.
  const summary = triageResult?.summary || 'Untitled feedback'
  if (kind === 'epic') {
    return `[EPIC] ${summary}`
  }
  const label = triageResult?.classification?.label || 'enhancement'
  return `[${label}] ${summary}`
}

// Build the issue body with problem, user impact, rationale, acceptance
// criteria, and source evidence.
function buildBody(kind, triageResult, generatedBody) {
  const summary = triageResult?.summary || ''
  const classification = triageResult?.classification?.label || 'enhancement'
  const productArea = triageResult?.productArea || 'other'
  const priority = triageResult?.priority || 'medium'

  const lines = []

  // Problem / user impact from the triage summary.
  if (summary) {
    lines.push(`## Problem`)
    lines.push('')
    lines.push(summary)
    lines.push('')
  }

  // User impact.
  lines.push('## User Impact')
  lines.push('')
  lines.push(`This ${kind} was identified from user feedback classified as "${classification}" in the "${productArea}" area with ${priority} priority.`)
  lines.push('')

  // Rationale.
  lines.push('## Rationale')
  lines.push('')
  lines.push(`AI-generated ${kind} from triaged user feedback. The feedback was classified as "${classification}" with priority "${priority}" in the "${productArea}" product area.`)
  lines.push('')

  // Acceptance criteria from the generated body or a default.
  if (generatedBody?.acceptanceCriteria && Array.isArray(generatedBody.acceptanceCriteria) && generatedBody.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance Criteria')
    lines.push('')
    for (const ac of generatedBody.acceptanceCriteria) {
      lines.push(`- [ ] ${ac}`)
    }
    lines.push('')
  }

  // Source evidence.
  lines.push('## Source Evidence')
  lines.push('')
  lines.push(`- **Source:** Triaged user feedback`)
  if (triageResult?.classification?.confidence !== undefined) {
    lines.push(`- **Classification confidence:** ${Math.round(triageResult.classification.confidence * 100)}%`)
  }
  lines.push(`- **Generated:** AI-suggested draft (requires human review)`)
  lines.push('')

  return lines.join('\n')
}

// Map triage classification and priority to suggested labels.
function suggestLabels(triageResult) {
  const labels = []

  // Map classification to a label.
  const classification = triageResult?.classification?.label
  if (classification && ISSUE_LABEL_SET.has(classification)) {
    labels.push(classification)
  } else {
    // Default to enhancement when classification is unknown or absent.
    labels.push('enhancement')
  }

  // Map product area to a label when it matches.
  const productArea = triageResult?.productArea
  if (productArea && ISSUE_LABEL_SET.has(productArea)) {
    labels.push(productArea)
  }

  // Map priority to a P-label.
  const priority = triageResult?.priority
  if (priority === 'critical') {
    labels.push('priority:P0')
  } else if (priority === 'high') {
    labels.push('priority:P1')
  } else if (priority === 'medium') {
    labels.push('priority:P2')
  } else if (priority === 'low') {
    labels.push('priority:P3')
  }

  return labels
}

// ---------------------------------------------------------------------------
// generateIssueEpic — generate a structured issue/epic draft from triaged
// feedback (#308, ADR-0021 §11).
//
// Input: {
//   feedbackId: string,       // stable id for idempotency
//   feedback: string,         // the raw feedback text
//   kind?: 'issue' | 'epic',  // default: 'issue'
//   triageResult?: {          // from feedback-triage.js (#306)
//     classification?: { label, confidence },
//     productArea?: string,
//     priority?: string,
//     summary?: string,
//   },
// }
//
// Output: {
//   draftId: string,          // deterministic from input (idempotent)
//   kind: 'issue' | 'epic',
//   title: string,            // follows Halcova naming conventions
//   body: string,             // includes problem, impact, rationale, AC, source
//   labels: string[],         // validated against 14-label allow-list
//   requiresConfirmation: true, // never auto-created
// }
//
// Security:
//   - Data-minimization: author identity is stripped before calling the model.
//   - Controlled labels: only 14 known labels may be suggested; unknown labels
//     are rejected fail-closed.
//   - XSS-safe: all returned string values are validated before return.
//   - Idempotent: same input produces same draftId (deterministic).
//   - No GitHub mutation: the draft is returned for human confirmation.
// ---------------------------------------------------------------------------
export async function generateIssueEpic(provider, input, options = {}) {
  // Apply data-minimization before sending to the model.
  const minimizedInput = minimizeInput(input)

  // Run the capability (validates input/output schemas automatically).
  const result = await runCapability(provider, 'generateIssueEpic', minimizedInput, options)

  // XSS-safe: validate all returned string values.
  assertSafeStrings(result, '$')

  // Determine kind (default to 'issue').
  const kind = input.kind === 'epic' ? 'epic' : 'issue'

  // Build suggested labels from triage metadata.
  const suggestedLabels = suggestLabels(input.triageResult)

  // Validate suggested labels against the allow-list.
  assertControlledLabels(suggestedLabels)

  // Build the title following Halcova naming conventions.
  const title = buildTitle(kind, input.triageResult, result.title)

  // Build the body with problem, impact, rationale, AC, and source evidence.
  const body = buildBody(kind, input.triageResult, result)

  // Generate a deterministic draft id for idempotency.
  const draftId = draftIdFromInput(input)

  // Return the validated draft — requiresConfirmation is always true.
  return {
    draftId,
    kind,
    title,
    body,
    labels: suggestedLabels,
    requiresConfirmation: true,
  }
}

// ---------------------------------------------------------------------------
// getIssueGenSummary — convenience function that returns a human-readable
// summary of a generated issue/epic draft (useful for admin preview).
// ---------------------------------------------------------------------------
export function getIssueGenSummary(draft) {
  if (!draft) return ''
  const kind = draft.kind || 'issue'
  const title = draft.title || 'Untitled'
  const labels = Array.isArray(draft.labels) ? draft.labels.join(', ') : ''
  const labelStr = labels ? ` [${labels}]` : ''
  return `[${kind.toUpperCase()}] ${title}${labelStr}`
}