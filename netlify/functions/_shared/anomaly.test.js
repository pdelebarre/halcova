// @vitest-environment node
//
// Tests for the anomaly-detection signal (netlify/functions/_shared/anomaly.js,
// SEC-6.6 #220). Uses the same in-memory @netlify/blobs mock pattern as the
// other function tests so the fixed-window counter + burst emission are proven
// through the real store interface.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANOMALY_WINDOW_MS, anomalyScope, recordAnomaly } from './anomaly'
import { windowIndex } from './rate-limit'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key) { const v = this.data.get(String(key)); return v === undefined ? null : JSON.parse(JSON.stringify(v)) },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

let store

beforeEach(() => {
  store = createStore()
  stores.audit = store
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  vi.restoreAllMocks()
})

describe('recordAnomaly', () => {
  it('emits an anomaly audit event only when the burst crosses the threshold', async () => {
    // Threshold 3: the 3rd rapid occurrence in the window emits; the 1st/2nd
    // do not.
    const key = 'anom:auth:login:1.2.3.4'
    const r1 = await recordAnomaly(store, key, { threshold: 3, signal: 'auth_failure_burst' })
    expect(r1.burst).toBe(false)
    expect(console.log).not.toHaveBeenCalled()

    await recordAnomaly(store, key, { threshold: 3, signal: 'auth_failure_burst' })
    expect(console.log).not.toHaveBeenCalled()

    const r3 = await recordAnomaly(store, key, { threshold: 3, signal: 'auth_failure_burst' })
    expect(r3.burst).toBe(true)
    expect(r3.count).toBe(3)
    expect(console.log).toHaveBeenCalledTimes(1)
    const line = console.log.mock.calls[0][0]
    expect(line.startsWith('AUDIT ')).toBe(true)
    const event = JSON.parse(line.slice('AUDIT '.length))
    expect(event.type).toBe('anomaly')
    expect(event.signal).toBe('auth_failure_burst')
    expect(event.count).toBe(3)
  })

  it('emits once per window, then resets on the next window (no persistent flood)', async () => {
    const key = 'anom:admin:deny:203.0.113.9'
    const t0 = 1_000_000_000_000
    const windowMs = ANOMALY_WINDOW_MS

    // 3 rapid hits in window 1.
    await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t0 })
    await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t0 })
    const cross = await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t0 })
    expect(cross.burst).toBe(true)
    expect(console.log).toHaveBeenCalledTimes(1)

    // A 4th hit in the SAME window does not re-emit (already crossed).
    await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t0 })
    expect(console.log).toHaveBeenCalledTimes(1)

    // Next window: counter resets, so it takes 3 more hits to emit again.
    const t1 = (windowIndex(t0, windowMs) + 1) * windowMs
    await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t1 })
    await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t1 })
    const cross2 = await recordAnomaly(store, key, { threshold: 3, signal: 's', windowMs, now: t1 })
    expect(cross2.burst).toBe(true)
    expect(console.log).toHaveBeenCalledTimes(2)
  })

  it('never logs a secret in the anomaly event fields (redacted)', async () => {
    const key = 'anom:x'
    await recordAnomaly(store, key, {
      threshold: 1,
      signal: 'webhook_invalid_signature_burst',
      fields: { code: 'RU-ABCD-EFGH-JKLM', userId: 'u-1' },
    })
    const line = console.log.mock.calls[0][0]
    expect(line).not.toContain('RU-ABCD')
    expect(line).toContain('u-1')
  })

  it('stores only a hashed scope, never the raw client IP, when a scope is provided (NIT M5)', async () => {
    const key = 'anom:auth:login:203.0.113.7'
    const scope = anomalyScope('anom:auth:login', '203.0.113.7')
    await recordAnomaly(store, key, { threshold: 1, signal: 'auth_failure_burst', scope })
    const line = console.log.mock.calls[0][0]
    // The raw IP must not appear anywhere in the emitted audit event.
    expect(line).not.toContain('203.0.113.7')
    const event = JSON.parse(line.slice('AUDIT '.length))
    expect(event.scope).toBe(scope)
    // A stable, non-PII fingerprint: prefix + 16 hex chars (truncated sha256).
    expect(scope).toMatch(/^anom:auth:login:[0-9a-f]{16}$/)
  })

  it('defaults the audit scope to the key when no scope is provided', async () => {
    const key = 'anom:x'
    await recordAnomaly(store, key, { threshold: 1, signal: 's' })
    const event = JSON.parse(console.log.mock.calls[0][0].slice('AUDIT '.length))
    expect(event.scope).toBe(key)
  })

  it('tolerates a failed store read/write (degrades, never throws)', async () => {
    const badStore = {
      get: async () => { throw new Error('down') },
      setJSON: async () => { throw new Error('down') },
    }
    await expect(recordAnomaly(badStore, 'k', { threshold: 2, signal: 's' })).resolves.toMatchObject({ burst: false })
  })

  it('returns no burst for an invalid threshold', async () => {
    const r = await recordAnomaly(store, 'k', { threshold: 0, signal: 's' })
    expect(r).toEqual({ burst: false, count: 0 })
  })
})
