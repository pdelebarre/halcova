// M3 #161 — Tombstone Retention tests (ADR-0019 Dec 8).
//
// Covers:
//   - isTombstoneSafeToClear: safety conditions
//   - pruneSafeTombstones: prune tombstones that are safe to clear
//   - countRetainedTombstones: count of retained tombstones
//   - adversarial: old tombstones cleared, recent tombstones retained

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MIN_TOMBSTONE_RETENTION_MS,
  isTombstoneSafeToClear,
  pruneSafeTombstones,
  countRetainedTombstones,
} from './tombstoneRetention'

// Mock localDatabase
vi.mock('../repositories/localDatabase', () => ({
  getTombstones: vi.fn(),
  clearTombstone: vi.fn(),
}))

import { getTombstones, clearTombstone } from '../repositories/localDatabase'

const USER_ID = 'u1'
const NOW = Date.now()
const OLD_TIMESTAMP = new Date(NOW - MIN_TOMBSTONE_RETENTION_MS - 1000).toISOString()
const RECENT_TIMESTAMP = new Date(NOW - 1000).toISOString() // 1 second ago

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// isTombstoneSafeToClear
// ---------------------------------------------------------------------------

describe('isTombstoneSafeToClear', () => {
  it('returns true for tombstones older than retention period', () => {
    const tombstone = { uuid: 'server:r1', deletedAt: OLD_TIMESTAMP }
    expect(isTombstoneSafeToClear(tombstone, NOW)).toBe(true)
  })

  it('returns false for recent tombstones', () => {
    const tombstone = { uuid: 'server:r1', deletedAt: RECENT_TIMESTAMP }
    expect(isTombstoneSafeToClear(tombstone, NOW)).toBe(false)
  })

  it('returns false for null tombstone', () => {
    expect(isTombstoneSafeToClear(null, NOW)).toBe(false)
  })

  it('returns false for tombstone without deletedAt', () => {
    expect(isTombstoneSafeToClear({ uuid: 'x' }, NOW)).toBe(false)
  })

  it('returns false for tombstone with invalid date', () => {
    const tombstone = { uuid: 'x', deletedAt: 'not-a-date' }
    expect(isTombstoneSafeToClear(tombstone, NOW)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pruneSafeTombstones
// ---------------------------------------------------------------------------

describe('pruneSafeTombstones', () => {
  it('prunes old tombstones and returns count', async () => {
    getTombstones.mockResolvedValue([
      { uuid: 'old-1', deletedAt: OLD_TIMESTAMP },
      { uuid: 'old-2', deletedAt: OLD_TIMESTAMP },
      { uuid: 'recent', deletedAt: RECENT_TIMESTAMP },
    ])
    clearTombstone.mockResolvedValue(true)

    const cleared = await pruneSafeTombstones(USER_ID, NOW)
    expect(cleared).toBe(2)
    expect(clearTombstone).toHaveBeenCalledTimes(2)
    expect(clearTombstone).toHaveBeenCalledWith(USER_ID, 'old-1')
    expect(clearTombstone).toHaveBeenCalledWith(USER_ID, 'old-2')
  })

  it('returns 0 when no tombstones exist', async () => {
    getTombstones.mockResolvedValue([])
    expect(await pruneSafeTombstones(USER_ID, NOW)).toBe(0)
  })

  it('returns 0 when no tombstones are safe to clear', async () => {
    getTombstones.mockResolvedValue([
      { uuid: 'recent', deletedAt: RECENT_TIMESTAMP },
    ])
    expect(await pruneSafeTombstones(USER_ID, NOW)).toBe(0)
  })

  it('returns 0 for null userId', async () => {
    expect(await pruneSafeTombstones(null, NOW)).toBe(0)
  })

  it('handles clearTombstone failures gracefully', async () => {
    getTombstones.mockResolvedValue([
      { uuid: 'old', deletedAt: OLD_TIMESTAMP },
    ])
    clearTombstone.mockResolvedValue(false)

    const cleared = await pruneSafeTombstones(USER_ID, NOW)
    expect(cleared).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// countRetainedTombstones
// ---------------------------------------------------------------------------

describe('countRetainedTombstones', () => {
  it('returns count of tombstones', async () => {
    getTombstones.mockResolvedValue([
      { uuid: 'a' },
      { uuid: 'b' },
    ])
    expect(await countRetainedTombstones(USER_ID)).toBe(2)
  })

  it('returns 0 when no tombstones', async () => {
    getTombstones.mockResolvedValue([])
    expect(await countRetainedTombstones(USER_ID)).toBe(0)
  })

  it('returns 0 for null userId', async () => {
    expect(await countRetainedTombstones(null)).toBe(0)
  })
})