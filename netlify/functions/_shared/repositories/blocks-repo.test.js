// blocks-repo.test.js — unit tests for the Postgres blocks repository
// (FEAT-8.5, #330). Uses pg-mem for an in-memory Postgres emulator.

import { describe, it, expect, beforeAll } from 'vitest'
import newDb from 'pg-mem'
import { createBlocksRepo } from './blocks-repo'

const MIGRATION_SQL = `
CREATE TABLE blocks (
  id          uuid PRIMARY KEY,
  blocker_id  text NOT NULL,
  blocked_id  text NOT NULL,
  reason      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocker_idx ON blocks (blocker_id);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);
`

function createTestDb() {
  const db = newDb().adapters.pg()
  db.query(MIGRATION_SQL)
  return db
}

describe('blocks-repo', () => {
  let db
  let repo

  beforeAll(() => {
    db = createTestDb()
    repo = createBlocksRepo(db)
  })

  describe('createBlock', () => {
    it('creates a block between two users', async () => {
      const block = await repo.createBlock('user-a', 'user-b', 'Spam')
      expect(block).not.toBeNull()
      expect(block.blockerId).toBe('user-a')
      expect(block.blockedId).toBe('user-b')
      expect(block.reason).toBe('Spam')
    })

    it('returns null when blocking yourself', async () => {
      const block = await repo.createBlock('user-a', 'user-a')
      expect(block).toBeNull()
    })

    it('returns null for empty ids', async () => {
      const block = await repo.createBlock('', 'user-b')
      expect(block).toBeNull()
    })

    it('upserts on duplicate (idempotent)', async () => {
      await repo.createBlock('user-x', 'user-y', 'First')
      const block = await repo.createBlock('user-x', 'user-y', 'Updated')
      expect(block).not.toBeNull()
      expect(block.blockerId).toBe('user-x')
      expect(block.blockedId).toBe('user-y')
      expect(block.reason).toBe('Updated')
    })
  })

  describe('getBlock', () => {
    it('returns the block when it exists', async () => {
      await repo.createBlock('user-a', 'user-c')
      const block = await repo.getBlock('user-a', 'user-c')
      expect(block).not.toBeNull()
      expect(block.blockedId).toBe('user-c')
    })

    it('returns null when no block exists', async () => {
      const block = await repo.getBlock('user-a', 'nonexistent')
      expect(block).toBeNull()
    })
  })

  describe('isBlocked', () => {
    it('returns true when a block exists', async () => {
      await repo.createBlock('user-a', 'user-d')
      const blocked = await repo.isBlocked('user-a', 'user-d')
      expect(blocked).toBe(true)
    })

    it('returns false when no block exists', async () => {
      const blocked = await repo.isBlocked('user-a', 'nonexistent')
      expect(blocked).toBe(false)
    })
  })

  describe('listBlocked', () => {
    it('lists all users blocked by a given user', async () => {
      await repo.createBlock('user-list', 'user-1')
      await repo.createBlock('user-list', 'user-2')
      const blocks = await repo.listBlocked('user-list')
      expect(blocks.length).toBe(2)
      expect(blocks.map((b) => b.blockedId).sort()).toEqual(['user-1', 'user-2'])
    })

    it('returns empty array for a user with no blocks', async () => {
      const blocks = await repo.listBlocked('user-no-blocks')
      expect(blocks).toEqual([])
    })
  })

  describe('getBlockerIds', () => {
    it('returns all users that have blocked a given user', async () => {
      await repo.createBlock('blocker-1', 'target')
      await repo.createBlock('blocker-2', 'target')
      const ids = await repo.getBlockerIds('target')
      expect(ids.sort()).toEqual(['blocker-1', 'blocker-2'])
    })
  })

  describe('deleteBlock', () => {
    it('deletes an existing block', async () => {
      await repo.createBlock('user-a', 'user-to-delete')
      const ok = await repo.deleteBlock('user-a', 'user-to-delete')
      expect(ok).toBe(true)
      const block = await repo.getBlock('user-a', 'user-to-delete')
      expect(block).toBeNull()
    })

    it('returns false for a non-existent block', async () => {
      const ok = await repo.deleteBlock('user-a', 'nonexistent')
      expect(ok).toBe(false)
    })
  })

  describe('deleteByUserId', () => {
    it('removes all blocks involving a user', async () => {
      await repo.createBlock('user-del', 'other-1')
      await repo.createBlock('other-2', 'user-del')
      const ok = await repo.deleteByUserId('user-del')
      expect(ok).toBe(true)
      const blocksAsBlocker = await repo.listBlocked('user-del')
      expect(blocksAsBlocker).toEqual([])
      const blockerIds = await repo.getBlockerIds('user-del')
      expect(blockerIds).toEqual([])
    })
  })
})