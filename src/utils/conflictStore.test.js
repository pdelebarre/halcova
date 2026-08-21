// M3 #161 — Conflict Store tests (ADR-0019 Dec 8).
//
// Covers:
//   - schema version and migration evidence
//   - saveConflict: persist a conflict record
//   - getConflicts: read conflicts for a user
//   - getConflict: read a specific conflict
//   - markResolved: update a conflict's status
//   - countUnresolvedConflicts: count unresolved conflicts
//   - getConflictMetrics: aggregate statistics
//   - clearConflictsForUser: clear one user's conflicts
//   - clearAllConflicts: clear all conflicts
//   - cross-user isolation
//   - fail-closed behavior

import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  CONFLICT_DB_VERSION,
  clearAllConflicts,
  clearConflictsForUser,
  countUnresolvedConflicts,
  getConflict,
  getConflictMetrics,
  getConflicts,
  markResolved,
  openConflictDb,
  saveConflict,
  upgradeConflictDb,
  getMigrationRecord,
} from './conflictStore'

const USER_A = 'u1'
const USER_B = 'u2'

function makeConflict(overrides = {}) {
  return {
    conflictId: `server:r1:${Date.now()}`,
    uuid: 'server:r1',
    scope: 'user:u1',
    entityType: 'collection',
    serverVersion: 5,
    localVersion: 2,
    serverItem: { title: 'Server' },
    localItem: { title: 'Local' },
    detectedAt: new Date().toISOString(),
    status: 'unresolved',
    resolution: null,
    resolvedAt: null,
    mergedItem: null,
    policy: { requiresUserIntent: false, mergeableFields: ['notes', 'tags'] },
    ...overrides,
  }
}

async function dropDb() {
  await clearAllConflicts()
}

beforeEach(async () => {
  await dropDb()
})

// ---------------------------------------------------------------------------
// Schema / migration
// ---------------------------------------------------------------------------

describe('schema + migration evidence', () => {
  it('declares schema version and records migration audit', async () => {
    expect(CONFLICT_DB_VERSION).toBe(1)

    const db = await openConflictDb()
    expect(db).not.toBeNull()
    expect(db.objectStoreNames.contains('conflicts')).toBe(true)
    expect(db.objectStoreNames.contains('meta')).toBe(true)
    db.close()

    const meta = await getMigrationRecord()
    expect(meta).not.toBeNull()
    expect(meta.schemaVersion).toBe(1)
    expect(meta.migratedFrom).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// saveConflict / getConflicts
// ---------------------------------------------------------------------------

describe('saveConflict / getConflicts', () => {
  it('saves and reads back a conflict', async () => {
    const conflict = makeConflict()
    const ok = await saveConflict(USER_A, conflict)
    expect(ok).toBe(true)

    const conflicts = await getConflicts(USER_A)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].conflictId).toBe(conflict.conflictId)
    expect(conflicts[0].uuid).toBe('server:r1')
    expect(conflicts[0].status).toBe('unresolved')
  })

  it('returns empty array when no conflicts', async () => {
    const conflicts = await getConflicts(USER_A)
    expect(conflicts).toEqual([])
  })

  it('filters by status', async () => {
    await saveConflict(USER_A, makeConflict({ conflictId: 'c1', status: 'unresolved' }))
    await saveConflict(USER_A, makeConflict({ conflictId: 'c2', status: 'resolved-server' }))

    const unresolved = await getConflicts(USER_A, { status: 'unresolved' })
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].conflictId).toBe('c1')

    const resolved = await getConflicts(USER_A, { status: 'resolved-server' })
    expect(resolved).toHaveLength(1)
    expect(resolved[0].conflictId).toBe('c2')
  })

  it('isolates between users', async () => {
    await saveConflict(USER_A, makeConflict({ conflictId: 'c1' }))
    await saveConflict(USER_B, makeConflict({ conflictId: 'c2', scope: 'user:u2' }))

    const conflictsA = await getConflicts(USER_A)
    expect(conflictsA).toHaveLength(1)
    expect(conflictsA[0].conflictId).toBe('c1')

    const conflictsB = await getConflicts(USER_B)
    expect(conflictsB).toHaveLength(1)
    expect(conflictsB[0].conflictId).toBe('c2')
  })
})

// ---------------------------------------------------------------------------
// getConflict
// ---------------------------------------------------------------------------

describe('getConflict', () => {
  it('reads a specific conflict by conflictId', async () => {
    const conflict = makeConflict()
    await saveConflict(USER_A, conflict)

    const result = await getConflict(USER_A, conflict.conflictId)
    expect(result).not.toBeNull()
    expect(result.uuid).toBe('server:r1')
  })

  it('returns null for unknown conflictId', async () => {
    const result = await getConflict(USER_A, 'nonexistent')
    expect(result).toBeNull()
  })

  it('scope-checks: cannot read another user conflict', async () => {
    await saveConflict(USER_A, makeConflict())
    const result = await getConflict(USER_B, 'c1')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// markResolved
// ---------------------------------------------------------------------------

describe('markResolved', () => {
  it('updates a conflict status after resolution', async () => {
    const conflict = makeConflict()
    await saveConflict(USER_A, conflict)

    const resolved = {
      ...conflict,
      status: 'resolved-server',
      resolution: 'resolved-server',
      resolvedAt: new Date().toISOString(),
      mergedItem: null,
    }
    const ok = await markResolved(USER_A, conflict.conflictId, resolved)
    expect(ok).toBe(true)

    const updated = await getConflict(USER_A, conflict.conflictId)
    expect(updated.status).toBe('resolved-server')
    expect(updated.resolvedAt).toBeTruthy()
  })

  it('returns false for unknown conflictId', async () => {
    const ok = await markResolved(USER_A, 'nonexistent', { status: 'resolved-server' })
    expect(ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// countUnresolvedConflicts
// ---------------------------------------------------------------------------

describe('countUnresolvedConflicts', () => {
  it('counts unresolved conflicts', async () => {
    await saveConflict(USER_A, makeConflict({ conflictId: 'c1', status: 'unresolved' }))
    await saveConflict(USER_A, makeConflict({ conflictId: 'c2', status: 'unresolved' }))
    await saveConflict(USER_A, makeConflict({ conflictId: 'c3', status: 'resolved-server' }))

    const count = await countUnresolvedConflicts(USER_A)
    expect(count).toBe(2)
  })

  it('returns 0 when no conflicts', async () => {
    expect(await countUnresolvedConflicts(USER_A)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getConflictMetrics
// ---------------------------------------------------------------------------

describe('getConflictMetrics', () => {
  it('returns all-zero metrics when no conflicts', async () => {
    const metrics = await getConflictMetrics(USER_A)
    expect(metrics).toEqual({
      totalConflicts: 0,
      unresolved: 0,
      resolvedServer: 0,
      resolvedLocal: 0,
      resolvedMerged: 0,
    })
  })

  it('aggregates conflict stats by status', async () => {
    await saveConflict(USER_A, makeConflict({ conflictId: 'c1', status: 'unresolved' }))
    await saveConflict(USER_A, makeConflict({ conflictId: 'c2', status: 'resolved-server' }))
    await saveConflict(USER_A, makeConflict({ conflictId: 'c3', status: 'resolved-local' }))
    await saveConflict(USER_A, makeConflict({ conflictId: 'c4', status: 'resolved-merged' }))

    const metrics = await getConflictMetrics(USER_A)
    expect(metrics.totalConflicts).toBe(4)
    expect(metrics.unresolved).toBe(1)
    expect(metrics.resolvedServer).toBe(1)
    expect(metrics.resolvedLocal).toBe(1)
    expect(metrics.resolvedMerged).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Clear / reset
// ---------------------------------------------------------------------------

describe('clear/isolate on sign-out', () => {
  it('clearConflictsForUser clears only that user data', async () => {
    await saveConflict(USER_A, makeConflict({ conflictId: 'c1' }))
    await saveConflict(USER_B, makeConflict({ conflictId: 'c2', scope: 'user:u2' }))

    await clearConflictsForUser(USER_A)

    const conflictsA = await getConflicts(USER_A)
    expect(conflictsA).toHaveLength(0)

    const conflictsB = await getConflicts(USER_B)
    expect(conflictsB).toHaveLength(1)
  })

  it('clearAllConflicts clears every user conflicts', async () => {
    await saveConflict(USER_A, makeConflict({ conflictId: 'c1' }))
    await saveConflict(USER_B, makeConflict({ conflictId: 'c2', scope: 'user:u2' }))

    await clearAllConflicts()

    expect(await getConflicts(USER_A)).toHaveLength(0)
    expect(await getConflicts(USER_B)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

describe('fail-closed behavior', () => {
  it('saveConflict returns false for null userId', async () => {
    expect(await saveConflict(null, makeConflict())).toBe(false)
  })

  it('getConflicts returns [] for null userId', async () => {
    expect(await getConflicts(null)).toEqual([])
  })

  it('getConflict returns null for null conflictId', async () => {
    expect(await getConflict(USER_A, null)).toBeNull()
  })

  it('countUnresolvedConflicts returns 0 for null userId', async () => {
    expect(await countUnresolvedConflicts(null)).toBe(0)
  })
})