// @vitest-environment node
//
// Tests for the shared provider circuit-breaker state (netlify/functions/
// _shared/provider-state.js, RES-1.4 T4 #291): a SHORT-lived per-provider
// cooldown store (runout-provider-state) that is deliberately SEPARATE from the
// 30d lookup_cache so outage state can never poison the long-lived cache.
//
// Proves:
//   - readCooldownMs returns 0 when there is no record / no valid shape.
//   - recordProviderDown writes { provider, downAt, cooldownMs: 60000 }.
//   - readCooldownMs returns the REMAINING ms while in cooldown, and 0 once the
//     ~60s window has elapsed (fake timers — no real waiting).
//   - reads/writes are best-effort (never throw on a bad store).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_COOLDOWN_MS, readCooldownMs, recordProviderDown } from './provider-state'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key) {
        const value = this.data.get(String(key))
        return value === undefined ? null : JSON.parse(JSON.stringify(value))
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({
  getStore: (name) => {
    if (!stores[name]) stores[name] = createStore()
    return stores[name]
  },
}))

let store

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  store = createStore()
  // Deterministic clock: a fake "now" we can advance without real timers.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('readCooldownMs', () => {
  it('returns 0 when there is no record for the provider', async () => {
    expect(await readCooldownMs(store, 'discogs')).toBe(0)
    expect(await readCooldownMs(store, 'books')).toBe(0)
  })

  it('returns 0 on a malformed / missing-shape record (best-effort, never throws)', async () => {
    await store.setJSON('discogs', { unexpected: true })
    expect(await readCooldownMs(store, 'discogs')).toBe(0)

    await store.setJSON('books', null)
    expect(await readCooldownMs(store, 'books')).toBe(0)
  })

  it('returns the REMAINING ms while the provider is in cooldown', async () => {
    await recordProviderDown(store, 'discogs')
    // Just armed -> nearly the full window remains.
    const remaining = await readCooldownMs(store, 'discogs')
    expect(remaining).toBeGreaterThan(PROVIDER_COOLDOWN_MS - 1000)
    expect(remaining).toBeLessThanOrEqual(PROVIDER_COOLDOWN_MS)
  })

  it('returns 0 once the ~60s cooldown window has elapsed (no real waiting)', async () => {
    await recordProviderDown(store, 'discogs')
    // Advance past the window.
    vi.advanceTimersByTime(PROVIDER_COOLDOWN_MS + 1000)
    expect(await readCooldownMs(store, 'discogs')).toBe(0)
  })

  it('returns 0 when the given store or provider is falsy (best-effort)', async () => {
    expect(await readCooldownMs(null, 'discogs')).toBe(0)
    expect(await readCooldownMs(store, '')).toBe(0)
  })
})

describe('recordProviderDown', () => {
  it('writes { provider, downAt: now, cooldownMs: 60000 } into the provider-state store', async () => {
    await recordProviderDown(store, 'discogs')
    const rec = await store.get('discogs')
    expect(rec.provider).toBe('discogs')
    expect(rec.downAt).toBe(Date.now())
    expect(rec.cooldownMs).toBe(PROVIDER_COOLDOWN_MS)
  })

  it('stores providers independently (scoped by provider name)', async () => {
    await recordProviderDown(store, 'discogs')
    expect(await readCooldownMs(store, 'discogs')).toBeGreaterThan(0)
    expect(await readCooldownMs(store, 'books')).toBe(0)
  })

  it('is best-effort — a throwing store does not reject', async () => {
    const badStore = { setJSON: async () => { throw new Error('boom') } }
    await expect(recordProviderDown(badStore, 'discogs')).resolves.toBeUndefined()
  })

  it('does nothing (and does not throw) for a falsy provider', async () => {
    await recordProviderDown(store, '')
    expect(store.data.size).toBe(0)
  })
})
