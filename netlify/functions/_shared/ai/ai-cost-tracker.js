// ai-cost-tracker.js — AI provider usage & cost telemetry (ADMIN-3.8, #310,
// epic #302). Records every provider call's token usage, latency and outcome
// WITHOUT storing the raw prompt or response (AC: "Raw prompts/responses are
// not stored as usage telemetry by default").
//
// Each record is a lightweight event:
//   { provider, model, tokensIn, tokensOut, latencyMs, ok, errorCode?, costEstimate? }
//
// Storage mirrors the rest of the app: Postgres when DATABASE_URL is configured
// (authoritative), Blobs otherwise — both expose the same ops.
//
// Cost estimation uses a simple per-model token-price map. Unknown models are
// estimated at a conservative default rate so the owner never sees $0 for a
// real call. Prices are in USD per 1K tokens (input/output).
//
// Security: no prompt text, no response text, no user identifiers are stored.
// The event carries only the provider name and model — never the apiKey or
// endpoint URL.

import { getStore } from '@netlify/blobs'
import { isPostgresConfigured, db } from '../postgres'
import { safeLog } from '../audit'

const COST_STORE = 'runout-ai-cost'

// Default per-model token pricing (USD per 1K tokens). These are conservative
// estimates; the owner can override via env. Unknown models use the default.
// Prices are input/output pairs.
const DEFAULT_MODEL_PRICES = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
}

// Default fallback price for unknown models (conservative — mid-range).
const DEFAULT_INPUT_PRICE = 0.001
const DEFAULT_OUTPUT_PRICE = 0.004

// How many days of events to keep (rolling window). Older events are pruned
// during write to keep storage bounded.
const RETENTION_DAYS = 31

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

// Parse model prices from the environment (JSON map of model -> {input, output}).
// Falls back to DEFAULT_MODEL_PRICES when the env var is absent or invalid.
export function modelPricesFromEnv(env = process.env) {
  try {
    const raw = env.RUNOUT_AI_MODEL_PRICES
    if (!raw) return { ...DEFAULT_MODEL_PRICES }
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_MODEL_PRICES }
    const result = { ...DEFAULT_MODEL_PRICES }
    for (const [model, prices] of Object.entries(parsed)) {
      if (prices && typeof prices.input === 'number' && typeof prices.output === 'number') {
        result[model] = { input: prices.input, output: prices.output }
      }
    }
    return result
  } catch {
    return { ...DEFAULT_MODEL_PRICES }
  }
}

// Estimate the cost of a single call in USD. Returns null when token counts
// are unavailable (the provider did not report them).
export function estimateCost({ model, tokensIn, tokensOut, prices = modelPricesFromEnv() }) {
  if (tokensIn == null || tokensOut == null) return null
  const modelPrices = prices[model] || { input: DEFAULT_INPUT_PRICE, output: DEFAULT_OUTPUT_PRICE }
  const inputCost = (tokensIn / 1000) * modelPrices.input
  const outputCost = (tokensOut / 1000) * modelPrices.output
  return Number((inputCost + outputCost).toFixed(6))
}

// ---------------------------------------------------------------------------
// Event record
// ---------------------------------------------------------------------------

// Create a usage event from a provider call result. Never stores the prompt or
// response — only metadata and token counts.
export function createUsageEvent({ provider, model, tokensIn, tokensOut, latencyMs, ok, errorCode }) {
  const costEstimate = estimateCost({ model, tokensIn, tokensOut })
  return {
    provider,
    model,
    tokensIn: tokensIn ?? null,
    tokensOut: tokensOut ?? null,
    latencyMs: latencyMs ?? null,
    ok: !!ok,
    errorCode: errorCode || null,
    costEstimate,
    timestamp: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Storage backend
// ---------------------------------------------------------------------------

// Blobs-based cost store. Events are stored as individual blobs keyed by
// timestamp + uuid for easy time-range queries. An index blob holds the list
// of event keys for the current window.
function createCostBlobStore(store) {
  async function recordEvent(event) {
    const key = `evt:${event.timestamp}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`
    await store.setJSON(key, event)
    // Append to the rolling index.
    const index = (await store.get('index:events', { type: 'json' })) || []
    index.push(key)
    // Prune events older than RETENTION_DAYS.
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
    const kept = []
    for (const k of index) {
      const parts = k.split(':')
      if (parts.length >= 2 && parts[1] >= cutoff) {
        kept.push(k)
      } else {
        // Remove the stale blob (best-effort).
        store.delete(k).catch(() => {})
      }
    }
    await store.setJSON('index:events', kept)
  }

  // Query events within a time window. Returns array of events sorted oldest
  // first. `since` is an ISO string or a number of days ago.
  async function queryEvents({ since, until = new Date().toISOString() } = {}) {
    const sinceIso = typeof since === 'number'
      ? new Date(Date.now() - since * 86400000).toISOString()
      : (since || new Date(Date.now() - 7 * 86400000).toISOString())
    const index = (await store.get('index:events', { type: 'json' })) || []
    const keys = index.filter((k) => {
      const parts = k.split(':')
      return parts.length >= 2 && parts[1] >= sinceIso && parts[1] <= until
    })
    const events = await Promise.all(
      keys.map((k) => store.get(k, { type: 'json' }).catch(() => null)),
    )
    return events.filter(Boolean).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
  }

  // Aggregate events into summary stats.
  async function aggregateEvents({ since } = {}) {
    const events = await queryEvents({ since })
    const total = events.length
    let ok = 0
    let fail = 0
    let totalLatencyMs = 0
    let totalTokensIn = 0
    let totalTokensOut = 0
    let totalCost = 0
    const byProvider = {}
    const byModel = {}

    for (const evt of events) {
      if (evt.ok) ok += 1
      else fail += 1
      if (evt.latencyMs != null) totalLatencyMs += evt.latencyMs
      if (evt.tokensIn != null) totalTokensIn += evt.tokensIn
      if (evt.tokensOut != null) totalTokensOut += evt.tokensOut
      if (evt.costEstimate != null) totalCost += evt.costEstimate

      const prov = evt.provider || 'unknown'
      if (!byProvider[prov]) byProvider[prov] = { calls: 0, ok: 0, fail: 0, latencyMs: 0, cost: 0 }
      byProvider[prov].calls += 1
      if (evt.ok) byProvider[prov].ok += 1
      else byProvider[prov].fail += 1
      if (evt.latencyMs != null) byProvider[prov].latencyMs += evt.latencyMs
      if (evt.costEstimate != null) byProvider[prov].cost += evt.costEstimate

      const mdl = evt.model || 'unknown'
      if (!byModel[mdl]) byModel[mdl] = { calls: 0, ok: 0, fail: 0, latencyMs: 0, cost: 0 }
      byModel[mdl].calls += 1
      if (evt.ok) byModel[mdl].ok += 1
      else byModel[mdl].fail += 1
      if (evt.latencyMs != null) byModel[mdl].latencyMs += evt.latencyMs
      if (evt.costEstimate != null) byModel[mdl].cost += evt.costEstimate
    }

    return {
      period: { since: sinceIso(since), until: new Date().toISOString() },
      total,
      ok,
      fail,
      avgLatencyMs: total > 0 ? Math.round(totalLatencyMs / total) : 0,
      totalTokensIn,
      totalTokensOut,
      totalCost: Number(totalCost.toFixed(6)),
      byProvider,
      byModel,
    }
  }

  return { recordEvent, queryEvents, aggregateEvents }
}

function sinceIso(since) {
  if (typeof since === 'number') return new Date(Date.now() - since * 86400000).toISOString()
  return since || new Date(Date.now() - 7 * 86400000).toISOString()
}

// Postgres-based cost store.
function createCostRepo(db) {
  async function recordEvent(event) {
    await db.query(
      `INSERT INTO ai_cost_events
         (provider, model, tokens_in, tokens_out, latency_ms, ok, error_code, cost_estimate, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.provider,
        event.model,
        event.tokensIn,
        event.tokensOut,
        event.latencyMs,
        event.ok,
        event.errorCode,
        event.costEstimate,
        event.timestamp,
      ],
    )
  }

  async function queryEvents({ since, until = new Date().toISOString() } = {}) {
    const sinceIso = typeof since === 'number'
      ? new Date(Date.now() - since * 86400000).toISOString()
      : (since || new Date(Date.now() - 7 * 86400000).toISOString())
    const { rows } = await db.query(
      `SELECT provider, model, tokens_in, tokens_out, latency_ms, ok, error_code, cost_estimate, timestamp
       FROM ai_cost_events
       WHERE timestamp >= $1 AND timestamp <= $2
       ORDER BY timestamp ASC`,
      [sinceIso, until],
    )
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      latencyMs: r.latency_ms,
      ok: !!r.ok,
      errorCode: r.error_code,
      costEstimate: r.cost_estimate,
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    }))
  }

  async function aggregateEvents({ since } = {}) {
    const sinceIso = typeof since === 'number'
      ? new Date(Date.now() - since * 86400000).toISOString()
      : (since || new Date(Date.now() - 7 * 86400000).toISOString())
    const { rows } = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE ok)::int AS ok,
         COUNT(*) FILTER (WHERE NOT ok)::int AS fail,
         ROUND(AVG(latency_ms))::int AS avg_latency_ms,
         COALESCE(SUM(tokens_in), 0)::bigint AS total_tokens_in,
         COALESCE(SUM(tokens_out), 0)::bigint AS total_tokens_out,
         COALESCE(SUM(cost_estimate), 0)::float AS total_cost
       FROM ai_cost_events
       WHERE timestamp >= $1 AND timestamp <= $2`,
      [sinceIso, new Date().toISOString()],
    )
    const row = rows[0] || {}
    return {
      period: { since: sinceIso, until: new Date().toISOString() },
      total: row.total || 0,
      ok: row.ok || 0,
      fail: row.fail || 0,
      avgLatencyMs: row.avg_latency_ms || 0,
      totalTokensIn: Number(row.total_tokens_in) || 0,
      totalTokensOut: Number(row.total_tokens_out) || 0,
      totalCost: Number((row.total_cost || 0).toFixed(6)),
      byProvider: {},
      byModel: {},
    }
  }

  return { recordEvent, queryEvents, aggregateEvents }
}

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

function backend() {
  if (isPostgresConfigured()) return createCostRepo(db)
  return createCostBlobStore({ store: getStore(COST_STORE) })
}

// Record a usage event. `event` is a plain object with provider, model,
// tokensIn, tokensOut, latencyMs, ok, errorCode. Returns nothing — failures
// are logged but never thrown (telemetry must never block the caller).
export async function recordUsageEvent(event) {
  try {
    const evt = createUsageEvent(event)
    const store = backend()
    await store.recordEvent(evt)
  } catch (err) {
    safeLog('error', 'ai-cost: failed to record usage event', { detail: err?.message || err })
  }
}

// Query events for a time window. `days` is the number of days to look back
// (default 7). Returns an array of events.
export async function queryUsageEvents({ days = 7 } = {}) {
  const store = backend()
  return store.queryEvents({ since: days })
}

// Get aggregate stats for a time window. `days` is the number of days to look
// back (default 7). Returns { period, total, ok, fail, avgLatencyMs,
// totalTokensIn, totalTokensOut, totalCost, byProvider, byModel }.
export async function getUsageAggregates({ days = 7 } = {}) {
  const store = backend()
  return store.aggregateEvents({ since: days })
}