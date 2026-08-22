// reports-repo.test.js — unit tests for the Postgres reports repository
// (FEAT-8.5, #330). Uses pg-mem for an in-memory Postgres emulator.

import { describe, it, expect, beforeAll } from 'vitest'
import newDb from 'pg-mem'
import { createReportsRepo } from './reports-repo'

const MIGRATION_SQL = `
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
`

function createTestDb() {
  const db = newDb().adapters.pg()
  db.query(MIGRATION_SQL)
  return db
}

describe('reports-repo', () => {
  let db
  let repo

  beforeAll(() => {
    db = createTestDb()
    repo = createReportsRepo(db)
  })

  describe('createReport', () => {
    it('creates a report', async () => {
      const report = await repo.createReport({
        reporterId: 'user-a',
        targetType: 'profile',
        targetId: 'target-1',
        reason: 'Inappropriate content',
      })
      expect(report).not.toBeNull()
      expect(report.reporterId).toBe('user-a')
      expect(report.targetType).toBe('profile')
      expect(report.targetId).toBe('target-1')
      expect(report.reason).toBe('Inappropriate content')
      expect(report.status).toBe('open')
      expect(report.actionTaken).toBe('')
    })

    it('returns null for missing fields', async () => {
      const report = await repo.createReport({ reporterId: 'user-a' })
      expect(report).toBeNull()
    })

    it('returns null for invalid target type', async () => {
      const report = await repo.createReport({
        reporterId: 'user-a',
        targetType: 'invalid_type',
        targetId: 'target-1',
        reason: 'Test',
      })
      expect(report).toBeNull()
    })

    it('truncates long reason', async () => {
      const long = 'X'.repeat(3000)
      const report = await repo.createReport({
        reporterId: 'user-a',
        targetType: 'item',
        targetId: 'target-1',
        reason: long,
      })
      expect(report).not.toBeNull()
      expect(report.reason.length).toBeLessThanOrEqual(2000)
    })
  })

  describe('getReport', () => {
    it('returns a report by id', async () => {
      const created = await repo.createReport({
        reporterId: 'user-a',
        targetType: 'review',
        targetId: 'review-1',
        reason: 'Spam',
      })
      const fetched = await repo.getReport(created.id)
      expect(fetched).not.toBeNull()
      expect(fetched.id).toBe(created.id)
      expect(fetched.targetType).toBe('review')
    })

    it('returns null for unknown id', async () => {
      const report = await repo.getReport('00000000-0000-0000-0000-000000000000')
      expect(report).toBeNull()
    })

    it('returns null for invalid uuid', async () => {
      const report = await repo.getReport('not-a-uuid')
      expect(report).toBeNull()
    })
  })

  describe('listReports', () => {
    it('lists all reports newest first', async () => {
      await repo.createReport({ reporterId: 'user-a', targetType: 'profile', targetId: 't1', reason: 'First' })
      await repo.createReport({ reporterId: 'user-b', targetType: 'item', targetId: 't2', reason: 'Second' })
      const reports = await repo.listReports()
      expect(reports.length).toBeGreaterThanOrEqual(2)
    })

    it('filters by status', async () => {
      const reports = await repo.listReports({ status: 'open' })
      expect(reports.every((r) => r.status === 'open')).toBe(true)
    })
  })

  describe('moderateReport', () => {
    it('updates a report status and action', async () => {
      const created = await repo.createReport({
        reporterId: 'user-a',
        targetType: 'profile',
        targetId: 'target-1',
        reason: 'Test report',
      })
      const moderated = await repo.moderateReport(created.id, {
        status: 'resolved',
        actionTaken: 'content_hidden',
        moderatorId: 'mod-1',
        moderatorNote: 'Content removed',
      })
      expect(moderated).not.toBeNull()
      expect(moderated.status).toBe('resolved')
      expect(moderated.actionTaken).toBe('content_hidden')
      expect(moderated.moderatorId).toBe('mod-1')
      expect(moderated.moderatorNote).toBe('Content removed')
    })

    it('returns null for unknown id', async () => {
      const result = await repo.moderateReport('00000000-0000-0000-0000-000000000000', { status: 'resolved' })
      expect(result).toBeNull()
    })

    it('rejects moderation of already resolved report', async () => {
      const created = await repo.createReport({
        reporterId: 'user-a',
        targetType: 'item',
        targetId: 'target-1',
        reason: 'Already resolved',
      })
      await repo.moderateReport(created.id, { status: 'resolved', moderatorId: 'mod-1' })
      const reModerate = await repo.moderateReport(created.id, { status: 'open', moderatorId: 'mod-2' })
      expect(reModerate).toBeNull()
    })
  })

  describe('deleteByReporter', () => {
    it('removes all reports by a reporter', async () => {
      await repo.createReport({ reporterId: 'user-del', targetType: 'profile', targetId: 't1', reason: 'R1' })
      await repo.createReport({ reporterId: 'user-del', targetType: 'item', targetId: 't2', reason: 'R2' })
      const ok = await repo.deleteByReporter('user-del')
      expect(ok).toBe(true)
      const reports = await repo.listReports()
      expect(reports.filter((r) => r.reporterId === 'user-del')).toEqual([])
    })
  })

  describe('countsByStatus', () => {
    it('returns counts grouped by status', async () => {
      const counts = await repo.countsByStatus()
      expect(Array.isArray(counts)).toBe(true)
      counts.forEach((row) => {
        expect(row).toHaveProperty('status')
        expect(row).toHaveProperty('count')
      })
    })
  })
})