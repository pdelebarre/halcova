// @vitest-environment node
//
// Tests for the shared deferred-enrichment seam (netlify/functions/_shared/
// lookup-queue.js): the idempotent field-merge, the abandon/back-off policy,
// and the drain loop (tenant isolation, re-run no-op, user-edit preservation,
// safeError integrity). Uses in-memory queue + items doubles so the seam is
// tested without a live Postgres/Blobs.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  mergeFields,
  stampEnriched,
  nextAttemptAt,
  shouldAbandon,
  enqueue,
  drain,
  enqueuePartialSave,
  piggybackDrain,
} from './lookup-queue'

describe('mergeFields — idempotent field merge', () => {
  it('fills only missing/null/empty fields', () => {
    const item = { title: 'Kept', year: 1999, label: null, genre: [], coverImage: '' }
    const fetched = { title: 'New', year: 2001, label: 'Provider', genre: ['Rock'], coverImage: 'c' }
    const merged = mergeFields(item, fetched)
    expect(merged.title).toBe('Kept')
    expect(merged.year).toBe(1999)
    expect(merged.label).toBe('Provider')
    expect(merged.genre).toEqual(['Rock'])
    expect(merged.coverImage).toBe('c')
  })

  it('never overwrites a user-edited value', () => {
    const item = { title: 'User Title', genre: ['Indie'] }
    const fetched = { title: 'Provider Title', genre: ['Metal'] }
    const merged = mergeFields(item, fetched)
    expect(merged.title).toBe('User Title')
    expect(merged.genre).toEqual(['Indie'])
  })

  it('does not fail on null/undefined inputs and does not mutate the source', () => {
    const item = { title: 'a', genre: null }
    const before = JSON.stringify(item)
    const merged = mergeFields(item, { genre: ['X'] })
    expect(merged.genre).toEqual(['X'])
    expect(JSON.stringify(item)).toBe(before) // source untouched
    expect(mergeFields(null, {})).toBeNull()
    expect(mergeFields({}, null)).toEqual({})
  })
})

describe('stampEnriched — flags', () => {
  it('clears metadataPending and stamps enrichedAt', () => {
    const out = stampEnriched({ metadataPending: true, title: 'x' }, new Date('2026-08-19T00:00:00Z'))
    expect(out.metadataPending).toBe(false)
    expect(out.enrichedAt).toBe('2026-08-19T00:00:00.000Z')
    expect(out.title).toBe('x')
  })
})

describe('backoff / abandon policy', () => {
  it('exponential next_at grows with attempts', () => {
    const t = 1_700_000_000_000
    const a1 = nextAttemptAt(1, t).getTime()
    const a4 = nextAttemptAt(4, t).getTime()
    expect(a1).toBe(t + 2 * 3600_000)
    expect(a4).toBe(t + 16 * 3600_000)
  })

  it('abandons after MAX attempts (>=5) or an aged row', () => {
    expect(shouldAbandon({ attempts: 5 })).toBe(true)
    expect(shouldAbandon({ attempts: 4 })).toBe(false)
    const aged = new Date(Date.now() - (7 * 24 * 3600_000 + 1)).toISOString()
    expect(shouldAbandon({ attempts: 1, nextAt: aged })).toBe(true)
  })

  it('never retries a permanent failure more than once', () => {
    expect(shouldAbandon({ attempts: 1, permanent: true })).toBe(true)
    expect(shouldAbandon({ attempts: 0, permanent: true })).toBe(false)
  })
})

describe('enqueue — best-effort, never throws', () => {
  it('writes a normalized entry and swallows queue errors', async () => {
    const calls = []
    const queue = { enqueue: async (e) => { calls.push(e); return 'id' } }
    const id = await enqueue(queue, { user_id: 'u1', kind: 'records', barcode: '123', provider: 'discogs', item_id: 'i1' })
    expect(id).toBe('id')
    expect(calls[0]).toMatchObject({ user_id: 'u1', kind: 'records', item_id: 'i1', payload: { provider: 'discogs', barcode: '123' } })
    const boom = { enqueue: async () => { throw new Error('down') } }
    expect(await enqueue(boom, { user_id: 'u1', kind: 'records', provider: 'discogs' })).toBeNull()
  })
})

describe('drain — tenant isolation + idempotent merge + re-run no-op', () => {
  let queue
  let items
  let lookup

  const mkItem = (id, extra = {}) => ({
    id, title: 'Partial', metadataPending: true, dateAdded: new Date().toISOString(), barcode: 'x', ...extra,
  })

  // An in-memory queue double with per-tenant id scoping + tenant isolation.
  function makeQueue() {
    const rows = {} // id -> { userId, status, attempts, nextAt, payload, itemId }
    const tenants = new Set()
    return {
      _rows: rows,
      async enqueue(e) {
        const id = `${e.user_id}:${e.payload?.key || e.key}`
        rows[id] = { id, user_id: e.user_id, kind: e.kind, status: 'pending', attempts: 0, nextAt: new Date(0), payload: e.payload, itemId: e.item_id }
        tenants.add(e.user_id)
        return id
      },
      async listPendingUsers() { return [...tenants] },
      async claimDue(userId, limit) {
        return Object.values(rows)
          .filter((r) => r.user_id === userId && r.status === 'pending' && new Date(r.nextAt) <= new Date())
          .slice(0, limit)
          .map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, item_id: r.itemId, attempts: r.attempts, next_at: r.nextAt }))
      },
      async markDone(userId, id) { if (rows[id]?.user_id === userId) rows[id].status = 'done' },
      async markFailed(userId, id, { abandon }) { if (rows[id]?.user_id === userId) { rows[id].attempts += 1; if (abandon) rows[id].status = 'abandoned' } },
    }
  }

  // An in-memory items double with tenant-owner isolation.
  function makeItems() {
    const byOwner = {}
    return {
      async mergeEnriched(ownerId, kind, id, additions) {
        const owner = byOwner[ownerId] || (byOwner[ownerId] = {})
        if (!owner[id]) return null
        const cur = owner[id]
        for (const k of Object.keys(additions)) {
          if (cur[k] == null || cur[k] === '') cur[k] = additions[k]
        }
        cur.metadataPending = false
        cur.enrichedAt = new Date().toISOString()
        return { ...cur }
      },
      _seed(ownerId, item) { (byOwner[ownerId] || (byOwner[ownerId] = {}))[item.id] = item },
      _owner(ownerId) { return byOwner[ownerId] || {} },
    }
  }

  beforeEach(() => {
    queue = undefined
    items = makeItems()
    lookup = () => ({ ok: false, error: 'LOOKUP_ERROR' }) // default: nothing resolves
  })

  it('enriches a queued item, clears the flag, and re-running is a no-op', async () => {
    queue = makeQueue()
    const id = 'item-1'
    items._seed('u1', mkItem(id, { label: null }))
    await queue.enqueue({ user_id: 'u1', kind: 'records', item_id: id, payload: { provider: 'discogs', key: 'k1' }, key: 'k1' })
    lookup = () => ({ ok: true, data: { label: 'Provider Label', genre: ['Rock'] } })

    const first = await drain({ queue, items, lookup }, { now: Date.now() })
    expect(first.enriched).toBe(1)
    const stored = items._owner('u1')[id]
    expect(stored.label).toBe('Provider Label')
    expect(stored.metadataPending).toBe(false)
    expect(stored.enrichedAt).toBeTruthy()

    // Re-run: the row is now done -> nothing to do -> no-op.
    const second = await drain({ queue, items, lookup }, { now: Date.now() })
    expect(second.processed).toBe(0)
    // Re-enriching the already-enriched item is idempotent (edit preserved).
    const re = await items.mergeEnriched('u1', 'records', id, { label: 'Different' })
    expect(re.label).toBe('Provider Label')
  })

  it('user edits survive the merge (only missing fields are filled)', async () => {
    queue = makeQueue()
    const id = 'item-2'
    items._seed('u1', mkItem(id, { title: 'My Edit', label: null }))
    await queue.enqueue({ user_id: 'u1', kind: 'records', item_id: id, payload: { key: 'k1' }, key: 'k1' })
    lookup = () => ({ ok: true, data: { title: 'Provider Title', label: 'Provider Label', year: 1984 } })
    await drain({ queue, items, lookup }, { now: Date.now() })
    const stored = items._owner('u1')[id]
    expect(stored.title).toBe('My Edit')      // user edit preserved
    expect(stored.label).toBe('Provider Label') // missing filled
    expect(stored.year).toBe(1984)
  })

  it('never crosses tenants: drain for user A leaves user B untouched', async () => {
    queue = makeQueue()
    const a = 'item-a'
    const b = 'item-b'
    items._seed('u1', mkItem(a))
    items._seed('u2', mkItem(b))
    await queue.enqueue({ user_id: 'u1', kind: 'records', item_id: a, payload: { key: 'ka' }, key: 'ka' })
    await queue.enqueue({ user_id: 'u2', kind: 'records', item_id: b, payload: { key: 'kb' }, key: 'kb' })
    // Distinct enrichment per tenant so we can detect any crossing.
    lookup = (row) => ({ ok: true, data: { label: row.payload?.key === 'kb' ? 'B-LABEL' : 'A-LABEL' } })

    await drain({ queue, items, lookup }, { now: Date.now() })
    // A's item got A's own enrichment, B's item got B's own enrichment —
    // each tenant's rows were merged only into that tenant's own item.
    expect(items._owner('u1')[a].label).toBe('A-LABEL')
    expect(items._owner('u2')[b].label).toBe('B-LABEL')
    // Cross-tenant leakage check: A's owner map must not contain B's item.
    expect(items._owner('u1')[b]).toBeUndefined()
    expect(items._owner('u2')[a]).toBeUndefined()
  })

  it('safeError integrity: failures become internal counters, never client payload', async () => {
    queue = makeQueue()
    const id = 'item-3'
    items._seed('u1', mkItem(id))
    await queue.enqueue({ user_id: 'u1', kind: 'records', item_id: id, payload: { key: 'k1' }, key: 'k1' })
    lookup = () => { throw new Error('SECRET_INTERNAL') }
    const summary = await drain({ queue, items, lookup }, { now: Date.now() })
    expect(summary.failed).toBe(1)
    // Nothing about the error surfaces in a client-readable shape (summary only).
    expect(Object.keys(summary).sort()).toEqual(['abandoned', 'enriched', 'failed', 'processed'])
  })

  it('abandons a permanent failure without an un-bounded retry', async () => {
    queue = makeQueue()
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'k1' }, key: 'k1' })
    lookup = () => ({ ok: false, permanent: true, error: 'UNKNOWN_PROVIDER' })
    const summary = await drain({ queue, items, lookup }, { now: Date.now() })
    expect(summary.failed).toBe(1)
    expect(summary.abandoned).toBe(1)
  })
})

describe('piggybackDrain + enqueuePartialSave — opportunistic wiring (T6, #285)', () => {
  function makeRepo(queue) {
    const rows = queue?._rows || {}
    return {
      lookupQueue: queue || null,
      items: null, // no merge repo -> the drained data itself counts as merged
      _rows: rows,
    }
  }

  it('enqueuePartialSave enqueues a barcode re-trigger for a partial item', async () => {
    const rows = {}
    const queue = { enqueue: async (e) => { rows[e.key] = e; return e.key } }
    const id = await enqueuePartialSave(queue, {
      user_id: 'u1', kind: 'records', item_id: 'item-1', barcode: '0123456789012', provider: 'discogs',
    })
    expect(id).toBe('barcode:0123456789012')
    expect(rows['barcode:0123456789012']).toMatchObject({
      user_id: 'u1', kind: 'records', item_id: 'item-1',
      payload: { provider: 'discogs', action: 'searchBarcode', barcode: '0123456789012' },
    })
  })

  it('piggybackDrain drains THIS tenant\'s due rows on a later successful lookup', async () => {
    const rows = {}
    const due = [{
      id: 'row-1', kind: 'records', item_id: 'item-1', attempts: 0,
      payload: { provider: 'discogs', key: 'barcode:0123456789012' },
    }]
    const queue = {
      _rows: rows,
      async listPendingUsers() { return ['u1'] },
      async claimDue() { return due },
      async markDone(userId, id) { rows[id] = { ...(rows[id] || {}), status: 'done' } },
      async markFailed() {},
    }
    const lookup = async () => ({ ok: true, data: { title: 'Completed', label: 'Label' } })
    const summary = await piggybackDrain(makeRepo(queue), lookup, { maxPerRun: 3 })
    expect(summary.processed).toBe(1)
    expect(summary.enriched).toBe(1)
    expect(rows['row-1'].status).toBe('done')
  })

  it('piggybackDrain is best-effort: a missing queue returns zeros without throwing', async () => {
    const summary = await piggybackDrain(makeRepo(null), async () => ({ ok: true, data: {} }))
    expect(summary).toEqual({ processed: 0, enriched: 0, failed: 0, abandoned: 0 })
  })
})
