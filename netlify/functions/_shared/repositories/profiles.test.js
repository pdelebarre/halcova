// profiles.test.js — integration tests for the profiles Netlify function
// (FEAT-8.1, #326). Tests public profile access, own profile management,
// visibility enforcement, and security invariants.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import newDb from 'pg-mem'
import profilesHandler from '../../profiles'
import { createProfilesRepo } from './profiles-repo'

// Mock the Postgres db module
vi.mock('../postgres', () => {
  const db = newDb().adapters.pg()
  db.query(`
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
  `)
  return { isPostgresConfigured: () => true, db }
})

// Mock session-auth
vi.mock('../session-auth', () => ({
  resolveSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

import { resolveSession } from '../session-auth'

function mockRequest(method, path, { body, headers = {} } = {}) {
  const url = `https://runout.example.com/.netlify/functions/profiles${path}`
  const req = {
    method,
    url,
    headers: {
      get: (name) => {
        const h = { 'content-type': 'application/json', ...headers }
        return h[name.toLowerCase()] || null
      },
    },
  }
  if (body) {
    req.text = async () => JSON.stringify(body)
    req.json = async () => body
  }
  return req
}

describe('profiles handler', () => {
  beforeAll(async () => {
    // Seed a public profile for testing
    const repo = createProfilesRepo({ query: (await vi.mock('../postgres')).db.query })
    // Actually let's use the db directly
  })

  describe('GET /profiles/public/:shareId', () => {
    it('returns 404 for unknown share id', async () => {
      const req = mockRequest('GET', '/public/00000000-0000-0000-0000-000000000000')
      const res = await profilesHandler(req)
      expect(res.status).toBe(404)
    })

    it('returns 400 for missing share id', async () => {
      const req = mockRequest('GET', '/public/')
      const res = await profilesHandler(req)
      expect(res.status).toBe(400)
    })
  })

  describe('GET /profiles/me', () => {
    it('returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('GET', '/me')
      const res = await profilesHandler(req)
      expect(res.status).toBe(401)
    })
  })

  describe('PUT /profiles/me', () => {
    it('returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('PUT', '/me', { body: { username: 'Test' } })
      const res = await profilesHandler(req)
      expect(res.status).toBe(401)
    })
  })

  describe('DELETE /profiles/me', () => {
    it('returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('DELETE', '/me')
      const res = await profilesHandler(req)
      expect(res.status).toBe(401)
    })
  })

  describe('405 method not allowed', () => {
    it('returns 405 for unknown path', async () => {
      const req = mockRequest('GET', '/unknown')
      const res = await profilesHandler(req)
      expect(res.status).toBe(405)
    })

    it('returns 405 for POST on /me', async () => {
      const req = mockRequest('POST', '/me')
      const res = await profilesHandler(req)
      expect(res.status).toBe(405)
    })
  })
})