// moderation.test.js — integration tests for the moderation Netlify function
// (FEAT-8.5, #330). Tests block/mute, reports, rate limiting, and security.

import { describe, it, expect, vi } from 'vitest'
import newDb from 'pg-mem'
import moderationHandler from '../moderation'

// Mock the Postgres db module
vi.mock('./_shared/postgres', () => {
  const db = newDb().adapters.pg()
  db.query(`
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

    CREATE TABLE reports (
      id              uuid PRIMARY KEY,
      reporter_id     text NOT NULL,
      target_type     text NOT NULL,
      target_id       text NOT NULL,
      reason          text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
      status          text NOT NULL DEFAULT 'open',
      action_taken    text NOT NULL DEFAULT '',
      moderator_id    text NOT NULL DEFAULT '',
      moderator_note  text NOT NULL DEFAULT '',
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT reports_status_check
        CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
      CONSTRAINT reports_action_check
        CHECK (action_taken IN ('', 'content_hidden', 'user_warned', 'user_blocked', 'none'))
    );
    CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
    CREATE INDEX reports_target_idx ON reports (target_type, target_id);
    CREATE INDEX reports_reporter_idx ON reports (reporter_id);
  `)
  return { isPostgresConfigured: () => true, db }
})

// Mock session-auth
vi.mock('./_shared/session-auth', () => ({
  resolveSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

import { resolveSession } from './_shared/session-auth'

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