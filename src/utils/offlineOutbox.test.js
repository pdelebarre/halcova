import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  readOutboxOps,
  readOutboxSummary,
  summarizeOps,
  OUTBOX_STATUS,
  OUTBOX_SCOPE,
} from './offlineOutbox'
import { stageAdd, clearAllOutbox, markFailed } from './outbox'
import {
  establishOfflineTrust,
  sessionFingerprint,
} from './offlineTrust'

// M2 #159 — the outbox read interface, wired to the REAL #292 durable outbox.
//
// The UI reads pending/error counts from the actual IndexedDB outbox (not a
// fail-closed empty stub): staging an offline add makes the summary report a
// real `pending: 1`, and a read op NEVER carries a raw payload (only the safe
// { opId, status, kind } shape — ADR-0019 Dec 12). It still FAILS CLOSED for a
// missing/empty scope or a missing/expired mutation trust grant (zeros, never
// a throw, never another user's queue).

const USER = { id: 'u1', name: 'Ada', role: 'member' }
const TOKEN = 'tok-a'
const ITEM = { title: 'Kind of Blue', year: 1959 }

beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  await clearAllOutbox()
})

// Seed a signed-in session + a live M2 'mutation'-scope offline-trust grant so
// the outbox reads/writes are permitted (fail-closed otherwise).
function seedTrustedSession() {
  localStorage.setItem(
    'runout.session',
    JSON.stringify({ user: USER, session: TOKEN }),
  )
  establishOfflineTrust(USER, { sessionFp: sessionFingerprint(TOKEN) })
}

describe('offlineOutbox — read interface over the real #292 outbox (#159)', () => {
  it('exposes the operation-status enum and collection scope contract', () => {
    expect(OUTBOX_STATUS).toEqual({
      PENDING: 'pending',
      CONFLICT: 'conflict',
      ERROR: 'error',
      SYNCED: 'synced',
    })
    expect(OUTBOX_SCOPE).toBe('collection')
  })

  it('reads a real pending count from the durable outbox after staging an add', async () => {
    seedTrustedSession()
    const op = await stageAdd(USER.id, { item: ITEM, token: TOKEN })
    expect(op).not.toBeNull()

    const summary = await readOutboxSummary(USER.id)
    expect(summary).toEqual({ pending: 1, conflict: 0, error: 0, synced: 0 })
  })

  it('surfaces only the safe { opId, status, kind } shape — never a raw payload', async () => {
    seedTrustedSession()
    const op = await stageAdd(USER.id, { item: ITEM, barcode: '123', token: TOKEN })
    expect(op).not.toBeNull()

    const ops = await readOutboxOps(USER.id)
    expect(ops).toHaveLength(1)
    // The surfaced op is the minimal safe shape — no pendingItem, barcode,
    // ocrText, lastError, token, or secret is exposed to the UI.
    expect(ops[0]).toEqual({ opId: expect.any(String), status: 'pending', kind: 'add' })
    expect(Object.keys(ops[0]).sort()).toEqual(['kind', 'opId', 'status'])
  })

  it('surfaces a real ERROR count after a failed push (markFailed -> error, #159/#292)', async () => {
    seedTrustedSession()
    const op = await stageAdd(USER.id, { item: ITEM, token: TOKEN })
    expect(op).not.toBeNull()
    // Simulate the sync engine failing to push this op (kept durable/retryable).
    await markFailed(USER.id, op.opId, 'flaky reconnect', { token: TOKEN })

    // The read interface maps the durable `failed` state to the ERROR attention
    // status (not PENDING), against the REAL outbox — not a mocked op list.
    const summary = await readOutboxSummary(USER.id)
    expect(summary).toEqual({ pending: 0, conflict: 0, error: 1, synced: 0 })

    const ops = await readOutboxOps(USER.id)
    expect(ops).toHaveLength(1)
    expect(ops[0].status).toBe(OUTBOX_STATUS.ERROR)
    expect(ops[0].opId).toBe(op.opId)
    // Still the safe shape — never a raw error/secret payload.
    expect(Object.keys(ops[0]).sort()).toEqual(['kind', 'opId', 'status'])
  })

  it('fails closed (zeros) when no session user / no trust grant', async () => {
    // No trust grant seeded at all.
    expect(await readOutboxSummary('')).toEqual({ pending: 0, conflict: 0, error: 0, synced: 0 })
    expect(await readOutboxOps(null)).toEqual([])
    expect(await readOutboxOps()).toEqual([])
  })

  it('fails closed for a user without a live mutation-trust grant', async () => {
    // Signed in, but NO offline-trust grant → listPendingOps fails closed.
    localStorage.setItem(
      'runout.session',
      JSON.stringify({ user: USER, session: TOKEN }),
    )
    const summary = await readOutboxSummary(USER.id)
    expect(summary).toEqual({ pending: 0, conflict: 0, error: 0, synced: 0 })
  })

  it('summarizes counts from a mocked op list without exposing raw payloads', () => {
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
