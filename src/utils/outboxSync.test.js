// M2 #292 — Outbox flush + reconcile tests.
//
// Verifies the minimal idempotent push + reconcile contract (ADR-0019 Dec 7):
//   - pending/failed ops are pushed with their stable idempotency key;
//   - a successful push marks the op flushed and reconciles the mirror;
//   - a rejected/failed push marks the op failed but keeps it durable +
//     retryable and surfaces the error (ADR-0016 rule 12, fail-closed);
//   - the idempotency key is passed through to the push (server dedupe).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPendingOps } from './outboxSync'

const USER_ID = 'u1'
const TOKEN = 'tok-a'
const OP_ID = 'local:11111111-2222-4333-8444-555555555555'
const SERVER_ITEM = { id: 'srv-1', serverId: 'srv-1', title: 'Kind of Blue', year: 1959 }

function pendingOp(overrides = {}) {
  return {
    opId: OP_ID,
    scope: 'user:u1',
    kind: 'add',
    collection: 'records',
    pendingItem: { title: 'Kind of Blue', year: 1959, uuid: OP_ID },
    state: 'pending',
    attempts: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('flushPendingOps — minimal idempotent push + reconcile', () => {
  it('pushes pending ops with their idempotency key and marks them flushed', async () => {
    const push = vi.fn().mockResolvedValue(SERVER_ITEM)
    const markFlushedFn = vi.fn().mockResolvedValue({ state: 'flushed' })
    const saveMirrorFn = vi.fn().mockResolvedValue(true)
    const listAll = vi.fn().mockResolvedValue([SERVER_ITEM])

    const result = await flushPendingOps({
      userId: USER_ID,
      token: TOKEN,
      listPending: async () => [pendingOp()],
      push,
      markFlushedFn,
      saveMirrorFn,
      listAll,
      now: 1,
    })

    expect(result).toEqual({ attempted: 1, pushed: 1, failed: 0, failedOps: [] })
    // The push received the STABLE idempotency key.
    expect(push).toHaveBeenCalledWith(
      pendingOp().pendingItem,
      'records',
      { clientOpId: OP_ID },
    )
    expect(markFlushedFn).toHaveBeenCalledWith(USER_ID, OP_ID, SERVER_ITEM, { now: 1, token: TOKEN })
    // The mirror was reconciled after a successful push.
    expect(saveMirrorFn).toHaveBeenCalledWith(USER_ID, [SERVER_ITEM], { now: 1 })
  })

  it('marks a failed push as failed, keeps it retryable, and surfaces the error', async () => {
    const push = vi.fn().mockRejectedValue(new Error('flaky reconnect'))
    const markFailedFn = vi.fn().mockResolvedValue({ state: 'failed' })
    const saveMirrorFn = vi.fn().mockResolvedValue(true)

    const result = await flushPendingOps({
      userId: USER_ID,
      token: TOKEN,
      listPending: async () => [pendingOp()],
      push,
      markFailedFn,
      saveMirrorFn,
      now: 1,
    })

    expect(result.attempted).toBe(1)
    expect(result.pushed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failedOps).toEqual([{ opId: OP_ID, message: 'flaky reconnect' }])
    expect(markFailedFn).toHaveBeenCalledWith(USER_ID, OP_ID, 'flaky reconnect', { now: 1, token: TOKEN })
    // No reconcile when nothing was pushed.
    expect(saveMirrorFn).not.toHaveBeenCalled()
  })

  it('rejects out-of-matrix ops and surfaces them (no silent discard)', async () => {
    const push = vi.fn().mockRejectedValue(new Error('conflict'))
    const markFailedFn = vi.fn().mockResolvedValue({ state: 'failed' })

    const result = await flushPendingOps({
      userId: USER_ID,
      token: TOKEN,
      listPending: async () => [pendingOp({ opId: 'local:zzzz' })],
      push,
      markFailedFn,
      now: 1,
    })

    expect(result.failed).toBe(1)
    expect(result.failedOps[0].opId).toBe('local:zzzz')
  })

  it('does not reconcile when no op was pushed', async () => {
    const saveMirrorFn = vi.fn().mockResolvedValue(true)
    const result = await flushPendingOps({
      userId: USER_ID,
      token: TOKEN,
      listPending: async () => [pendingOp()],
      push: vi.fn().mockRejectedValue(new Error('down')),
      saveMirrorFn,
      now: 1,
    })
    expect(result.pushed).toBe(0)
    expect(saveMirrorFn).not.toHaveBeenCalled()
  })
})
