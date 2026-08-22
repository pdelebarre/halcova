// profiles-repo.test.js — unit tests for the Postgres profile repository
// (FEAT-8.1, #326). Uses pg-mem for an in-memory Postgres emulator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import newDb from 'pg-mem'
import { createProfilesRepo } from './profiles-repo'

// Load the migration SQL
const MIGRATION_SQL = `
CREATE TABLE profiles (
  id                     uuid PRIMARY KEY,
  user_id                text NOT NULL UNIQUE,
  share_id               uuid NOT NULL UNIQUE,
  username               text NOT NULL DEFAULT '',
  avatar                 text NOT NULL DEFAULT '',
  bio                    text NOT NULL DEFAULT '',
  links                  jsonb NOT NULL DEFAULT '[]',
  visibility             text NOT NULL DEFAULT 'private',
  collection_visibility  text NOT NULL DEFAULT 'private',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_visibility_check
    CHECK (visibility IN ('private', 'owner', 'public')),
  CONSTRAINT profiles_collection_visibility_check
    CHECK (collection_visibility IN ('private', 'owner', 'public'))
);
CREATE INDEX profiles_share_id_idx ON profiles (share_id);
CREATE INDEX profiles_user_id_idx ON profiles (user_id);
`

function createTestDb() {
  const db = newDb().adapters.pg()
  db.query(MIGRATION_SQL)
  return db
}

describe('profiles-repo', () => {
  let db
  let repo

  beforeAll(() => {
    db = createTestDb()
    repo = createProfilesRepo(db)
  })

  describe('getByUserId', () => {
    it('returns null for unknown user', async () => {
      const result = await repo.getByUserId('unknown')
      expect(result).toBeNull()
    })

    it('returns null for empty user id', async () => {
      const result = await repo.getByUserId('')
      expect(result).toBeNull()
    })

    it('returns profile after upsert', async () => {
      const profile = await repo.upsertProfile({
        userId: 'user-1',
        username: 'TestUser',
        bio: 'A test bio',
        visibility: 'public',
        collectionVisibility: 'owner',
      })
      expect(profile).not.toBeNull()
      expect(profile.userId).toBe('user-1')
      expect(profile.username).toBe('TestUser')
      expect(profile.bio).toBe('A test bio')
      expect(profile.visibility).toBe('public')
      expect(profile.collectionVisibility).toBe('owner')
      expect(profile.shareId).toBeTruthy()
      expect(profile.id).toBeTruthy()

      const fetched = await repo.getByUserId('user-1')
      expect(fetched).not.toBeNull()
      expect(fetched.userId).toBe('user-1')
      expect(fetched.username).toBe('TestUser')
    })
  })

  describe('getByShareId', () => {
    it('returns null for unknown share id', async () => {
      const result = await repo.getByShareId('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })

    it('returns null for invalid uuid', async () => {
      const result = await repo.getByShareId('not-a-uuid')
      expect(result).toBeNull()
    })

    it('returns null for private profile', async () => {
      const profile = await repo.upsertProfile({
        userId: 'user-private',
        username: 'PrivateUser',
        visibility: 'private',
      })
      const fetched = await repo.getByShareId(profile.shareId)
      expect(fetched).toBeNull()
    })

    it('returns profile for public profile', async () => {
      const profile = await repo.upsertProfile({
        userId: 'user-public',
        username: 'PublicUser',
        visibility: 'public',
      })
      const fetched = await repo.getByShareId(profile.shareId)
      expect(fetched).not.toBeNull()
      expect(fetched.userId).toBe('user-public')
      expect(fetched.username).toBe('PublicUser')
    })
  })

  describe('upsertProfile', () => {
    it('creates a new profile on first save', async () => {
      const profile = await repo.upsertProfile({
        userId: 'user-new',
        username: 'NewUser',
        bio: 'Hello!',
        links: [{ label: 'Twitter', url: 'https://twitter.com/test' }],
      })
      expect(profile).not.toBeNull()
      expect(profile.userId).toBe('user-new')
      expect(profile.username).toBe('NewUser')
      expect(profile.bio).toBe('Hello!')
      expect(Array.isArray(profile.links)).toBe(true)
      expect(profile.links[0].label).toBe('Twitter')
      expect(profile.shareId).toBeTruthy()
    })

    it('updates an existing profile', async () => {
      await repo.upsertProfile({ userId: 'user-update', username: 'Before' })
      const updated = await repo.upsertProfile({
        userId: 'user-update',
        username: 'After',
        bio: 'Updated bio',
      })
      expect(updated.username).toBe('After')
      expect(updated.bio).toBe('Updated bio')
      // shareId should remain the same
      const fetched = await repo.getByUserId('user-update')
      expect(fetched.shareId).toBe(updated.shareId)
    })

    it('truncates long username', async () => {
      const long = 'A'.repeat(200)
      const profile = await repo.upsertProfile({ userId: 'user-long', username: long })
      expect(profile.username.length).toBeLessThanOrEqual(80)
    })

    it('truncates long bio', async () => {
      const long = 'B'.repeat(1000)
      const profile = await repo.upsertProfile({ userId: 'user-long-bio', bio: long })
      expect(profile.bio.length).toBeLessThanOrEqual(500)
    })

    it('defaults visibility to private', async () => {
      const profile = await repo.upsertProfile({ userId: 'user-default-vis' })
      expect(profile.visibility).toBe('private')
      expect(profile.collectionVisibility).toBe('private')
    })

    it('resolves unknown visibility to private', async () => {
      const profile = await repo.upsertProfile({
        userId: 'user-unknown-vis',
        visibility: 'unknown_value',
      })
      expect(profile.visibility).toBe('private')
    })
  })

  describe('deleteByUserId', () => {
    it('returns false for unknown user', async () => {
      const result = await repo.deleteByUserId('nonexistent')
      expect(result).toBe(false)
    })

    it('deletes an existing profile', async () => {
      await repo.upsertProfile({ userId: 'user-delete', username: 'ToDelete' })
      const result = await repo.deleteByUserId('user-delete')
      expect(result).toBe(true)
      const fetched = await repo.getByUserId('user-delete')
      expect(fetched).toBeNull()
    })
  })

  describe('revokePublicAccess', () => {
    it('returns false for unknown user', async () => {
      const result = await repo.revokePublicAccess('nonexistent')
      expect(result).toBe(false)
    })

    it('sets visibility to private', async () => {
      await repo.upsertProfile({
        userId: 'user-revoke',
        username: 'RevokeMe',
        visibility: 'public',
        collectionVisibility: 'public',
      })
      const result = await repo.revokePublicAccess('user-revoke')
      expect(result).toBe(true)
      const profile = await repo.getByUserId('user-revoke')
      expect(profile.visibility).toBe('private')
      expect(profile.collectionVisibility).toBe('private')
    })
  })
})