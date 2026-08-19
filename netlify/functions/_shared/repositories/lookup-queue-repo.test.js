// @vitest-environment node
//
// lookup_queue Postgres repo tests (T6, #285) against pg-mem: the enqueue
// upsert (idempotency by stable row id), per-tenant claimDue scoping
// (a drain for user A can never see user B's rows), markDone / markFailed /
// abandon, and the distinct-tenant scan. Mirrors the lookup-cache-repo test
// pattern.

import { beforeEach, describe, expect, it } from 'vitest'
import { createLookupQueueRepo } from './lookup-queue-repo'
import { createMemDb } from './test-helpers'
import { createItemsRepo } from './items-repo'

let db
let queue

beforeEach(async () => {
  db = await createMemDb()
  queue = createLookupQueueRepo(db)
})

describe('lookup queue — enqueue (idempotent by stable row id)', () => {
  it('enqueues a row and makes it claimable', async () => {
    await queue.enqueue({
      user_id: 'u1', kind: 'records', item_id: '11111111-1111-4111-8111-111111111111',
      payload: { provider: 'discogs', action: 'barcode', key: 'barcode:123' }, key: 'barcode:123',
    })
    const due = await queue.claimDue('u1', 10)
    expect(due).toHaveLength(1)
    expect(due[0].kind).toBe('records')
    expect(due[0].payload.key).toBe('barcode:123')
  })

  it('re-enqueueing the same lookup+item is a no-op (upsert, no duplicate)', async () => {
    const entry = {
      user_id: 'u1', kind: 'records', item_id: null,
      payload: { provider: 'discogs', key: 'barcode:456' }, key: 'barcode:456',
    }
    await queue.enqueue(entry)
    await queue.enqueue(entry)
    await queue.enqueue(entry)
    expect(await queue.claimDue('u1', 10)).toHaveLength(1)
  })

  it('a distinct lookup key enqueues a separate row', async () => {
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'barcode:1' }, key: 'barcode:1' })
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'barcode:2' }, key: 'barcode:2' })
    expect(await queue.claimDue('u1', 10)).toHaveLength(2)
  })
})

describe('lookup queue — per-tenant isolation (drain for A never touches B)', () => {
  it('claimDue(userId) returns ONLY that tenant\u2019s rows', async () => {
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'k1' }, key: 'k1' })
    await queue.enqueue({ user_id: 'u2', kind: 'books', payload: { key: 'k2' }, key: 'k2' })
    const a = await queue.claimDue('u1', 10)
    const b = await queue.claimDue('u2', 10)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].payload.key).toBe('k1')
    expect(b[0].payload.key).toBe('k2')
  })

  it('markDone / markFailed for user A cannot mutate user B\u2019s row', async () => {
    await queue.enqueue({ user_id: 'u2', kind: 'records', payload: { key: 'k' }, key: 'k' })
    const bRow = (await queue.claimDue('u2', 10))[0]
    // User A tries to complete user B's row id.
    await queue.markDone('u1', bRow.id)
    // User B's row is untouched and still pending/claimable.
    expect((await queue.claimDue('u2', 10))[0].id).toBe(bRow.id)
  })

  it('enqueueing for user A never creates a row visible under user B', async () => {
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'a' }, key: 'a' })
    expect(await queue.countPending('u2')).toBe(0)
    expect(await queue.countPending('u1')).toBe(1)
  })
})

describe('lookup queue — lifecycle (done / back-off / abandon)', () => {
  it('markDone removes the row from the pending claim set', async () => {
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'k' }, key: 'k' })
    const row = (await queue.claimDue('u1', 10))[0]
    await queue.markDone('u1', row.id)
    expect(await queue.claimDue('u1', 10)).toHaveLength(0)
    expect(await queue.countPending('u1')).toBe(0)
  })

  it('markFailed bumps attempts and advances next_at; abandon flips to abandoned', async () => {
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'k' }, key: 'k' })
    const row = (await queue.claimDue('u1', 10))[0]
    const later = new Date(Date.now() + 3600_000)
    await queue.markFailed('u1', row.id, { nextAt: later, error: 'HTTP_502' })
    // Not due again until next_at passes.
    expect(await queue.claimDue('u1', 10)).toHaveLength(0)
    // Abandon it.
    await queue.markFailed('u1', row.id, { nextAt: later, abandon: true, error: 'HTTP_502' })
    expect(await queue.countPending('u1')).toBe(0)
  })

  it('exposes the distinct tenants with pending work', async () => {
    await queue.enqueue({ user_id: 'u1', kind: 'records', payload: { key: 'a' }, key: 'a' })
    await queue.enqueue({ user_id: 'u2', kind: 'books', payload: { key: 'b' }, key: 'b' })
    const users = await queue.listPendingUsers()
    expect(users.sort()).toEqual(['u1', 'u2'])
  })
})

describe('lookup queue drain — idempotent merge into items (postgres)', () => {
  it('merges only missing fields, keeps user edits, stamps enrichedAt + clears metadataPending', async () => {
    const items = createItemsRepo(db)
    const id = '11111111-1111-4111-8111-111111111111'
    const userItem = {
      id, title: 'My Edited Title', year: 1999, genre: ['Rock'],
      coverImage: 'my-cover', metadataPending: true, dateAdded: new Date().toISOString(),
      barcode: '0123456789012',
    }
    await items.insertItem('u1', 'records', userItem)

    await queue.enqueue({ user_id: 'u1', kind: 'records', item_id: id, payload: { key: 'barcode:0123456789012' }, key: 'barcode:0123456789012' })
    const row = (await queue.claimDue('u1', 10))[0]
    const fetched = {
      title: 'Provider Title', // user has one -> NOT filled
      year: 2001,              // user has 1999 -> NOT filled
      label: 'Provider Label', // missing -> filled
      genre: ['Jazz', 'Blues'],
      country: 'US',
      formatType: 'LP',
    }
    const merged = await items.mergeEnriched('u1', 'records', id, fetched)
    expect(merged.title).toBe('My Edited Title') // user edit survives
    expect(merged.year).toBe(1999)               // user value survives
    expect(merged.label).toBe('Provider Label')  // missing field filled
    expect(merged.genre).toEqual(['Rock'])       // user array survives
    expect(merged.country).toBe('US')
    expect(merged.formatType).toBe('LP')
    expect(merged.metadataPending).toBe(false)   // flag cleared
    expect(merged.enrichedAt).toBeTruthy()       // stamped

    await queue.markDone('u1', row.id)
    expect(await queue.countPending('u1')).toBe(0)
  })

  it('mergeEnriched is a no-op when the item does not belong to the tenant', async () => {
    const items = createItemsRepo(db)
    const id = '11111111-1111-4111-8111-111111111111'
    await items.insertItem('u2', 'records', { id, title: 'B', metadataPending: true, dateAdded: new Date().toISOString() })
    // User A tries to merge into user B's item -> no row, null.
    expect(await items.mergeEnriched('u1', 'records', id, { label: 'X' })).toBeNull()
  })
})
