// @vitest-environment node
//
// Tests for the @hourly lookup-queue drain function (T6, #285):
//   - the scheduled `@hourly` config is present (Netlify cron convention),
//   - the handler returns a SERVICE-ONLY counter summary — the queue and its
//     payload are NEVER echoed to any client,
//   - the function runs under a service identity (no client session) and
//     encodes no client-visible error text on failure.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config, handler } from '../lookup-queue-drain'

// Avoid touching a real repository; mock getRepository to hand back an in-memory
// queue + items double so the handler path is exercised in isolation.
const { q } = vi.hoisted(() => {
  const rows = []
  const tenants = new Set()
  const q = {
    _rows: rows,
    async enqueue() {},
    async listPendingUsers() { return [...tenants] },
    async claimDue() { return rows.splice(0) },
    async markDone() {},
    async markFailed() {},
  }
  return { q }
})

const { repoRef } = vi.hoisted(() => ({ repoRef: { current: null } }))
vi.mock('./repository', () => ({ getRepository: () => repoRef.current }))
// Stub the fixed-host lookup to avoid any real network in tests.
vi.mock('./lookup-fetch', () => ({ lookupFetch: async () => ({ ok: false, status: 503 }) }))

let calledLookupRows

beforeEach(() => {
  calledLookupRows = []
  repoRef.current = { lookupQueue: q, items: null }
})

describe('lookup-queue-drain scheduled function', () => {
  it('declares the Netlify @hourly schedule', () => {
    expect(config.schedule).toBe('@hourly')
  })

  it('returns a service-only summary (queue never echoed to a client)', async () => {
    const res = await handler()
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    // Only counters — no queue rows, ids, keys or payloads.
    expect(res.body.summary).toEqual({ processed: 0, enriched: 0, failed: 0, abandoned: 0 })
    expect(JSON.stringify(res.body)).not.toMatch(/item:|id|payload|queued/)
  })

  it('the handler never surfaces internals on failure (safeError integrity)', async () => {
    // A repo with no queue/items still yields a safe, counter-only response.
    repoRef.current = { lookupQueue: null, items: null }
    const res = await handler()
    expect([200, 500]).toContain(res.statusCode)
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|Error|stack|token|key|payload|item:/)
  })
})
