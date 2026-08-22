// ai-dryrun.js — AI provider dry-run/test capability (ADMIN-3.8, #310, epic
// #302). Lets the owner evaluate 1/10/50 existing feedback records through a
// provider WITHOUT mutating GitHub or production state.
//
// The dry-run reads feedback records (read-only), runs them through the
// configured AI provider, and returns the results with latency, usage and
// estimated cost. No feedback status is changed, no GitHub issues are created,
// no production state is touched.
//
// Security:
//   - Dry-run is READ-ONLY: it never writes to any store, never creates GitHub
//     issues, never changes feedback status.
//   - The caller must be admin (requireAdmin gate in admin.js).
//   - Raw feedback messages are returned in the dry-run results (the owner
//     needs to see what was evaluated), but prompts/responses are NOT stored
//     in the cost telemetry (see ai-cost-tracker.js).

import { getStore } from '@netlify/blobs'
import { isPostgresConfigured, db } from '../postgres'
import { createFeedbackRepo } from '../repositories/feedback-repo'
import { createFeedbackBlobStore } from '../feedback-blob'
import { createAiConfigRepo } from './ai-config-repo'
import { createAiConfigBlobStore } from './ai-config-blob'
import { buildProvider, getProfileSecret } from './ai-admin'
import { estimateCost } from './ai-cost-tracker'
import { safeLog } from '../audit'

const AI_CONFIG_STORE = 'runout-ai-config'
const MAX_DRY_RUN_ITEMS = 50

// ---------------------------------------------------------------------------
// Feedback reader (read-only, never mutates)
// ---------------------------------------------------------------------------

async function readFeedbackItems({ limit = 10, offset = 0 } = {}) {
  const clamped = Math.min(Math.max(1, limit), MAX_DRY_RUN_ITEMS)
  if (isPostgresConfigured()) {
    const repo = createFeedbackRepo(db)
    return repo.listAll({ limit: clamped, offset })
  }
  const store = createFeedbackBlobStore()
  const all = await store.listAll({ limit: clamped, offset })
  return all.slice(offset, offset + clamped)
}

// ---------------------------------------------------------------------------
// Dry-run schema — the minimal output schema for dry-run evaluation.
// ---------------------------------------------------------------------------

const DRY_RUN_SCHEMA = {
  type: 'object',
  properties: {
    classification: {
      type: 'string',
      enum: ['bug', 'enhancement', 'question', 'other'],
    },
    summary: { type: 'string', maxLength: 200 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['classification', 'summary', 'confidence'],
}

// ---------------------------------------------------------------------------
// Dry-run execution
// ---------------------------------------------------------------------------

// Run a dry-run evaluation of feedback items through the active provider.
// Returns { results, summary } where results is an array of per-item outcomes
// and summary is aggregate stats.
//
// `options`:
//   - limit: number of items to evaluate (1-50, default 10)
//   - offset: pagination offset (default 0)
//   - providerFactory: injectable for tests (defaults to buildProvider)
//
// Never mutates feedback state, never creates GitHub issues.
export async function dryRunFeedback({ limit = 10, offset = 0, providerFactory = buildProvider } = {}) {
  // 1. Get the active provider profile.
  const activeProfile = await getActiveProfile()
  if (!activeProfile) {
    return { error: { code: 'NO_ACTIVE_PROVIDER', message: 'No active AI provider is configured.' } }
  }

  // 2. Decrypt the secret.
  const secret = await getProfileSecret(activeProfile.id)
  if (!secret) {
    return { error: { code: 'NO_SECRET', message: 'The active provider has no secret configured.' } }
  }

  // 3. Build the provider instance.
  const provider = providerFactory(activeProfile, secret)
  if (!provider) {
    return { error: { code: 'UNSUPPORTED_PROVIDER', message: 'The active provider type is not supported.' } }
  }

  // 4. Read feedback items (read-only).
  const items = await readFeedbackItems({ limit, offset })
  if (items.length === 0) {
    return { error: { code: 'NO_FEEDBACK', message: 'No feedback items found for the given range.' } }
  }

  // 5. Run each item through the provider.
  const results = []
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalLatencyMs = 0
  let okCount = 0
  let failCount = 0

  for (const item of items) {
    const started = Date.now()
    try {
      const system = 'You are a feedback triage assistant. Classify the following feedback as bug, enhancement, question, or other. Provide a brief summary and a confidence score (0-1). Respond with valid JSON only.'
      const user = `Feedback message: "${item.message || '(empty)'}"\nType: ${item.type || 'suggestion'}\nCategory: ${item.category || 'other'}`

      const result = await provider.complete({
        system,
        user,
        schema: DRY_RUN_SCHEMA,
      })

      const latencyMs = Date.now() - started
      const tokensIn = result.usage?.prompt_tokens ?? null
      const tokensOut = result.usage?.completion_tokens ?? null
      const costEstimate = estimateCost({ model: provider.model, tokensIn, tokensOut })

      if (tokensIn != null) totalTokensIn += tokensIn
      if (tokensOut != null) totalTokensOut += tokensOut
      totalLatencyMs += latencyMs
      okCount += 1

      results.push({
        feedbackId: item.id,
        ok: true,
        latencyMs,
        tokensIn,
        tokensOut,
        costEstimate,
        classification: result.content.classification,
        summary: result.content.summary,
        confidence: result.content.confidence,
      })
    } catch (err) {
      const latencyMs = Date.now() - started
      totalLatencyMs += latencyMs
      failCount += 1

      results.push({
        feedbackId: item.id,
        ok: false,
        latencyMs,
        errorCode: err?.code || 'PROVIDER_FAILURE',
        errorMessage: err?.message || 'Dry-run evaluation failed.',
      })
    }
  }

  return {
    results,
    summary: {
      total: results.length,
      ok: okCount,
      fail: failCount,
      avgLatencyMs: results.length > 0 ? Math.round(totalLatencyMs / results.length) : 0,
      totalTokensIn,
      totalTokensOut,
      totalCost: results.reduce((sum, r) => sum + (r.costEstimate || 0), 0),
      provider: provider.name,
      model: provider.model,
    },
  }
}

// Get the active provider profile (the one with active=true).
async function getActiveProfile() {
  const repo = backend()
  const profiles = await repo.listProfiles()
  return profiles.find((p) => p.active) || null
}

function backend() {
  if (isPostgresConfigured()) {
    return createAiConfigRepo(db)
  }
  return createAiConfigBlobStore({ store: getStore(AI_CONFIG_STORE) })
}