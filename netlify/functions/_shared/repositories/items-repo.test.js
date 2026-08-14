// @vitest-environment node
//
// Items repository tests against pg-mem (in-memory Postgres) with the REAL
// migration applied — so these double as a migration-validity check. Covers
// the Phase 1 itemsRepo surface: CRUD + exact client-shape round-trip,
// date_added ordering, SQL pagination, the SQL owned-count (wishlist excluded),
// per-owner isolation, idempotent insert/delete, and the BEGIN/COMMIT/ROLLBACK
// transaction helper (rollback via a mocked pg client, since pg-mem can't span
// a transaction across separate statements).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createItemsRepo } from './items-repo'
import { createMemDb } from './test-helpers'

const OWNER = 'owner'
const KIND = 'records'

const ITEM = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Pink Floyd - The Dark Side of the Moon',
  year: 1973,
  label: 'Harvest',
  catno: 'SHVL 804',
  formatRaw: 'LP, Album',
  formatType: 'LP',
  genre: ['Rock', 'Progressive Rock'],
  style: ['Psychedelic Rock'],
  country: 'UK',
  coverImage: 'https://example.com/dark-side.png',
  barcode: '0077774602129',
  discogsId: 372469,
  dateAdded: '2026-08-02T09:00:00.000Z',
  notes: 'original pressing',
  wishlist: false,
  lending: { borrower: { name: 'Ada' }, lentOn: '2026-08-10T00:00:00.000Z' },
  lendingHistory: [],
}

const BOOK = {
  id: '22222222-2222-2222-2222-222222222222',
  title: 'George Orwell - 1984',
  year: 1949,
  label: 'Secker & Warburg',
  isbn: '9780452284234',
  formatType: '',
  genre: ['Fiction'],
  style: [],
  country: '',
  coverImage: 'https://example.com/1984.png',
  barcode: '9780452284234',
  googleBooksId: 'k5hUDwAAQBAJ',
  infoLink: 'https://openlibrary.org/isbn/9780452284234',
  description: 'Winston Smith…',
  pageCount: 328,
  dateAdded: '2026-08-01T09:00:00.000Z',
}

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createItemsRepo(db)
})

describe('insertItem / getItem — exact client-shape round-trip', () => {
  it('stores and returns the very item object the client wrote (records shape)', async () => {
    await repo.insertItem(OWNER, KIND, ITEM)
    expect(await repo.getItem(OWNER, KIND, ITEM.id)).toEqual(ITEM)
  })

  it('round-trips the books shape (isbn, googleBooksId, pageCount, description)', async () => {
    await repo.insertItem(OWNER, 'books', BOOK)
    expect(await repo.getItem(OWNER, 'books', BOOK.id)).toEqual(BOOK)
  })

  it('returns null for a missing item and for a different owner (isolation)', async () => {
    await repo.insertItem(OWNER, KIND, ITEM)
    expect(await repo.getItem(OWNER, KIND, 'missing')).toBeNull()
    expect(await repo.getItem('someone-else', KIND, ITEM.id)).toBeNull()
  })

  it('treats a re-insert of the same id as a no-op (idempotent, ON CONFLICT DO NOTHING)', async () => {
    await repo.insertItem(OWNER, KIND, ITEM)
    await repo.insertItem(OWNER, KIND, { ...ITEM, title: 'Changed - Title' })
    expect(await repo.getItem(OWNER, KIND, ITEM.id)).toEqual(ITEM) // first write wins
  })
})

describe('listItems — ordering + SQL pagination (Phase 0 pagination.js semantics)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  async function seedOrdered() {
    // dateAdded ascending by suffix so the repo must return newest-first.
    for (let i = 0; i < ids.length; i += 1) {
      await repo.insertItem(OWNER, KIND, {
        id: `00000000-0000-0000-0000-${i}0000000000${i}`,
        title: `Title ${ids[i]}`,
        year: 2000 + i,
        dateAdded: `2026-01-0${i + 1}T00:00:00.000Z`,
      })
    }
  }

  it('returns items newest-first by date_added', async () => {
    await seedOrdered()
    const items = await repo.listItems(OWNER, KIND)
    expect(items.map((i) => i.title)).toEqual(['Title e', 'Title d', 'Title c', 'Title b', 'Title a'])
  })

  it('applies limit/offset (default limit high so the unpaginated client is unchanged)', async () => {
    await seedOrdered()
    const page = await repo.listItems(OWNER, KIND, { limit: 2, offset: 1 })
    expect(page.map((i) => i.title)).toEqual(['Title d', 'Title c'])
  })

  it('scopes by owner and kind', async () => {
    await seedOrdered()
    expect(await repo.listItems('other', KIND)).toEqual([])
    expect(await repo.listItems(OWNER, 'books')).toEqual([])
  })
})

describe('countOwned — SQL count, wishlist excluded (the plan cap)', () => {
  it('counts owned (non-wishlist) items only', async () => {
    await repo.insertItem(OWNER, KIND, { ...ITEM, wishlist: false })
    await repo.insertItem(OWNER, KIND, { ...ITEM, id: '33333333-3333-3333-3333-333333333333', wishlist: true })
    await repo.insertItem(OWNER, KIND, { ...ITEM, id: '44444444-4444-4444-4444-444444444444' })
    expect(await repo.countOwned(OWNER, KIND)).toBe(2)
  })

  it('is per-owner and per-kind', async () => {
    await repo.insertItem(OWNER, KIND, ITEM)
    expect(await repo.countOwned('other', KIND)).toBe(0)
    expect(await repo.countOwned(OWNER, 'books')).toBe(0)
  })
})

describe('updateItem / deleteItem', () => {
  it('replaces the item and preserves the shape', async () => {
    await repo.insertItem(OWNER, KIND, ITEM)
    const updated = { ...ITEM, notes: 'reissue', wishlist: true }
    expect(await repo.updateItem(OWNER, KIND, ITEM.id, updated)).toEqual(updated)
    expect(await repo.getItem(OWNER, KIND, ITEM.id)).toEqual(updated)
  })

  it('returns null (not found) when updating a missing item', async () => {
    expect(await repo.updateItem(OWNER, KIND, ITEM.id, ITEM)).toBeNull()
  })

  it('deletes idempotently and only within the owner scope', async () => {
    await repo.insertItem(OWNER, KIND, ITEM)
    expect(await repo.deleteItem(OWNER, KIND, ITEM.id)).toBe(true)
    expect(await repo.deleteItem(OWNER, KIND, ITEM.id)).toBe(false) // already gone
    expect(await repo.getItem(OWNER, KIND, ITEM.id)).toBeNull()
  })

  it('deleteAllForOwner removes every kind for a member (user delete)', async () => {
    await repo.insertItem('u1', 'records', ITEM)
    await repo.insertItem('u1', 'books', BOOK)
    await repo.insertItem(OWNER, KIND, { ...ITEM, id: '66666666-6666-6666-6666-666666666666' })
    await repo.deleteAllForOwner('u1')
    expect(await repo.listItems('u1', 'records')).toEqual([])
    expect(await repo.listItems('u1', 'books')).toEqual([])
    expect(await repo.listItems(OWNER, KIND)).toHaveLength(1)
  })
})

describe('transaction — BEGIN/COMMIT/ROLLBACK', () => {
  it('commits the writes inside the callback atomically (pg-mem happy path)', async () => {
    await repo.transaction(async (tx) => {
      await tx.insertItem(OWNER, KIND, ITEM)
      await tx.insertItem(OWNER, KIND, { ...ITEM, id: '55555555-5555-5555-5555-555555555555' })
    })
    expect(await repo.listItems(OWNER, KIND)).toHaveLength(2)
  })

  it('issues BEGIN -> fn -> COMMIT and always releases the client', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createItemsRepo(memDb)
    const fn = vi.fn()

    await txRepo.transaction(fn)

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT'])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('issues BEGIN -> fn -> ROLLBACK and rethrows on error', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const memDb = { query: vi.fn(), connect: vi.fn(async () => client) }
    const txRepo = createItemsRepo(memDb)
    const boom = new Error('boom')
    const fn = vi.fn(async () => { throw boom })

    await expect(txRepo.transaction(fn)).rejects.toThrow('boom')

    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
