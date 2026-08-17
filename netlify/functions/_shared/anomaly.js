// Lightweight, dependency-free security anomaly-detection signal (SEC-6.6,
// #220) — NOT a full SIEM. It counts occurrences of a signal in a fixed window
// and, when a burst crosses a threshold, emits an `anomaly` audit event so
// alerting can pick it up (see docs/technical.md § 13.6 for how alerts are
// surfaced — Netlify function logs / a deploy-hook drain).
//
// Design: reuses the same fixed-window counter semantics as _shared/rate-limit.js
// (window index lives in the value, not the key) so an identity keeps one blob
// key per scope and windows auto-reset. The store is injected (this module never
// imports @netlify/blobs) so the detection logic is unit-testable under node,
// and a failed read/write degrades to letting the request through.
//
// Emits ONCE per window per signal (on the exact crossing of the threshold), so
// a sustained flood produces one alert per window rather than per-request spam.

import { windowIndex } from './rate-limit'
import { logAudit } from './audit'

export const ANOMALY_WINDOW_MS = 60_000

// Record one occurrence of `key` in `store` and, when the count in the current
// fixed window crosses `threshold`, emit an anomaly audit event (once) and
// return { burst: true, count }. `signal` names the signal (e.g.
// 'auth_failure_burst') and `fields` are extra safe audit fields (redacted).
export async function recordAnomaly(store, key, { threshold, signal, windowMs = ANOMALY_WINDOW_MS, fields = {}, now = Date.now() } = {}) {
  if (!threshold || threshold < 1) return { burst: false, count: 0 }
  let entry = null
  try { entry = (await store.get(key, { type: 'json' })) || null } catch { entry = null }
  const w = windowIndex(now, windowMs)
  const count = entry && entry.w === w ? (Number(entry.count) || 0) : 0
  const next = count + 1
  try { await store.setJSON(key, { w, count: next }) } catch { /* best-effort */ }
  if (next === threshold) {
    logAudit('anomaly', { signal, scope: key, count: next, ...fields })
    return { burst: true, count: next }
  }
  return { burst: false, count: next }
}
