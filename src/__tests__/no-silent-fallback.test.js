import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCollection } from '../hooks/useCollection'
import { saveMirror, clearAllMirror } from '../utils/offlineMirror'
import { clearAllOutbox, listPendingOps } from '../utils/outbox'
import {
  establishOfflineTrust,
  sessionFingerprint,
} from '../utils/offlineTrust'

// M2 #159 + #292 — fail-closed invariant: a failed ONLINE mutation must NEVER
// silently become an UNTRACKED local mutation (ADR-0016 rule 12, ADR-0019
// Dec 8). Since #292, a SAFE online failure (offline/5xx/network) STAGES the
// add as a TRACKED outbox op with an explicit pending state ("saved on this
// device, waiting to sync") — tracked, never silent, never dropped. A confirmed
// AUTH failure (401/403) re-throws and writes NOTHING (fail closed — a revoked
// session never stages offline). Update/delete are M3 and never stage: a failed
// online update/delete re-throws and reverts (no silent local edit/removal).

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))
vi.mock('../api/lending', () => ({ lend: vi.fn(), returnItem: vi.fn() }))
import * as api from '../api/collection'

const USER = { id: 'u1', name: 'Ada', role: 'member' }
const TOKEN = 'tok-a'
const KIND_OF_BLUE = {
  id: 'r1',
  serverId: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
}

beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  await clearAllMirror()
  await clearAllOutbox()
})

function seedSession() {
  localStorage.setItem(
    'runout.session',
    JSON.stringify({ user: USER, session: TOKEN }),
  )
  establishOfflineTrust(USER, { sessionFp: sessionFingerprint(TOKEN) })
}

async function readMirror() {
  const { readMirror } = await import('../utils/offlineMirror')
  return readMirror(USER.id, { token: TOKEN })
}

describe('useCollection — no silent fallback from a failed online mutation (#159/#292)', () => {
  it('a SAFE online ADD failure stages a TRACKED op (not silent, not dropped)', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    api.addItem.mockRejectedValue(new Error('Failed to fetch'))
    await saveMirror(USER.id, [], { now: Date.now() })

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let staged
    await act(async () => {
      staged = await result.current.add({ title: 'New', year: 2020 })
    })

    // The capture is not lost: it is staged as an explicit TRACKED pending add.
    expect(staged.metadataPending).toBe(true)
    expect(result.current.items[0].title).toBe('New')
    expect(result.current.pendingCount).toBe(1)
    // A durable outbox op exists (the mutation is tracked, never silent).
    const ops = await listPendingOps(USER.id, { token: TOKEN })
    expect(ops).toHaveLength(1)
    expect(ops[0].pendingItem.metadataPending).toBe(true)
    // The mirror holds the pending item so it survives reload.
    const mirror = await readMirror()
    expect(mirror.items.map((i) => i.title)).toContain('New')
  })

  it('an AUTH online ADD failure (401) re-throws and stages NOTHING (fail closed)', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    const err = new Error('Unauthorized')
    err.status = 401
    api.addItem.mockRejectedValue(err)

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let thrown = null
    await act(async () => {
      try {
        await result.current.add({ title: 'Nope', year: 2000 })
      } catch (e) { thrown = e }
    })

    // A revoked session never stages offline — the mutation re-throws.
    expect(thrown?.message).toBe('Unauthorized')
    expect(result.current.items).toEqual([])
    expect(result.current.pendingCount).toBe(0)
    expect(await listPendingOps(USER.id, { token: TOKEN })).toEqual([])
  })

  it('a failed online UPDATE re-throws and reverts to the previous state (no silent local edit)', async () => {
    seedSession()
    api.listItems.mockResolvedValue([KIND_OF_BLUE])
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = result.current.items

    api.updateItem.mockRejectedValue(new Error('Failed to fetch'))
    let thrown = null
    await act(async () => {
      try {
        await result.current.update('r1', { notes: 'changed offline' })
      } catch (e) { thrown = e }
    })

    expect(thrown?.message).toBe('Failed to fetch')
    // State reverted — the optimistic local edit is rolled back, not kept as an
    // untracked mutation.
    expect(result.current.items).toEqual(before)
    expect(result.current.items[0].notes).toBeUndefined()
  })

  it('a failed online DELETE re-throws and does not remove the item locally', async () => {
    seedSession()
    api.listItems.mockResolvedValue([KIND_OF_BLUE])
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    api.deleteItem.mockRejectedValue(new Error('Failed to fetch'))
    let thrown = null
    await act(async () => {
      try {
        await result.current.remove('r1')
      } catch (e) { thrown = e }
    })

    expect(thrown?.message).toBe('Failed to fetch')
    // The item is still present — a failed online delete never silently removes
    // it from the local view.
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe('r1')
  })
})
