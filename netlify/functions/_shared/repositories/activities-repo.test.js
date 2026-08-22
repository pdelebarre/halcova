// @vitest-environment node
//
// activities-repo.test.js — unit tests for the Postgres activities repository
// (FEAT-8.2, #327). Uses pg-mem for an in-memory Postgres emulator.

import { describe, it, expect, beforeAll } from 'vitest'
import { newDb } from 'pg-mem'
import { createActivitiesRepo } from './activities-repo'

const MIGRATION_SQL = `
CREATE TABLE activities (
  id                     uuid PRIMARY KEY,
  user_id                text NOT NULL,
  type                   text NOT NULL,
  data                   jsonb NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_user_idx ON activities (user_id);
CREATE INDEX activities_created_idx ON activities (created_at DESC);
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

describe('activities-repo', () => {
  let db
  let repo

  beforeAll(() => {
    db = createTestDb()
    repo = createActivitiesRepo(db)
  })

  describe('ACTIVITY_TYPES', () => {
    it('includes all expected activity types', () => {
      expect(repo.ACTIVITY_TYPES.has('add_item')).toBe(true)
      expect(repo.ACTIVITY_TYPES.has('complete_collection')).toBe(true)
      expect(repo.ACTIVITY_TYPES.has('showcase_update')).toBe(true)
      expect(repo.ACTIVITY_TYPES.has('profile_update')).toBe(true)
    })
  })

  describe('logActivity', () => {
    it('creates an activity record', async () => {
      const activity = await repo.logActivity('user-1', 'add_item', {
        kind: 'records',
        itemId: 'item-1',
        title: 'Test Album',
        artists: 'Test Artist',
      })
      expect(activity).not.toBeNull()
      expect(activity.userId).toBe('user-1')
      expect(activity.type).toBe('add_item')
      expect(activity.data.kind).toBe('records')
      expect(activity.data.title).toBe('Test Album')
      expect(activity.data.artists).toBe('Test Artist')
      expect(activity.id).toBeTruthy()
      expect(activity.createdAt).toBeTruthy()
    })

    it('returns null for unknown activity type', async () => {
      const activity = await repo.logActivity('user-1', 'unknown_type', {})
      expect(activity).toBeNull()
    })

    it('returns null for missing user id', async () => {
      const activity = await repo.logActivity(null, 'add_item', {})
      expect(activity).toBeNull()
    })

    it('logs different activity types', async () => {
      const add = await repo.logActivity('user-2', 'add_item', { kind: 'books', title: 'A Book' })
      expect(add.type).toBe('add_item')

      const complete = await repo.logActivity('user-2', 'complete_collection', { kind: 'records' })
      expect(complete.type).toBe('complete_collection')

      const showcase = await repo.logActivity('user-2', 'showcase_update', { kind: 'books', itemIds: ['i1', 'i2'] })
      expect(showcase.type).toBe('showcase_update')

      const profile = await repo.logActivity('user-2', 'profile_update', { fields: ['avatar', 'bio'] })
      expect(profile.type).toBe('profile_update')
    })
  })

  describe('getActivitiesByUser', () => {
    it('returns empty for user with no activities', async () => {
      const result = await repo.getActivitiesByUser('user-no-activity')
      expect(result.items).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('returns activities for a user in reverse chronological order', async () => {
      await repo.logActivity('user-activity', 'add_item', { title: 'First' })
      await repo.logActivity('user-activity', 'add_item', { title: 'Second' })
      const result = await repo.getActivitiesByUser('user-activity')
      expect(result.items.length).toBe(2)
      // Most recent first (created_at DESC)
      const times = result.items.map((a) => new Date(a.createdAt).getTime())
      expect(times[0]).toBeGreaterThanOrEqual(times[1])
    })

    it('returns empty for null id', async () => {
      const result = await repo.getActivitiesByUser(null)
      expect(result.items).toEqual([])
    })
  })

  describe('getFeed', () => {
    it('returns empty for empty followed list', async () => {
      const result = await repo.getFeed([])
      expect(result.items).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('returns activities from followed users', async () => {
      await repo.logActivity('following-1', 'add_item', { title: 'Item 1' })
      await repo.logActivity('following-2', 'add_item', { title: 'Item 2' })
      await repo.logActivity('not-followed', 'add_item', { title: 'Item 3' })
      const result = await repo.getFeed(['following-1', 'following-2'])
      expect(result.items.length).toBe(2)
      const titles = result.items.map((a) => a.data.title)
      expect(titles).toContain('Item 1')
      expect(titles).toContain('Item 2')
      expect(titles).not.toContain('Item 3')
    })

    it('supports cursor-based pagination', async () => {
      await repo.logActivity('followed-page', 'add_item', { title: 'A' })
      await repo.logActivity('followed-page', 'add_item', { title: 'B' })
      const first = await repo.getFeed(['followed-page'], { limit: 1 })
      expect(first.items.length).toBe(1)
      expect(first.hasMore).toBe(true)
      expect(first.nextCursor).toBeTruthy()
    })
  })

  describe('deleteOlderThan', () => {
    it('deletes activities older than a timestamp', async () => {
      await repo.logActivity('user-cleanup', 'add_item', { title: 'Old' })
      const cutoff = new Date(Date.now() + 86400000).toISOString() // tomorrow
      const deleted = await repo.deleteOlderThan(cutoff)
      expect(typeof deleted).toBe('number')
      expect(deleted).toBeGreaterThanOrEqual(1)
      const result = await repo.getActivitiesByUser('user-cleanup')
      expect(result.items.length).toBe(0)
    })

    it('returns 0 for null timestamp', async () => {
      const deleted = await repo.deleteOlderThan(null)
      expect(deleted).toBe(0)
    })
  })
})