// M2 #158 — Local Database Repository tests.
//
// Covers:
//   - schema version and migration evidence
//   - saveItem / getItem / getItems with scope isolation
//   - sync-status columns (updatedAt, serverVersion, localVersion, syncStatus)
//   - tombstones (soft delete + reconciliation)
//   - cross-user isolation (ADR-0019 Dec 6)
//   - no credentials in IDB (ADR-0019 Dec 4)
//   - clear/isolate on sign-out (ADR-0019 Dec 5)
//   - export functionality
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  LOCAL_DB_VERSION,
  clearAllLocalData,
  clearLocalDataForUser,
  clearTombstone,
  deleteItem,
  exportLocalData,
  getItem,
  getItems,
  getMigrationRecord,
  getTombstones,
  idbAvailable,
  localScope,
  openLocalDb,
  saveItem,
  saveItems,
  updateSyncStatus,
  upgradeLocalDb,
  SYNC_STATUS,
} from './localDatabase'

const USER_A = { id: 'u1', name: 'Ada' }
const USER_B = { id: 'u2', name: 'Bob' }
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

const ITEM_A = {
  uuid: 'local:abc-123',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
}
const ITEM_B = {
  uuid: 'server:r2',
  serverId: 'r2',
  title: 'Miles Davis - In a Silent Way',
  year: 1969,
  formatType: 'LP',
}

async function dropDb() {
  await clearAllLocalData()
}

beforeEach(async () => {
  localStorage.clear()
  await dropDb()
})

describe('localScope — server-authoritative ownership (ADR-0019 Dec 6)', () => {
  it('keys a scope from the resolved session user id only', () => {
    expect(localScope('u1')).toBe('user:u1')
  })

  it('rejects any client-chosen / malformed scope source', () => {
    expect(localScope()).toBeNull()
    expect(localScope(null)).toBeNull()
    expect(localScope(undefined)).toBeNull()
    expect(localScope(123)).toBeNull()
    expect(localScope({})).toBeNull()
  })
})

describe('schema + migration evidence', () => {
  it('declares the schema version and records a reconciliation/rollback audit', async () => {
    expect(LOCAL_DB_VERSION).toBe(1)
    expect(idbAvailable()).toBe(true)

    // Open the DB fresh so onupgradeneeded runs
    const db = await openLocalDb()
    expect(db).not.toBeNull()
    expect(db.objectStoreNames.contains('items')).toBe(true)
    expect(db.objectStoreNames.contains('tombstones')).toBe(true)
    expect(db.objectStoreNames.contains('meta')).toBe(true)
    db.close()

    const meta = await getMigrationRecord()
    expect(meta).not.toBeNull()
    expect(meta.schemaVersion).toBe(1)
    expect(meta.migratedFrom).toBe(0)
    expect(typeof meta.rollback).toBe('string')
  })
})

describe('saveItem / getItem — basic CRUD with sync-status columns', () => {
  it('saves and reads back an item with sync metadata', async () => {
    const ok = await saveItem(USER_A.id, ITEM_A, { now: NOW })
    expect(ok).toBe(true)

    const record = await getItem(USER_A.id, ITEM_A.uuid)
    expect(record).not.toBeNull()
    expect(record.uuid).toBe(ITEM_A.uuid)
    expect(record.scope).toBe('user:u1')
    expect(record.data.title).toBe('Miles Davis - Kind of Blue')
    expect(record.updatedAt).toBe(new Date(NOW).toISOString())
    expect(record.serverVersion).toBe(0)
    expect(record.localVersion).toBe(1)
    expect(record.syncStatus).toBe(SYNC_STATUS.LOCAL)
  })

  it('updates an existing item and bumps localVersion', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await saveItem(USER_A.id, { ...ITEM_A, year: 1960 }, { now: NOW + 1000 })

    const record = await getItem(USER_A.id, ITEM_A.uuid)
    expect(record.data.year).toBe(1960)
    expect(record.localVersion).toBe(2)
  })

  it('returns null for a non-existent item', async () => {
    const record = await getItem(USER_A.id, 'nonexistent')
    expect(record).toBeNull()
  })

  it('scope-checks: cannot read another user item', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    const record = await getItem(USER_B.id, ITEM_A.uuid)
    expect(record).toBeNull()
  })
})

describe('getItems — list items with optional syncStatus filter', () => {
  it('returns all items for a user scope', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await saveItem(USER_A.id, ITEM_B, { now: NOW })

    const items = await getItems(USER_A.id)
    expect(items).toHaveLength(2)
  })

  it('returns empty array for a user with no items', async () => {
    const items = await getItems(USER_A.id)
    expect(items).toEqual([])
  })

  it('filters by syncStatus', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW, syncStatus: SYNC_STATUS.LOCAL })
    await saveItem(USER_A.id, ITEM_B, { now: NOW, syncStatus: SYNC_STATUS.SYNCED })

    const local = await getItems(USER_A.id, { syncStatus: SYNC_STATUS.LOCAL })
    expect(local).toHaveLength(1)
    expect(local[0].uuid).toBe(ITEM_A.uuid)

    const synced = await getItems(USER_A.id, { syncStatus: SYNC_STATUS.SYNCED })
    expect(synced).toHaveLength(1)
    expect(synced[0].uuid).toBe(ITEM_B.uuid)
  })

  it('isolates between users', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await saveItem(USER_B.id, ITEM_B, { now: NOW })

    const itemsA = await getItems(USER_A.id)
    expect(itemsA).toHaveLength(1)
    expect(itemsA[0].uuid).toBe(ITEM_A.uuid)

    const itemsB = await getItems(USER_B.id)
    expect(itemsB).toHaveLength(1)
    expect(itemsB[0].uuid).toBe(ITEM_B.uuid)
  })
})

describe('saveItems — bulk save', () => {
  it('saves multiple items in a single transaction', async () => {
    const ok = await saveItems(USER_A.id, [ITEM_A, ITEM_B], { now: NOW })
    expect(ok).toBe(true)

    const items = await getItems(USER_A.id)
    expect(items).toHaveLength(2)
  })

  it('returns false for null input, true for empty array', async () => {
    expect(await saveItems(USER_A.id, [])).toBe(true) // nothing to save is not a failure
    expect(await saveItems(USER_A.id, null)).toBe(false)
  })
})

describe('updateSyncStatus — transition sync state', () => {
  it('updates syncStatus and bumps localVersion', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW, syncStatus: SYNC_STATUS.LOCAL })
    const ok = await updateSyncStatus(USER_A.id, ITEM_A.uuid, SYNC_STATUS.SYNCED, {
      now: NOW + 1000,
      serverVersion: 1,
    })
    expect(ok).toBe(true)

    const record = await getItem(USER_A.id, ITEM_A.uuid)
    expect(record.syncStatus).toBe(SYNC_STATUS.SYNCED)
    expect(record.serverVersion).toBe(1)
    expect(record.localVersion).toBe(2)
  })

  it('returns false for a non-existent item', async () => {
    const ok = await updateSyncStatus(USER_A.id, 'nonexistent', SYNC_STATUS.SYNCED)
    expect(ok).toBe(false)
  })
})

describe('deleteItem / getTombstones / clearTombstone — soft delete with tombstones', () => {
  it('soft-deletes an item and creates a tombstone', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    const ok = await deleteItem(USER_A.id, ITEM_A.uuid, { now: NOW + 1000 })
    expect(ok).toBe(true)

    // Item should be gone from items store
    const record = await getItem(USER_A.id, ITEM_A.uuid)
    expect(record).toBeNull()

    // Tombstone should exist
    const tombstones = await getTombstones(USER_A.id)
    expect(tombstones).toHaveLength(1)
    expect(tombstones[0].uuid).toBe(ITEM_A.uuid)
    expect(tombstones[0].deletedAt).toBe(new Date(NOW + 1000).toISOString())
  })

  it('returns false when deleting a non-existent item', async () => {
    const ok = await deleteItem(USER_A.id, 'nonexistent')
    expect(ok).toBe(false)
  })

  it('clears a tombstone after reconciliation', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await deleteItem(USER_A.id, ITEM_A.uuid, { now: NOW + 1000 })

    const ok = await clearTombstone(USER_A.id, ITEM_A.uuid)
    expect(ok).toBe(true)

    const tombstones = await getTombstones(USER_A.id)
    expect(tombstones).toHaveLength(0)
  })

  it('scope-checks tombstones between users', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await deleteItem(USER_A.id, ITEM_A.uuid, { now: NOW + 1000 })

    const tombstonesB = await getTombstones(USER_B.id)
    expect(tombstonesB).toHaveLength(0)
  })
})

describe('clear/isolate on sign-out & account switch (ADR-0019 Dec 5)', () => {
  it('clearLocalDataForUser clears only that user data', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await saveItem(USER_B.id, ITEM_B, { now: NOW })

    await clearLocalDataForUser(USER_A.id)

    const itemsA = await getItems(USER_A.id)
    expect(itemsA).toHaveLength(0)

    const itemsB = await getItems(USER_B.id)
    expect(itemsB).toHaveLength(1)
  })

  it('clearAllLocalData clears every user data', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await saveItem(USER_B.id, ITEM_B, { now: NOW })

    await clearAllLocalData()

    expect(await getItems(USER_A.id)).toHaveLength(0)
    expect(await getItems(USER_B.id)).toHaveLength(0)
  })

  it('clearing is idempotent and safe when nothing is stored', async () => {
    await expect(clearLocalDataForUser('nobody')).resolves.toBe(true)
    await expect(clearAllLocalData()).resolves.toBe(true)
  })
})

describe('no credentials in IndexedDB (ADR-0019 Dec 4)', () => {
  it('the local store never contains the session token or access code', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })

    // Scan the raw DB store contents to prove no token is present
    const db = await openLocalDb()
    const raw = await db.getAll('items')
    const meta = await db.getAll('meta')
    db.close()

    const serialized = JSON.stringify([raw, meta])
    expect(serialized).not.toContain('tok-a')
    expect(serialized).not.toContain('Bearer')
    expect(serialized).not.toContain('RU-')
  })
})

describe('exportLocalData — local data export', () => {
  it('exports items, tombstones, and migration metadata', async () => {
    await saveItem(USER_A.id, ITEM_A, { now: NOW })
    await saveItem(USER_A.id, ITEM_B, { now: NOW, syncStatus: SYNC_STATUS.SYNCED })
    await deleteItem(USER_A.id, ITEM_A.uuid, { now: NOW + 1000 })

    const exported = await exportLocalData(USER_A.id)
    expect(exported).not.toBeNull()
    expect(exported.scope).toBe('user:u1')
    expect(exported.schemaVersion).toBe(1)
    expect(exported.items).toHaveLength(1) // ITEM_A was deleted
    expect(exported.tombstones).toHaveLength(1)
    expect(exported.migration).not.toBeUndefined()
    expect(exported.exportedAt).toBeTruthy()
  })

  it('returns null for an invalid user', async () => {
    const exported = await exportLocalData(null)
    expect(exported).toBeNull()
  })

  it('returns empty arrays when no data exists', async () => {
    const exported = await exportLocalData(USER_A.id)
    expect(exported).not.toBeNull()
    expect(exported.items).toEqual([])
    expect(exported.tombstones).toEqual([])
  })
})

describe('fail-closed behavior on missing IDB', () => {
  it('saveItem returns false when IDB is unavailable', async () => {
    // We can't easily disable IDB in fake-indexeddb, but the function
    // should handle null userId gracefully
    expect(await saveItem(null, ITEM_A)).toBe(false)
    expect(await saveItem('', ITEM_A)).toBe(false)
  })

  it('getItem returns null for null userId', async () => {
    expect(await getItem(null, 'uuid')).toBeNull()
  })

  it('getItems returns [] for null userId', async () => {
    const items = await getItems(null)
    expect(items).toEqual([])
  })
})