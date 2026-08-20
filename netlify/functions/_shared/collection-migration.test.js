// @vitest-environment node
//
// FEAT-6.3 #316 — migration tooling tests (netlify/_shared/collection-migration
// .js): backfill of the legacy `items` table onto the generic collection model,
// the mandatory reconciliation counts (zero unexplained loss / duplication /
// ownership change), and the reverse-mapping rollback. Runs against pg-mem with
// the REAL migration SQL applied (db/migrations/001..012), seeded with
// representative legacy items. The migration ADD path never deletes/rewrites
// `items`; rollback regenerates the legacy envelope from the new model.

import { describe, expect, it } from 'vitest'
import { createMemDb } from './repositories/test-helpers'
import {
  backfill,
  reconcile,
  rollback,
  deterministicUuid,
  contentFingerprint,
} from './collection-migration'

const U1 = '11111111-1111-1111-1111-111111111111'
const U2 = '22222222-2222-2222-2222-222222222222'

async function seedItem(db, { id, owner, kind = 'records', data }) {
  const item = { id, ...(data || {}) }
  await db.query(
    `INSERT INTO items (id, owner_id, kind, data, title, year, wishlist)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, owner, kind, JSON.stringify(item), item.title || '', item.year ?? null, item.wishlist === true],
  )
}

const ID = (n) => `${n}0000000-0000-0000-0000-000000000000`

describe('collection migration backfill + reconcile (#316)', () => {
  it('is idempotent and reconciles with zero loss / duplication / ownership change', async () => {
    const db = await createMemDb()
    await seedItem(db, { id: ID('a'), owner: U1, kind: 'records', data: {
      title: 'Kind of Blue', year: 1959, label: 'Columbia', genre: ['Jazz'],
      discogsId: 42, wishlist: false, coverImage: 'https://c/x.jpg', notes: 'mint',
    } })
    await seedItem(db, { id: ID('b'), owner: U2, kind: 'books', data: {
      title: 'The Hobbit', googleBooksId: 'gb1', isbn: '978-0-00',
      pageCount: 310, wishlist: true, notes: 'want',
    } })
    await seedItem(db, { id: ID('c'), owner: U1, kind: 'books', data: {
      title: 'The Hobbit', googleBooksId: 'gb1', wishlist: true,
    } })

    await backfill(db)
    // Idempotency: a second backfill is a no-op (no new rows).
    await backfill(db)

    const r = await reconcile(db)
    expect(r.pass).toBe(true)
    expect(r.sourceItems).toBe(3)
    expect(r.collectionItems).toBe(3)
    expect(r.sourceOwners).toBe(3)
    expect(r.collections).toBe(3)
    expect(r.loss).toBe(0)
    expect(r.duplication).toBe(0)
    expect(r.ownershipChange).toBe(0)
    expect(r.unidentified).toBe(0)
  })

  it('dedups a duplicated canonical work per provider id, keeping one CollectionItem per owner', async () => {
    const db = await createMemDb()
    await seedItem(db, { id: ID('a'), owner: U1, kind: 'records', data: { title: 'X', discogsId: 99 } })
    await seedItem(db, { id: ID('b'), owner: U2, kind: 'records', data: { title: 'X', discogsId: 99 } })

    await backfill(db)
    const canon = await db.query('SELECT count(*)::int AS c FROM canonical_items')
    const items = await db.query('SELECT count(*)::int AS c FROM collection_items')
    expect(canon.rows[0].c).toBe(1)   // one shared canonical
    expect(items.rows[0].c).toBe(2)   // two owned copies

    const r = await reconcile(db)
    expect(r.pass).toBe(true)
  })

  it('rejects a legacy kind that is not a registered collection type (FK guard)', async () => {
    const db = await createMemDb()
    await seedItem(db, { id: ID('a'), owner: U1, kind: 'games', data: { title: 'Chess' } })
    await expect(backfill(db)).rejects.toThrow()
  })
})

describe('rollback (reverse mapping) #316', () => {
  it('regenerates the legacy items envelope from the new model after legacy loss', async () => {
    const db = await createMemDb()
    const id = ID('a')
    await seedItem(db, { id, owner: U1, kind: 'records', data: {
      title: 'Kind of Blue', year: 1959, label: 'Columbia', genre: ['Jazz'],
      discogsId: 12345, wishlist: true, notes: 'mint',
    } })
    await backfill(db)

    // Simulate the legacy envelope being lost for that row, then roll back the
    // new model to regenerate it (reverse mapping — ADR-0020 §11).
    await db.query('DELETE FROM items WHERE id = $1', [id])
    expect((await db.query('SELECT count(*)::int AS c FROM items')).rows[0].c).toBe(0)

    const rb = await rollback(db)
    expect(rb.restored).toBe(1)

    const after = await db.query('SELECT data, owner_id, kind FROM items WHERE id = $1', [id])
    expect(after.rows[0].owner_id).toBe(U1)             // ownership preserved
    expect(after.rows[0].kind).toBe('records')
    const item = after.rows[0].data
    expect(item.title).toBe('Kind of Blue')
    expect(item.year).toBe(1959)
    expect(item.label).toBe('Columbia')
    expect(item.discogsId).toBe(12345)                  // provider id preserved
    expect(item.genre).toEqual(['Jazz'])
    expect(item.notes).toBe('mint')                     // owned state preserved
    expect(item.wishlist).toBe(true)                    // flag preserved

    // Idempotent reverse mapping: a second rollback creates no duplicate.
    await rollback(db)
    expect((await db.query('SELECT count(*)::int AS c FROM items')).rows[0].c).toBe(1)
  })
})

describe('id helpers #316', () => {
  it('produces deterministic server-assigned ids and stable fingerprints', () => {
    expect(deterministicUuid('collection:u1:records')).toMatch(/^[0-9a-f]{8}-/)
    expect(deterministicUuid('collection:u1:records')).toBe(deterministicUuid('collection:u1:records'))
    expect(deterministicUuid('a')).not.toBe(deterministicUuid('b'))
    // Fingerprint is order-independent over the canonical fields.
    expect(
      contentFingerprint({ title: 'X', discogsId: 1 }, 'records'),
    ).toBe(contentFingerprint({ discogsId: 1, title: 'X' }, 'records'))
  })
})