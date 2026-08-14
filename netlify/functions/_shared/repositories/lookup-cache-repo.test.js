// @vitest-environment node
//
// lookup_cache repository tests against pg-mem: the (provider, key) upsert with
// a real expires_at TTL that replaces the Blobs `{ ts, data }` age checks in
// discogs.js / books.js. Part A exposes + tests the repo; the functions keep
// using Blobs until Part B flips them over.

import { beforeEach, describe, expect, it } from 'vitest'
import { createLookupCacheRepo } from './lookup-cache-repo'
import { createMemDb } from './test-helpers'

const MINUTE = 60 * 1000

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createLookupCacheRepo(db)
})

describe('lookup cache get/set with TTL', () => {
  it('returns the payload while unexpired and null after the TTL passes', async () => {
    await repo.set('discogs', 'barcode:123', { results: [{ id: 1 }] }, new Date(Date.now() + 30 * MINUTE))
    expect(await repo.get('discogs', 'barcode:123')).toEqual({ results: [{ id: 1 }] })

    // An already-expired entry is a miss.
    await repo.set('discogs', 'expired', { nope: true }, new Date(Date.now() - MINUTE))
    expect(await repo.get('discogs', 'expired')).toBeNull()
  })

  it('is scoped by provider and key', async () => {
    await repo.set('discogs', 'q', { from: 'discogs' }, new Date(Date.now() + MINUTE))
    await repo.set('books', 'q', { from: 'books' }, new Date(Date.now() + MINUTE))
    expect(await repo.get('discogs', 'q')).toEqual({ from: 'discogs' })
    expect(await repo.get('books', 'q')).toEqual({ from: 'books' })
    expect(await repo.get('discogs', 'missing')).toBeNull()
  })

  it('upserts on a repeated set (fresh entry replaces the old)', async () => {
    await repo.set('discogs', 'q', { v: 1 }, new Date(Date.now() + MINUTE))
    await repo.set('discogs', 'q', { v: 2 }, new Date(Date.now() + 2 * MINUTE))
    expect(await repo.get('discogs', 'q')).toEqual({ v: 2 })
  })

  it('accepts an ISO/ms expiry as well as a Date', async () => {
    await repo.set('discogs', 'a', { v: 1 }, Date.now() + MINUTE)
    await repo.set('discogs', 'b', { v: 2 }, new Date(Date.now() + MINUTE).toISOString())
    expect(await repo.get('discogs', 'a')).toEqual({ v: 1 })
    expect(await repo.get('discogs', 'b')).toEqual({ v: 2 })
  })

  it('rejects a set with no valid expiry', async () => {
    await expect(repo.set('discogs', 'x', {}, undefined)).rejects.toThrow(/expiresAt/)
    await expect(repo.set('discogs', 'x', {}, 'not-a-date')).rejects.toThrow(/expiresAt/)
  })
})
