import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCollection } from '../hooks/useCollection'
import { saveMirror, clearAllMirror } from '../utils/offlineMirror'
import {
  establishOfflineTrust,
  sessionFingerprint,
} from '../utils/offlineTrust'

// M2 #159 — fail-closed invariant: a failed ONLINE mutation must NEVER
// silently become an untracked local mutation (ADR-0016 rule 12, ADR-0019
// Dec 8). A rejected add/update/remove re-throws and leaves the in-memory
// items + the IndexedDB mirror exactly as they were — the UI never renders a
// phantom local state, and nothing is queued silently behind the user's back.

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

describe('useCollection — no silent fallback from a failed online mutation (#159)', () => {
  it('a failed online ADD re-throws and does not write an untracked local item', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    api.addItem.mockRejectedValue(new Error('Failed to fetch'))
    await saveMirror(USER.id, [], { now: Date.now() })

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let thrown = null
    await act(async () => {
      try {
        await result.current.add({ title: 'New' })
      } catch (e) { thrown = e }
    })

    // The online failure is surfaced (thrown), never swallowed into a local add.
    expect(thrown?.message).toBe('Failed to fetch')
    expect(result.current.items).toEqual([])

    // The mirror was NOT mutated silently.
    const mirror = await readMirror()
    expect(mirror.items).toEqual([])
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
