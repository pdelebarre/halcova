// M2 #292 — useOutboxSync reconnect-flush hook tests.
//
// Verifies the foreground-only reconnect trigger:
//   - flush() pushes staged outbox ops (idempotent key) and reconciles the
//     mirror, clearing the pending count;
//   - a failing flush keeps the op pending, surfaces syncState 'error', and the
//     pending count stays > 0 (ADR-0016 rule 12);
//   - onSynced fires after a flush that pushed at least one op.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useOutboxSync } from './useOutboxSync'
import { stageAdd } from '../utils/outbox'
import { clearAllOutbox } from '../utils/outbox'
import { clearAllMirror } from '../utils/offlineMirror'
import { establishOfflineTrust, sessionFingerprint } from '../utils/offlineTrust'

vi.mock('../api/collection', () => ({
  addItem: vi.fn(),
  listItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))
import * as api from '../api/collection'

const USER = { id: 'u1', name: 'Ada', role: 'member' }
const TOKEN = 'tok-a'
const ITEM = { title: 'Kind of Blue', year: 1959 }

beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  await clearAllOutbox()
  await clearAllMirror()
  localStorage.setItem('runout.session', JSON.stringify({ user: USER, session: TOKEN }))
  establishOfflineTrust(USER, { sessionFp: sessionFingerprint(TOKEN) })
})

describe('useOutboxSync — foreground reconnect flush', () => {
  it('flushes staged ops, reconciles, and clears the pending count', async () => {
    const op = await stageAdd(USER.id, { item: ITEM, token: TOKEN })
    expect(op).not.toBeNull()

    const serverItem = { id: 'srv-1', serverId: 'srv-1', title: ITEM.title, year: ITEM.year }
    api.addItem.mockResolvedValue(serverItem)
    api.listItems.mockResolvedValue([serverItem])
    const onSynced = vi.fn()

    const { result } = renderHook(() => useOutboxSync({ collection: 'records', onSynced }))
    await waitFor(() => expect(result.current.pendingCount).toBe(1))

    let res
    await act(async () => { res = await result.current.flush() })

    expect(res.pushed).toBe(1)
    expect(res.failed).toBe(0)
    expect(api.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: ITEM.title }),
      'records',
      { clientOpId: op.opId },
    )
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.syncState).toBe('idle')
    expect(onSynced).toHaveBeenCalled()
  })

  it('a failing flush keeps the op pending and surfaces syncState error', async () => {
    await stageAdd(USER.id, { item: ITEM, token: TOKEN })
    api.addItem.mockRejectedValue(new Error('flaky reconnect'))
    api.listItems.mockResolvedValue([ITEM])

    const { result } = renderHook(() => useOutboxSync({ collection: 'records' }))
    await waitFor(() => expect(result.current.pendingCount).toBe(1))

    let res
    await act(async () => { res = await result.current.flush() })

    expect(res.pushed).toBe(0)
    expect(res.failed).toBe(1)
    expect(result.current.syncState).toBe('error')
    // The op stays durable + retryable (never silently discarded).
    expect(result.current.pendingCount).toBe(1)
  })

  it('flush is a safe no-op when there is no session', async () => {
    localStorage.clear()
    const { result } = renderHook(() => useOutboxSync({ collection: 'records' }))
    let res
    await act(async () => { res = await result.current.flush() })
    expect(res).toEqual({ attempted: 0, pushed: 0, failed: 0, failedOps: [] })
  })
})
