// @vitest-environment node
//
// Behavioral tests for the Blobs-first deferred-enrichment queue store (T6,
// #285) — netlify/functions/_shared/lookup-queue-store.js. The "Blobs-first"
// backend behind the shared `_shared/lookup-queue.js` seam. These cover the
// full op surface (enqueue / claimDue / markDone / markFailed / listPendingUsers
// / countPending) plus the per-row tenant guard (markDone/markFailed reject a
// userId that doesn't own the row).
//
// @netlify/blobs is replaced with an in-memory registry (the same trick as
// blob-repository.test.js / feedback-blob.test.js) so no site context or
// network is required. The store under test is the real module; only the Blobs
// primitive (getStore) is doubled.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLookupQueueStore } from './lookup-queue-store'

// In-memory @netlify/blobs registry: getStore returns a per-name in-memory
// store, so createLookupQueueStore() opens the shared `runout-lookup-queue`
// store exactly as in production.
const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, { type } = {}) {
        const value = this.data.get(String(key))
        if (value === undefined) return null
        return type === 'json' ? JSON.parse(JSON.stringify(value)) : value
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
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

// A row is DUE (claimable) when its nextAt is in the past. Default enqueue uses
// nextAt = now, which is due for the claim below (Date.now() during the test).
function enqueueNow(userId, opts = {}) {
  return store.enqueue({
    user_id: userId,
    kind: opts.kind || 'records',
    item_id: opts.item_id ?? null,
    payload: opts.payload || { provider: 'discogs', key: opts.key || 'k' },
    key: opts.key || 'k',
    nextAt: opts.nextAt,
  })
}

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
  store = createLookupQueueStore()
})

describe('lookup-queue-store — enqueue', () => {
  it('writes a pending row and indexes it for the tenant', async () => {
    const id = await enqueueNow('u1', { item_id: 'item-1', key: 'barcode:123' })
    expect(id).toBeTruthy()
    const row = stores['runout-lookup-queue'].data.get(`item:${id}`)
    expect(row.status).toBe('pending')
    expect(row.userId).toBe('u1')
    expect(row.kind).toBe('records')
    expect(row.itemId).toBe('item-1')
    expect(row.attempts).toBe(0)
    expect(row.lastError).toBeNull()
    const index = JSON.parse(JSON.stringify(stores['runout-lookup-queue'].data.get('index:u1')))
    expect(index).toEqual([id])
  })

  it('re-enqueueing the same lookup+key is idempotent (single index entry)', async () => {
    const first = await enqueueNow('u1', { key: 'barcode:456' })
    const second = await enqueueNow('u1', { key: 'barcode:456' })
    expect(first).toBe(second)
    const index = JSON.parse(JSON.stringify(stores['runout-lookup-queue'].data.get('index:u1')))
    expect(index).toHaveLength(1)
  })

  it('different tenants keep separate indexes (tenant isolation)', async () => {
    await enqueueNow('u1', { key: 'a' })
    await enqueueNow('u2', { key: 'b' })
    const a = JSON.parse(JSON.stringify(stores['runout-lookup-queue'].data.get('index:u1')))
    const b = JSON.parse(JSON.stringify(stores['runout-lookup-queue'].data.get('index:u2')))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]).not.toBe(b[0])
  })
})

describe('lookup-queue-store — claimDue', () => {
  it('claims only due pending rows, oldest first, for one tenant', async () => {
    await enqueueNow('u1', { key: 'barcode:1', nextAt: new Date(Date.now() - 2000) })
    await enqueueNow('u1', { key: 'barcode:2', nextAt: new Date(Date.now() - 1000) })
    await enqueueNow('u2', { key: 'barcode:3', nextAt: new Date(Date.now() - 1000) })
    const due = await store.claimDue('u1', 10)
    expect(due).toHaveLength(2)
    expect(due[0].payload.key).toBe('barcode:1') // oldest first
    // Does not claim the other tenant's row.
    expect(due.every((r) => r.payload.key !== 'barcode:3')).toBe(true)
  })

  it('skips rows that are not yet due and non-pending rows', async () => {
    await enqueueNow('u1', { key: 'future', nextAt: new Date(Date.now() + 60_000) })
    await enqueueNow('u1', { key: 'due', nextAt: new Date(Date.now() - 1000) })
    const id = await enqueueNow('u1', { key: 'done', nextAt: new Date(Date.now() - 1000) })
    await store.markDone('u1', id)
    const due = await store.claimDue('u1', 10)
    expect(due.map((r) => r.payload.key)).toEqual(['due'])
  })

  it('caps the claim set by limit and never returns empty rows', async () => {
    for (let i = 0; i < 5; i++) await enqueueNow('u1', { key: `k${i}`, nextAt: new Date(Date.now() - 1000) })
    expect(await store.claimDue('u1', 3)).toHaveLength(3)
    expect(await store.claimDue('u1', 0)).toHaveLength(5) // 0 -> floor of 1, no cap
  })
})

describe('lookup-queue-store — markDone / markFailed', () => {
  it('markDone sets status done, stamps enrichedAt, clears lastError', async () => {
    const id = await enqueueNow('u1', { key: 'k' })
    await store.markFailed('u1', id, { error: 'HTTP_502' })
    await store.markDone('u1', id)
    const row = stores['runout-lookup-queue'].data.get(`item:${id}`)
    expect(row.status).toBe('done')
    expect(row.lastError).toBeNull()
    expect(row.enrichedAt).toBeTruthy()
    expect(await store.countPending('u1')).toBe(0)
  })

  it('markFailed bumps attempts, advances next_at; abandon flips to abandoned', async () => {
    const id = await enqueueNow('u1', { key: 'k' })
    const later = new Date(Date.now() + 3600_000)
    await store.markFailed('u1', id, { nextAt: later, error: 'HTTP_429' })
    let row = stores['runout-lookup-queue'].data.get(`item:${id}`)
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBe('HTTP_429')
    expect(new Date(row.nextAt).getTime()).toBe(later.getTime())
    expect(await store.claimDue('u1', 10)).toHaveLength(0) // not due yet

    await store.markFailed('u1', id, { nextAt: new Date(Date.now() - 1000), abandon: true, error: 'HTTP_502' })
    row = stores['runout-lookup-queue'].data.get(`item:${id}`)
    expect(row.status).toBe('abandoned')
    expect(row.attempts).toBe(2)
    expect(await store.countPending('u1')).toBe(0)
  })
})

describe('lookup-queue-store — tenant guard on completion ops', () => {
  it('markDone with the wrong userId does NOT mutate another tenant\'s row', async () => {
    const id = await enqueueNow('u1', { key: 'k' })
    await store.markDone('u2', id) // u2 tries to complete u1's row
    const row = stores['runout-lookup-queue'].data.get(`item:${id}`)
    expect(row.status).toBe('pending') // untouched
    expect(row.userId).toBe('u1')
  })

  it('markFailed with the wrong userId does NOT bump another tenant\'s row', async () => {
    const id = await enqueueNow('u1', { key: 'k' })
    await store.markFailed('u2', id, { error: 'HTTP_500', nextAt: new Date() })
    const row = stores['runout-lookup-queue'].data.get(`item:${id}`)
    expect(row.attempts).toBe(0)
    expect(row.status).toBe('pending')
  })
})

describe('lookup-queue-store — listPendingUsers / countPending', () => {
  it('countPending counts only pending rows for a tenant', async () => {
    await enqueueNow('u1', { key: 'a' })
    await enqueueNow('u1', { key: 'b' })
    await enqueueNow('u2', { key: 'c' })
    expect(await store.countPending('u1')).toBe(2)
    expect(await store.countPending('u2')).toBe(1)
    expect(await store.countPending('u3')).toBe(0)
  })

  it('listPendingUsers is fed by the caller on the Blobs backend (returns [])', async () => {
    // Blobs has no cross-tenant index scan; the drain is fed the member set by
    // the caller from the identity store. The store itself exposes no global
    // scan, so it returns [] (documented Blobs-only behavior).
    await enqueueNow('u1', { key: 'a' })
    expect(await store.listPendingUsers()).toEqual([])
  })
})
