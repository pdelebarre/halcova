// @vitest-environment node
//
// follows-repo.test.js — unit tests for the Postgres follows repository
// (FEAT-8.2, #327). Uses pg-mem for an in-memory Postgres emulator.

import { describe, it, expect, beforeAll } from 'vitest'
import { newDb } from 'pg-mem'
import { createFollowsRepo } from './follows-repo'

const MIGRATION_SQL = `
CREATE TABLE follows (
  id                     uuid PRIMARY KEY,
  follower_id            text NOT NULL,
  followed_id            text NOT NULL,
  followed_type          text NOT NULL DEFAULT 'user',
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, followed_id, followed_type)
);
CREATE INDEX follows_follower_idx ON follows (follower_id);
CREATE INDEX follows_followed_idx ON follows (followed_id, followed_type);
`

function createTestDb() {
  const mem = newDb()
  mem.public.none(MIGRATION_SQL)
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  return {
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(),
  }
}

describe('follows-repo', () => {
  let db
  let repo

  beforeAll(() => {
    db = createTestDb()
    repo = createFollowsRepo(db)
  })

  describe('follow', () => {
    it('creates a follow relationship', async () => {
      const result = await repo.follow('user-a', 'user-b', 'user')
      expect(result).not.toBeNull()
      expect(result.followerId).toBe('user-a')
      expect(result.followedId).toBe('user-b')
      expect(result.followedType).toBe('user')
      expect(result.id).toBeTruthy()
    })

    it('is idempotent — duplicate follow returns existing', async () => {
      const first = await repo.follow('user-a', 'user-b', 'user')
      const second = await repo.follow('user-a', 'user-b', 'user')
      expect(second).not.toBeNull()
      expect(second.followerId).toBe('user-a')
      expect(second.followedId).toBe('user-b')
    })

    it('allows following a different type (collection)', async () => {
      const result = await repo.follow('user-a', 'share-collection-1', 'collection')
      expect(result).not.toBeNull()
      expect(result.followedType).toBe('collection')
    })

    it('returns null for missing ids', async () => {
      const result = await repo.follow(null, 'user-b', 'user')
      expect(result).toBeNull()
    })
  })

  describe('unfollow', () => {
    it('removes a follow relationship', async () => {
      await repo.follow('user-x', 'user-y', 'user')
      const result = await repo.unfollow('user-x', 'user-y', 'user')
      expect(result).toBe(true)
      const isFollowing = await repo.isFollowing('user-x', 'user-y', 'user')
      expect(isFollowing).toBe(false)
    })

    it('is idempotent — unfollow when not following returns false', async () => {
      const result = await repo.unfollow('user-never', 'user-followed', 'user')
      expect(result).toBe(false)
    })

    it('returns false for missing ids', async () => {
      const result = await repo.unfollow(null, 'user-b', 'user')
      expect(result).toBe(false)
    })
  })

  describe('isFollowing', () => {
    it('returns true when following', async () => {
      await repo.follow('user-check', 'user-target', 'user')
      const result = await repo.isFollowing('user-check', 'user-target', 'user')
      expect(result).toBe(true)
    })

    it('returns false when not following', async () => {
      const result = await repo.isFollowing('user-check', 'user-nonexistent', 'user')
      expect(result).toBe(false)
    })

    it('returns false for missing ids', async () => {
      const result = await repo.isFollowing(null, 'user-b', 'user')
      expect(result).toBe(false)
    })
  })

  describe('listFollowing', () => {
    it('returns empty list for user following nobody', async () => {
      const result = await repo.listFollowing('user-lonely')
      expect(result.items).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('lists who a user follows', async () => {
      await repo.follow('user-lister', 'user-1', 'user')
      await repo.follow('user-lister', 'user-2', 'user')
      const result = await repo.listFollowing('user-lister')
      expect(result.items.length).toBe(2)
      expect(result.items[0].followerId).toBe('user-lister')
    })

    it('returns empty for null id', async () => {
      const result = await repo.listFollowing(null)
      expect(result.items).toEqual([])
    })

    it('supports cursor-based pagination', async () => {
      await repo.follow('user-page', 'user-a-page', 'user')
      await repo.follow('user-page', 'user-b-page', 'user')
      const first = await repo.listFollowing('user-page', { limit: 1 })
      expect(first.items.length).toBe(1)
      expect(first.hasMore).toBe(true)
      expect(first.nextCursor).toBeTruthy()

      const second = await repo.listFollowing('user-page', { limit: 1, before: first.nextCursor })
      expect(second.items.length).toBe(1)
    })
  })

  describe('listFollowers', () => {
    it('returns empty for user with no followers', async () => {
      const result = await repo.listFollowers('user-unpopular', 'user')
      expect(result.items).toEqual([])
    })

    it('lists followers of a target', async () => {
      await repo.follow('follower-1', 'user-popular', 'user')
      await repo.follow('follower-2', 'user-popular', 'user')
      const result = await repo.listFollowers('user-popular', 'user')
      expect(result.items.length).toBe(2)
    })

    it('returns empty for null id', async () => {
      const result = await repo.listFollowers(null, 'user')
      expect(result.items).toEqual([])
    })
  })

  describe('followerCount / followingCount', () => {
    it('returns 0 for unknown target', async () => {
      expect(await repo.followerCount('unknown', 'user')).toBe(0)
      expect(await repo.followingCount('unknown')).toBe(0)
    })

    it('returns accurate counts', async () => {
      await repo.follow('counter-a', 'user-counted', 'user')
      await repo.follow('counter-b', 'user-counted', 'user')
      expect(await repo.followerCount('user-counted', 'user')).toBe(2)

      await repo.follow('user-counted', 'other-1', 'user')
      await repo.follow('user-counted', 'other-2', 'user')
      expect(await repo.followingCount('user-counted')).toBe(2)
    })
  })

  describe('getFollowedUserIds', () => {
    it('returns followed user ids', async () => {
      await repo.follow('user-fu', 'target-fu-1', 'user')
      await repo.follow('user-fu', 'target-fu-2', 'user')
      // Follow a collection too (should not appear in user-only list)
      await repo.follow('user-fu', 'share-collection', 'collection')
      const ids = await repo.getFollowedUserIds('user-fu')
      expect(ids.length).toBe(2)
      expect(ids).toContain('target-fu-1')
      expect(ids).toContain('target-fu-2')
    })

    it('returns empty for null id', async () => {
      const ids = await repo.getFollowedUserIds(null)
      expect(ids).toEqual([])
    })
  })
})