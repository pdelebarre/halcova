// @vitest-environment node
//
// social.test.js — integration tests for the social Netlify function
// (FEAT-8.2, #327). Tests routing, auth guards, and basic CRUD flows
// using pg-mem for the database.

import { describe, it, expect, vi } from 'vitest'

// Async mock factory — vitest supports async, so we can import pg-mem dynamically.
vi.mock('../postgres', async () => {
  const { newDb } = await import('pg-mem')
  const mem = newDb()
  mem.public.none(`
    CREATE TABLE IF NOT EXISTS follows (
      id                     uuid PRIMARY KEY,
      follower_id            text NOT NULL,
      followed_id            text NOT NULL,
      followed_type          text NOT NULL DEFAULT 'user',
      created_at             timestamptz NOT NULL DEFAULT now(),
      UNIQUE (follower_id, followed_id, followed_type)
    );
    CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_id);
    CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows (followed_id, followed_type);
    CREATE TABLE IF NOT EXISTS activities (
      id                     uuid PRIMARY KEY,
      user_id                text NOT NULL,
      type                   text NOT NULL,
      data                   jsonb NOT NULL DEFAULT '{}',
      created_at             timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS activities_user_idx ON activities (user_id);
    CREATE INDEX IF NOT EXISTS activities_created_idx ON activities (created_at DESC);
    CREATE TABLE IF NOT EXISTS profiles (
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
    CREATE INDEX IF NOT EXISTS profiles_share_id_idx ON profiles (share_id);
    CREATE INDEX IF NOT EXISTS profiles_user_id_idx ON profiles (user_id);
  `)
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  const db = { query: (text, params) => pool.query(text, params), connect: () => pool.connect() }
  return { isPostgresConfigured: () => true, db }
})

vi.mock('../session-auth', () => ({
  resolveSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    get: async () => null,
    setJSON: async () => {},
    list: async () => ({ blobs: [] }),
  }),
}))

import socialHandler from '../../social'
import { resolveSession } from '../session-auth'

function mockReq(method, path, { body, user } = {}) {
  const req = {
    method,
    url: `https://example.com/.netlify/functions/social${path}`,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
  }
  if (body !== undefined) { req.text = async () => JSON.stringify(body) }
  if (user) { resolveSession.mockResolvedValueOnce({ user, session: { id: 's1' }, token: 't1' }) }
  return req
}

async function toJson(res) {
  return JSON.parse(await res.text())
}

describe('social handler', () => {
  const viewer = { id: 'v1', role: 'member', name: 'Viewer', email: '', collections: { records: true }, features: {}, status: 'active' }

  describe('auth gates', () => {
    it('returns 401 for unauthenticated follow', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const res = await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u' } }))
      expect(res.status).toBe(401)
    })

    it('returns 401 for unauthenticated unfollow', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const res = await socialHandler(mockReq('POST', '/unfollow', { body: { followedId: 'u' } }))
      expect(res.status).toBe(401)
    })

    it('returns 401 for unauthenticated feed', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const res = await socialHandler(mockReq('GET', '/feed'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for unauthenticated following', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const res = await socialHandler(mockReq('GET', '/following'))
      expect(res.status).toBe(401)
    })

    it('returns 401 for unauthenticated activity', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const res = await socialHandler(mockReq('POST', '/activity', { body: { type: 'add_item', data: {} } }))
      expect(res.status).toBe(401)
    })
  })

  describe('routing', () => {
    it('returns 405 for unknown path', async () => {
      const res = await socialHandler(mockReq('GET', '/unknown'))
      expect(res.status).toBe(405)
    })

    it('returns 405 for wrong method', async () => {
      const res = await socialHandler(mockReq('PUT', '/follow'))
      expect(res.status).toBe(405)
    })
  })

  describe('follow', () => {
    it('follows another user', async () => {
      const res = await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u1' }, user: viewer }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.follow.followerId).toBe('v1')
      expect(data.follow.followedId).toBe('u1')
    })

    it('is idempotent on duplicate', async () => {
      await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u2' }, user: viewer }))
      const res = await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u2' }, user: viewer }))
      expect(res.status).toBe(200)
    })

    it('rejects demo role', async () => {
      const demo = { id: 'demo', role: 'demo', name: 'Demo' }
      const res = await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u' }, user: demo }))
      expect(res.status).toBe(403)
    })

    it('rejects missing followedId', async () => {
      const res = await socialHandler(mockReq('POST', '/follow', { body: {}, user: viewer }))
      expect(res.status).toBe(400)
    })
  })

  describe('unfollow', () => {
    it('removes a follow relationship', async () => {
      await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u-rm' }, user: viewer }))
      const res = await socialHandler(mockReq('POST', '/unfollow', { body: { followedId: 'u-rm' }, user: viewer }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.unfollowed).toBe(true)
    })
  })

  describe('is-following', () => {
    it('returns true when following', async () => {
      await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'u-check' }, user: viewer }))
      const res = await socialHandler(mockReq('GET', '/is-following?followedId=u-check', { user: viewer }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.isFollowing).toBe(true)
    })

    it('returns false when not following', async () => {
      const res = await socialHandler(mockReq('GET', '/is-following?followedId=unknown', { user: viewer }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.isFollowing).toBe(false)
    })
  })

  describe('following list', () => {
    it('lists followed users', async () => {
      const listViewer = { id: 'list-viewer', role: 'member', name: 'LV', email: '', collections: { records: true }, features: {}, status: 'active' }
      await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'a' }, user: listViewer }))
      await socialHandler(mockReq('POST', '/follow', { body: { followedId: 'b' }, user: listViewer }))
      const res = await socialHandler(mockReq('GET', '/following', { user: listViewer }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.items.length).toBe(2)
    })
  })

  describe('activity logging', () => {
    it('logs an activity', async () => {
      const res = await socialHandler(mockReq('POST', '/activity', {
        body: { type: 'add_item', data: { kind: 'records', title: 'Test' } },
        user: viewer,
      }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.activity.type).toBe('add_item')
      expect(data.activity.userId).toBe('v1')
    })

    it('rejects unknown activity type', async () => {
      const res = await socialHandler(mockReq('POST', '/activity', { body: { type: 'unknown', data: {} }, user: viewer }))
      expect(res.status).toBe(400)
    })

    it('rejects missing type', async () => {
      const res = await socialHandler(mockReq('POST', '/activity', { body: { data: {} }, user: viewer }))
      expect(res.status).toBe(400)
    })
  })

  describe('my activities', () => {
    it('returns own activity list', async () => {
      const myViewer = { id: 'my-acts', role: 'member', name: 'MA', email: '', collections: { records: true }, features: {}, status: 'active' }
      await socialHandler(mockReq('POST', '/activity', { body: { type: 'add_item', data: { title: 'A' } }, user: myViewer }))
      await socialHandler(mockReq('POST', '/activity', { body: { type: 'add_item', data: { title: 'B' } }, user: myViewer }))
      const res = await socialHandler(mockReq('GET', '/activity/mine', { user: myViewer }))
      expect(res.status).toBe(200)
      const data = await toJson(res)
      expect(data.items.length).toBe(2)
    })
  })

  describe('feed', () => {
    it('returns empty for user not following anyone', async () => {
      const lonely = { id: 'lonely', role: 'member', name: 'L', email: '', collections: { records: true }, features: {}, status: 'active' }
      const res = await socialHandler(mockReq('GET', '/feed', { user: lonely }))
      const data = await toJson(res)
      expect(data.items).toEqual([])
    })
  })
})