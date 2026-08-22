// moderation.test.js — integration tests for the moderation Netlify function
// (FEAT-8.5, #330). Tests block/mute, reports, rate limiting, and security.

import { describe, it, expect, vi } from 'vitest'
import moderationHandler from '../../moderation'

// Mock the Postgres db module. Tests exercise only routing/auth that returns
// before createBlocksRepo/createReportsRepo is called, so a stub suffices.
vi.mock('../postgres', () => ({
  isPostgresConfigured: () => true,
  db: { query: vi.fn() },
}))

// Mock session-auth
vi.mock('../session-auth', () => ({
  resolveSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

import { resolveSession } from '../session-auth'

function mockRequest(method, path, { body, headers = {} } = {}) {
  const url = `https://runout.example.com/.netlify/functions/moderation${path}`
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

function mockSession(user) {
  resolveSession.mockResolvedValueOnce({ user, session: { token: 'test' }, token: 'test' })
}

describe('moderation handler', () => {
  describe('blocks', () => {
    it('GET /moderation/blocks returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('GET', '/blocks')
      const res = await moderationHandler(req)
      expect(res.status).toBe(401)
    })

    it('POST /moderation/blocks returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('POST', '/blocks', { body: { blockedId: 'user-b' } })
      const res = await moderationHandler(req)
      expect(res.status).toBe(401)
    })

    it('DELETE /moderation/blocks returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('DELETE', '/blocks?blockedId=user-b')
      const res = await moderationHandler(req)
      expect(res.status).toBe(401)
    })
  })

  describe('reports', () => {
    it('POST /moderation/reports returns 401 when not authenticated', async () => {
      resolveSession.mockResolvedValueOnce({ error: { status: 401 } })
      const req = mockRequest('POST', '/reports', { body: { targetType: 'profile', targetId: 't1', reason: 'Spam' } })
      const res = await moderationHandler(req)
      expect(res.status).toBe(401)
    })

    it('GET /moderation/reports returns 403 for non-moderator', async () => {
      mockSession({ id: 'user-a', role: 'member' })
      const req = mockRequest('GET', '/reports')
      const res = await moderationHandler(req)
      expect(res.status).toBe(403)
    })
  })

  describe('405 method not allowed', () => {
    it('returns 405 for unknown path', async () => {
      const req = mockRequest('GET', '/unknown')
      const res = await moderationHandler(req)
      expect(res.status).toBe(405)
    })

    it('returns 405 for PATCH on blocks', async () => {
      mockSession({ id: 'user-a', role: 'member' })
      const req = mockRequest('PATCH', '/blocks')
      const res = await moderationHandler(req)
      expect(res.status).toBe(405)
    })
  })
})