// ai-fallback.js — AI provider fallback with bounded retry and cooldown
// (ADMIN-3.8, #310, epic #302). When the primary provider fails with a
// retryable error, the fallback provider (if configured) is tried instead.
//
// Cooldown: after a provider fails, it enters a cooldown period during which
// it is skipped and the fallback (or a hard failure) is used instead. This
// prevents a flapping provider from consuming the entire request budget.
//
// Retry is bounded: the primary gets at most `maxRetries` attempts before the
// fallback is tried. The fallback itself gets at most 1 attempt (no cascading
// fallback chains — the AC says "optional fallback provider is supported for
// transient failure").
//
// Security:
//   - Provider credentials are never logged.
//   - Cooldown state is ephemeral (in-memory) — never persisted.
//   - Fallback only activates on retryable errors (timeout, rate-limit, 5xx).

import { ProviderErrorCode } from './provider'
import { recordUsageEvent } from './ai-cost-tracker'

// Default cooldown period in milliseconds (60 seconds).
const DEFAULT_COOLDOWN_MS = 60_000

// Maximum retries for the primary provider before falling back.
const DEFAULT_MAX_RETRIES = 2

// In-memory cooldown state. Keyed by provider id, value is the epoch ms until
// which the provider is in cooldown.
const cooldownState = new Map()

// ---------------------------------------------------------------------------
// Cooldown management
// ---------------------------------------------------------------------------

// Mark a provider as in cooldown. `providerId` is the profile id, `durationMs`
// is the cooldown period (defaults to DEFAULT_COOLDOWN_MS).
import { listProviderProfiles } from './ai-admin'

export function setCooldown(providerId, durationMs = DEFAULT_COOLDOWN_MS) {
  if (!providerId) return
  cooldownState.set(String(providerId), Date.now() + durationMs)
}

// Check if a provider is in cooldown. Returns true if the provider should be
// skipped.
export function isInCooldown(providerId) {
  if (!providerId) return false
  const until = cooldownState.get(String(providerId))
  if (!until) return false
  if (Date.now() >= until) {
    cooldownState.delete(String(providerId))
    return false
  }
  return true
}

// Clear all cooldown state (for testing or manual reset).
export function clearCooldowns() {
  cooldownState.clear()
}

// Get the current cooldown state (for diagnostics). Returns an array of
// { providerId, remainingMs } entries.
export function getCooldownState() {
  const now = Date.now()
  const result = []
  for (const [id, until] of cooldownState) {
    const remaining = Math.max(0, until - now)
    if (remaining > 0) {
      result.push({ providerId: id, remainingMs: remaining })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Retryable error check
// ---------------------------------------------------------------------------

// Returns true if the error code is retryable (transient failure that might
// succeed on a different provider).
export function isRetryableError(code) {
  return code === ProviderErrorCode.TIMEOUT
    || code === ProviderErrorCode.RATE_LIMIT
    || code === ProviderErrorCode.FAILURE
}

// ---------------------------------------------------------------------------
// Fallback execution
// ---------------------------------------------------------------------------

// Execute a provider call with fallback support.
//
// `primaryProvider` - the primary provider instance
// `primaryId` - the primary provider profile id (for cooldown tracking)
// `fallbackProvider` - the fallback provider instance (or null)
// `fallbackId` - the fallback provider profile id (for cooldown tracking)
// `callFn` - async function that takes a provider and returns the result
// `options` - { maxRetries, cooldownMs }
//
// Returns the result from the first successful provider call. Throws if both
// providers fail.
export async function withFallback({
  primaryProvider,
  primaryId,
  fallbackProvider = null,
  fallbackId = null,
  callFn,
  options = {},
}) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS

  // If the primary is in cooldown, skip straight to fallback.
  if (isInCooldown(primaryId) && fallbackProvider) {
    return executeFallback({ fallbackProvider, fallbackId, callFn, cooldownMs })
  }

  // Try the primary with bounded retries.
  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await callFn(primaryProvider)
      // Success — clear any cooldown on the primary.
      if (primaryId) cooldownState.delete(String(primaryId))
      return result
    } catch (err) {
      lastError = err
      // Record the failure event.
      recordUsageEvent({
        provider: primaryProvider?.name || 'unknown',
        model: primaryProvider?.model || 'unknown',
        tokensIn: null,
        tokensOut: null,
        latencyMs: null,
        ok: false,
        errorCode: err?.code || 'PROVIDER_FAILURE',
      }).catch(() => {})

      // If this is not retryable, fail immediately.
      if (!isRetryableError(err?.code)) {
        throw err
      }

      // If we have a fallback and this is the last retry, try the fallback.
      if (attempt === maxRetries && fallbackProvider) {
        // Put the primary into cooldown.
        if (primaryId) setCooldown(primaryId, cooldownMs)
        return executeFallback({ fallbackProvider, fallbackId, callFn, cooldownMs })
      }

      // Otherwise, continue retrying (the caller's retry loop handles backoff).
    }
  }

  // All retries exhausted with no fallback.
  if (primaryId) setCooldown(primaryId, cooldownMs)
  throw lastError || new Error('Provider call failed after all retries.')
}

// Execute the fallback provider (single attempt, no retry chain).
async function executeFallback({ fallbackProvider, fallbackId, callFn, cooldownMs }) {
  if (isInCooldown(fallbackId)) {
    throw Object.assign(new Error('Fallback provider is in cooldown.'), { code: 'FALLBACK_COOLDOWN' })
  }
  try {
    const result = await callFn(fallbackProvider)
    // Success — clear any cooldown on the fallback.
    if (fallbackId) cooldownState.delete(String(fallbackId))
    return result
  } catch (err) {
    // Put the fallback into cooldown.
    if (fallbackId) setCooldown(fallbackId, cooldownMs)
    recordUsageEvent({
      provider: fallbackProvider?.name || 'unknown',
      model: fallbackProvider?.model || 'unknown',
      tokensIn: null,
      tokensOut: null,
      latencyMs: null,
      ok: false,
      errorCode: err?.code || 'PROVIDER_FAILURE',
    }).catch(() => {})
    throw err
  }
}

/** Returns the currently active (enabled) AI provider profile, or null. */
export async function getActiveProvider() {
  const profiles = await listProviderProfiles()
  return profiles.find((p) => p.active) || null
}