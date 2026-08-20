import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readOutboxOps,
  readOutboxSummary,
  summarizeOps,
  OUTBOX_STATUS,
  OUTBOX_SCOPE,
} from './offlineOutbox'

// M2 #159 — the defined outbox read interface.
//
// Before #292's durable outbox store exists, the read interface must FAIL
// CLOSED: `readOutboxOps` resolves to an empty queue (never a fabricated or
// silently-untracked mutation) and `readOutboxSummary` yields all-zero counts.
// The interface also must refuse a client-chosen/empty scope (server-resolved
// userId only) so it can never enumerate another user's queue.

describe('offlineOutbox — defined read interface (#159)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes the operation-status enum and collection scope contract', () => {
    expect(OUTBOX_STATUS).toEqual({
      PENDING: 'pending',
      CONFLICT: 'conflict',
      ERROR: 'error',
      SYNCED: 'synced',
    })
    expect(OUTBOX_SCOPE).toBe('collection')
  })

  it('readOutboxOps resolves to an empty queue before #292 (fail closed)', async () => {
    const ops = await readOutboxOps('u1')
    expect(ops).toEqual([])
  })

  it('readOutboxSummary resolves to all-zero counts before #292 (fail closed)', async () => {
    const summary = await readOutboxSummary('u1')
    expect(summary).toEqual({ pending: 0, conflict: 0, error: 0, synced: 0 })
  })

  it('refuses to read when the userId is missing/not a string (fail closed)', async () => {
    expect(await readOutboxOps('')).toEqual([])
    expect(await readOutboxOps(null)).toEqual([])
    expect(await readOutboxOps()).toEqual([])
    expect(await readOutboxSummary('')).toEqual({ pending: 0, conflict: 0, error: 0, synced: 0 })
  })

  it('summarizes counts from a mocked op list without exposing raw payloads', () => {
    // Simulate what #292's durable store will return. The UI only ever sees
    // counts + a safe status label — never a raw exception or private content.
    const summary = summarizeOps([
      { opId: 'op-1', status: OUTBOX_STATUS.PENDING, kind: 'add' },
      { opId: 'op-2', status: OUTBOX_STATUS.CONFLICT, kind: 'edit' },
      { opId: 'op-3', status: OUTBOX_STATUS.ERROR, kind: 'delete' },
      { opId: 'op-4', status: OUTBOX_STATUS.SYNCED, kind: 'add' },
      { opId: 'op-5', status: 'unknown-status' },
      null,
    ])
    expect(summary).toEqual({ pending: 1, conflict: 1, error: 1, synced: 1 })
  })
})
