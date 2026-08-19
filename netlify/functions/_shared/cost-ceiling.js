// SEC-7.4 (#341) — AI cost-ceiling scaffolding (M1 security-foundation epic
// #337). This is the GENERIC ceiling primitive ONLY — deliberately NO AI
// provider integration, prompt handling, model routing, or per-response cost
// metering (those are deferred and #337-gated). It enforces per-identity
// daily/monthly counters and token/USD sums over fixed windows, with a hard
// deterministic stop when a ceiling is crossed.
//
// Design mirrors _shared/rate-limit.js (the fixed-window counter, window index
// in the VALUE so one key per identity per scope, auto-rollover on stale
// windows, best-effort degrade-open).
//
// A ceiling is a fixed-window counter carrying BOTH a `count` and accumulated
// resources:
//
//   { w, count, tokens, usd }
//
// Two window lengths are used: day and month. The day window is
// DAY_WINDOW_MS wide and the month window is MONTH_WINDOW_MS; a boundary in a
// prior window rolls the whole entry back to zero (self-healing, no cleanup).
//
// Deterministic hard-stop responses:
//   - per-request token ceiling (413)            → { error, code:'AI_TOKENS_EXCEEDED' }
//   - per-request USD ceiling (429)              → { error, code:'AI_COST_LIMIT' }
//   - daily/monthly/global cap hit (429)         → { error, code:'AI_COST_LIMIT' } + Retry-After
//
// Every ceiling hit is audited via logAudit('ai.cost_limit', { ceiling,
// userId/emailHash, … }) — NEVER prompts, tokens past their expiry (>48h), or PII.
//
// No AI feature wires this in yet — it is a tested primitive + thresholds that
// the future AI integration calls before spending.

import { windowIndex } from './rate-limit'
import { logAudit } from './audit'

// Fixed window lengths.
export const DAY_WINDOW_MS = 24 * 60 * 60 * 1000
export const MONTH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

// Env-tunable thresholds (documented defaults — see docs/operational-thresholds.md).
export const AI_PER_REQUEST_TOKENS = Number(process.env.RUNOUT_AI_PER_REQUEST_TOKENS) || 8000
export const AI_PER_REQUEST_USD = Number(process.env.RUNOUT_AI_PER_REQUEST_USD) || 0.05
export const AI_DAILY_USER_REQUESTS = Number(process.env.RUNOUT_AI_DAILY_USER_REQUESTS) || 20
export const AI_DAILY_USER_TOKENS = Number(process.env.RUNOUT_AI_DAILY_USER_TOKENS) || 100_000
export const AI_MONTHLY_USER_USD = Number(process.env.RUNOUT_AI_MONTHLY_USER_USD) || 1.50
export const AI_GLOBAL_DAILY_TOKENS = Number(process.env.RUNOUT_AI_GLOBAL_DAILY_TOKENS) || 2_000_000
export const AI_GLOBAL_MONTHLY_USD = Number(process.env.RUNOUT_AI_GLOBAL_MONTHLY_USD) || 50

const SHARED_IDENTITY = '__global__'

// Read-increment-write a ceiling entry for `identity` in a window. Returns the
// advanced entry { w, count, tokens, usd } or null for the shared global
// identity (the global key is the fixed '__global__' — see consumeCeiling).
async function advance(store, key, { tokens, usd, windowMs, now }) {
  let entry = null
  try { entry = (await store.get(key, { type: 'json' })) || null } catch { entry = null }
  const w = windowIndex(now, windowMs)
  let next
  if (entry && entry.w === w) {
    next = {
      w,
      count: (Number(entry.count) || 0) + 1,
      tokens: (Number(entry.tokens) || 0) + tokens,
      usd: (Number(entry.usd) || 0) + usd,
    }
  } else {
    next = { w, count: 1, tokens, usd }
  }
  try { await store.setJSON(key, next) } catch { /* best-effort */ }
  return next
}

// Seconds until the next window boundary (for Retry-After).
function retryAfter(now, windowMs) {
  const nextBoundary = (windowIndex(now, windowMs) + 1) * windowMs
  return Math.max(1, Math.ceil((nextBoundary - now) / 1000))
}

// Peek a ceiling entry (no increment) so pre-flight checks can reject a
// request BEFORE burning the tokens — returns the current { count, tokens, usd }
// for the identity in the current window, or zeros.
async function peek(store, key, { windowMs, now }) {
  let entry = null
  try { entry = (await store.get(key, { type: 'json' })) || null } catch { entry = null }
  const w = windowIndex(now, windowMs)
  if (entry && entry.w === w) {
    return { count: Number(entry.count) || 0, tokens: Number(entry.tokens) || 0, usd: Number(entry.usd) || 0 }
  }
  return { count: 0, tokens: 0, usd: 0 }
}

function ceilingKey(scope, identity, windowLabel) {
  return `ccl:${scope}:${windowLabel}:${identity}`
}

// Common audit for every hard stop. `ceiling` names which ceiling tripped.
// `userId` is allowed; an email is only ever included as `emailHash`.
function auditCeiling(ceiling, { userId, emailHash: emailHashValue }) {
  const fields = { ceiling }
  if (userId) fields.userId = userId
  if (emailHashValue) fields.emailHash = emailHashValue
  logAudit('ai.cost_limit', fields)
}

// The generic cost-ceiling primitive. A single future AI integration calls
// this once per request, then spends only if it returns { allowed: true }.
//
//   store        — Blob store backing the counters (e.g. runout-rate-limits).
//   scope        — the resource scope (e.g. 'books:ai').
//   identity     — the calling user's id (''/null skips per-identity ceilings,
//                  keeping only the global caps). Pass 'global' to apply ALL
//                  ceilings in the global bucket instead of per-user.
//   tokens       — tokens this request would consume (for per-request ceiling).
//   usd          — estimated USD cost of this request (for per-request ceiling).
//   limits       — overrides for the documented thresholds (defaults above).
//
// Returns { allowed: true } when every ceiling clears, or
//   { allowed:false, status, code, error, retryAfter } for a hard stop.
//
// Enforcement order:
//   1. per-request token ceiling  (413 AI_TOKENS_EXCEEDED)
//   2. per-request USD ceiling    (429 AI_COST_LIMIT)
//   3. per-identity daily requests/tokens + monthly USD (429 AI_COST_LIMIT)
//   4. global daily tokens + monthly USD (429 AI_COST_LIMIT)
//
// `now` is injectable for deterministic tests.
export async function consumeCeiling(store, scope, identity, { tokens = 0, usd = 0, limits = {}, now = Date.now(), userId, emailHash: emailHashValue } = {}) {
  const L = {
    perRequestTokens: limits.perRequestTokens ?? AI_PER_REQUEST_TOKENS,
    perRequestUsd: limits.perRequestUsd ?? AI_PER_REQUEST_USD,
    dailyUserRequests: limits.dailyUserRequests ?? AI_DAILY_USER_REQUESTS,
    dailyUserTokens: limits.dailyUserTokens ?? AI_DAILY_USER_TOKENS,
    monthlyUserUsd: limits.monthlyUserUsd ?? AI_MONTHLY_USER_USD,
    globalDailyTokens: limits.globalDailyTokens ?? AI_GLOBAL_DAILY_TOKENS,
    globalMonthlyUsd: limits.globalMonthlyUsd ?? AI_GLOBAL_MONTHLY_USD,
  }

  // 1 & 2 — per-request ceilings (deterministic; no window).
  if (tokens > L.perRequestTokens) {
    auditCeiling('per_request_tokens', { userId, emailHash: emailHashValue })
    return { allowed: false, status: 413, code: 'AI_TOKENS_EXCEEDED', error: 'Request exceeds the per-request token ceiling.' }
  }
  if (usd > L.perRequestUsd) {
    auditCeiling('per_request_usd', { userId, emailHash: emailHashValue })
    return { allowed: false, status: 429, code: 'AI_COST_LIMIT', error: 'Request exceeds the per-request cost ceiling.', retryAfter: retryAfter(now, DAY_WINDOW_MS) }
  }

  // 3 — per-identity daily/monthly ceilings.
  if (identity) {
    const dailyKey = ceilingKey(scope, identity, 'day')
    const monthKey = ceilingKey(scope, identity, 'month')

    // Pre-flight peek: reject before advancing if the identity is already at
    // its daily for tokens/requests or monthly for USD. (We still advance the
    // daily counter below even when these pass, to count the request.)
    const daily = await peek(store, dailyKey, { windowMs: DAY_WINDOW_MS, now })
    if (daily.count >= L.dailyUserRequests) {
      auditCeiling('daily_user_requests', { userId, emailHash: emailHashValue })
      return { allowed: false, status: 429, code: 'AI_COST_LIMIT', error: 'Daily request ceiling reached.', retryAfter: retryAfter(now, DAY_WINDOW_MS) }
    }
    if (daily.tokens + tokens > L.dailyUserTokens) {
      auditCeiling('daily_user_tokens', { userId, emailHash: emailHashValue })
      return { allowed: false, status: 429, code: 'AI_COST_LIMIT', error: 'Daily token ceiling reached.', retryAfter: retryAfter(now, DAY_WINDOW_MS) }
    }
    const monthly = await peek(store, monthKey, { windowMs: MONTH_WINDOW_MS, now })
    if (monthly.usd + usd > L.monthlyUserUsd) {
      auditCeiling('monthly_user_usd', { userId, emailHash: emailHashValue })
      return { allowed: false, status: 429, code: 'AI_COST_LIMIT', error: 'Monthly cost ceiling reached.', retryAfter: retryAfter(now, MONTH_WINDOW_MS) }
    }

    // Advance the per-identity counters (only when every per-identity ceiling
    // cleared — an accepted request).
    await advance(store, dailyKey, { tokens, usd, windowMs: DAY_WINDOW_MS, now })
    await advance(store, monthKey, { tokens, usd, windowMs: MONTH_WINDOW_MS, now })
  }

  // 4 — global daily tokens + monthly USD.
  const gDailyKey = ceilingKey(scope, SHARED_IDENTITY, 'day')
  const gMonthKey = ceilingKey(scope, SHARED_IDENTITY, 'month')
  const gDaily = await peek(store, gDailyKey, { windowMs: DAY_WINDOW_MS, now })
  if (gDaily.tokens + tokens > L.globalDailyTokens) {
    auditCeiling('global_daily_tokens', { userId, emailHash: emailHashValue })
    return { allowed: false, status: 429, code: 'AI_COST_LIMIT', error: 'Global daily token ceiling reached.', retryAfter: retryAfter(now, DAY_WINDOW_MS) }
  }
  const gMonthly = await peek(store, gMonthKey, { windowMs: MONTH_WINDOW_MS, now })
  if (gMonthly.usd + usd > L.globalMonthlyUsd) {
    auditCeiling('global_monthly_usd', { userId, emailHash: emailHashValue })
    return { allowed: false, status: 429, code: 'AI_COST_LIMIT', error: 'Global monthly cost ceiling reached.', retryAfter: retryAfter(now, MONTH_WINDOW_MS) }
  }
  await advance(store, gDailyKey, { tokens, usd, windowMs: DAY_WINDOW_MS, now })
  await advance(store, gMonthKey, { tokens, usd, windowMs: MONTH_WINDOW_MS, now })

  return { allowed: true }
}
