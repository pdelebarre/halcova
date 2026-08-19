// provider-state.js — short-lived per-provider circuit-breaker state
// (RES-1.4 T4, #291, lookup-resilience epic #281, M1).
//
// WHY a SEPARATE store from lookup_cache: lookup_cache holds REAL provider
// payloads (positive + negative-cache entries) for up to 30 days. Outage /
// cooldown state is SHORT-lived and must NEVER be written into that long-lived
// cache — a 30d "provider is down" mark is a classic cache-poisoning bug that
// would suppress a provider long after it recovered. So cooldown marks live in
// their OWN tiny store (`runout-provider-state`), keyed by provider name, with
// a ~60s lifetime.
//
// Contract:
//   - readCooldownMs(store, provider) -> 0 when NOT in cooldown, else the
//     remaining ms (so a caller can skip the provider without re-hitting it).
//   - recordProviderDown(store, provider) -> best-effort write of
//     { provider, downAt: Date.now(), cooldownMs: 60000 }.
//
// The lookup chains (discogs.js / books.js) call these around the PRIMARY
// provider only: they arm the breaker after a genuine provider-down outcome
// (5xx / network / timeout -> HTTP_ERROR by a non-NO_FALLBACK path) and skip
// the primary while it is in cooldown. NO_FALLBACK_CODES (token/config/rate
// limit) deliberately do NOT arm it — see the in-code note in discogs.js /
// books.js for the full 429 tension resolution.
//
// Best-effort throughout: a failed cooldown read/write must never fail a valid
// lookup.

// The standalone Blob store for provider circuit-breaker state.
export const PROVIDER_STATE_STORE = 'runout-provider-state'

// Cooldown window after a genuine provider-down outcome (~60s). Long enough to
// stop hammering a down provider, short enough to retry promptly after a blip.
export const PROVIDER_COOLDOWN_MS = 60 * 1000

// Return the remaining cooldown for a provider in ms, or 0 when it is not in
// cooldown (no record / expired / unreadable). Never throws.
export async function readCooldownMs(store, provider) {
  if (!store || !provider) return 0
  let rec
  try {
    rec = await store.get(String(provider), { type: 'json' })
  } catch {
    return 0
  }
  if (!rec || typeof rec !== 'object') return 0
  if (!Number.isFinite(rec.downAt) || !Number.isFinite(rec.cooldownMs)) return 0
  const remaining = rec.cooldownMs - (Date.now() - rec.downAt)
  return Math.max(0, remaining)
}

// (Re)arm the circuit breaker for a provider with a fresh ~60s cooldown.
// Best-effort: a failed write must never fail a valid lookup.
export async function recordProviderDown(store, provider) {
  if (!store || !provider) return
  const rec = {
    provider: String(provider),
    downAt: Date.now(),
    cooldownMs: PROVIDER_COOLDOWN_MS,
  }
  try {
    await store.setJSON(String(provider), rec)
  } catch {
    // ignore — best-effort
  }
}
