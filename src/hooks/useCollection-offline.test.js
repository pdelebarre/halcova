// M2 #289 — useCollection offline-mirror hydration.
//
// Verifies the mirror hydration contract:
//   - a SUCCESSFUL live fetch returns live data (source 'live') and writes it
//     back to the mirror (so the next offline launch has the last-known list);
//   - a SAFE network failure (offline / 5xx / network) with a live offline-trust
//     grant hydrates from the mirror (source 'offline') and surfaces a
//     "showing offline copy" state with the cachedAt stamp;
//   - a confirmed AUTH failure (401/403) NEVER falls back to the mirror (fail
//     closed — a revoked session must not render cached private data).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCollection } from './useCollection'
import { saveMirror } from '../utils/offlineMirror'
import {
  establishOfflineTrust,
  sessionFingerprint,
} from '../utils/offlineTrust'

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))
vi.mock('../api/lending', () => ({ lend: vi.fn(), returnItem: vi.fn() }))
import * as api from '../api/collection'

import { clearAllMirror } from '../utils/offlineMirror'
import { clearAllOutbox } from '../utils/outbox'

const USER = { id: 'u1', name: 'Ada', role: 'member' }
const TOKEN = 'tok-a'
const KIND_OF_BLUE = {
  id: 'r1',
  serverId: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
}
const IN_A_SILENT_WAY = {
  id: 'r2',
  serverId: 'r2',
  title: 'Miles Davis - In a Silent Way',
  year: 1969,
  formatType: 'LP',
}

beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  await clearAllMirror()
  await clearAllOutbox()
})

// Seed a signed-in session + a live M2 'collection'-scope trust grant.
function seedSession() {
  localStorage.setItem(
    'runout.session',
    JSON.stringify({ user: USER, session: TOKEN }),
  )
  establishOfflineTrust(USER, { sessionFp: sessionFingerprint(TOKEN) })
}

describe('useCollection offline-mirror hydration (#289)', () => {
  it('a live fetch succeeds with source "live" and writes the list to the mirror', async () => {
    seedSession()
    api.listItems.mockResolvedValue([KIND_OF_BLUE])

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.source).toBe('live')
    expect(result.current.items).toEqual([KIND_OF_BLUE])
    // The fresh list was written to the mirror for offline reuse.
    const mirror = await readMirrorForUser()
    expect(mirror.items).toHaveLength(1)
  })

  it('hydrates from the mirror (source "offline") on a safe network failure when offline-trusted', async () => {
    seedSession()
    // A trusted offline device has the last-known list cached locally.
    await saveMirror(USER.id, [KIND_OF_BLUE, IN_A_SILENT_WAY], {
      now: Date.UTC(2026, 0, 1, 12, 0, 0),
    })
    // The live request fails with a network error (safe to hydrate).
    api.listItems.mockRejectedValue(new Error('Failed to fetch'))

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.source).toBe('offline')
    expect(result.current.items.map((i) => i.title)).toEqual([
      'Miles Davis - Kind of Blue',
      'Miles Davis - In a Silent Way',
    ])
    expect(result.current.mirroredAt).toBe(
      new Date(Date.UTC(2026, 0, 1, 12, 0, 0)).toISOString(),
    )
  })

  it('hydrates from the mirror on a server error (5xx) — a safe failure', async () => {
    seedSession()
    await saveMirror(USER.id, [KIND_OF_BLUE], { now: Date.now() })
    const err = new Error('Server Error')
    err.status = 500
    api.listItems.mockRejectedValue(err)

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.source).toBe('offline')
    expect(result.current.items.map((i) => i.id)).toEqual(['r1'])
  })

  it('NEVER hydrates on a confirmed auth failure (401) — fails closed', async () => {
    seedSession()
    await saveMirror(USER.id, [KIND_OF_BLUE], { now: Date.now() })
    const err = new Error('Unauthorized')
    err.status = 401
    api.listItems.mockRejectedValue(err)

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    // The mirror data is NOT surfaced for a revoked session.
    expect(result.current.items).toEqual([])
    expect(result.current.source).toBeNull()
  })

  it('falls back to error (not an empty mirror) when offline-trust is missing', async () => {
    // Signed in, but NO offline-trust grant → readMirror fails closed.
    localStorage.setItem(
      'runout.session',
      JSON.stringify({ user: USER, session: TOKEN }),
    )
    await saveMirror(USER.id, [KIND_OF_BLUE], { now: Date.now() })
    api.listItems.mockRejectedValue(new Error('Failed to fetch'))

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.items).toEqual([])
    expect(result.current.source).toBeNull()
  })

  it('surfaces the error (not a silent empty view) when offline and no mirror exists', async () => {
    seedSession()
    api.listItems.mockRejectedValue(new Error('Failed to fetch'))

    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.items).toEqual([])
    expect(result.current.error).toBe('Failed to fetch')
  })

  it('a successful refresh() writes fresh data to the mirror for the next offline launch', async () => {
    seedSession()
    api.listItems.mockResolvedValue([KIND_OF_BLUE])
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    // Simulate the server-side list changing, then refresh.
    api.listItems.mockResolvedValue([IN_A_SILENT_WAY])
    await act(async () => {
      await result.current.refresh()
    })

    const mirror = await readMirrorForUser()
    expect(mirror.items.map((i) => i.id)).toEqual(['r2'])
    expect(result.current.source).toBe('live')
  })
})

describe('useCollection offline add + reconnect flush (#292)', () => {
  it('stages an offline add into the outbox + mirror with a pending state', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    // Force the browser to report offline.
    const originalOnLine = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

    let pendingItem
    await act(async () => {
      pendingItem = await result.current.add({
        title: 'Miles Davis - In a Silent Way',
        year: 1969,
        barcode: '88985371092',
      })
    })

    // Restore the online flag.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnLine })

    // The item came back immediately with an explicit pending state.
    expect(pendingItem.metadataPending).toBe(true)
    expect(pendingItem.uuid).toMatch(/^local:/)
    expect(result.current.items[0].title).toBe('Miles Davis - In a Silent Way')
    // A durable outbox op was staged.
    expect(result.current.pendingCount).toBe(1)
    const { listPendingOps } = await import('../utils/outbox')
    const ops = await listPendingOps(USER.id, { token: TOKEN })
    expect(ops).toHaveLength(1)
    expect(ops[0].opId).toBe(pendingItem.uuid)
    expect(ops[0].pendingItem.metadataPending).toBe(true)
    // The mirror also holds the pending item (durable across reload).
    const mirror = await readMirrorForUser()
    expect(mirror.items.map((i) => i.title)).toContain('Miles Davis - In a Silent Way')
  })

  it('bumps mutationSeq after a mutation so the SyncStatus strip re-reads the outbox (#159)', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.mutationSeq).toBe(0)

    const originalOnLine = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

    await act(async () => {
      await result.current.add({ title: 'Queued While Offline', year: 2020 })
    })

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnLine })

    // The mutation counter bumped, and the durable pending count reflects it —
    // so the sync-status strip reflects the real queue state.
    expect(result.current.mutationSeq).toBe(1)
    expect(result.current.pendingCount).toBe(1)
  })

  it('flushOutbox pushes the staged op idempotently and clears the pending state', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const originalOnLine = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    let pendingItem
    await act(async () => {
      pendingItem = await result.current.add({ title: 'Miles Davis - In a Silent Way', year: 1969 })
    })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnLine })

    expect(result.current.pendingCount).toBe(1)

    // Reconnect: the server accepts the add; a fresh list comes back.
    const serverItem = {
      id: 'srv-1',
      serverId: 'srv-1',
      title: 'Miles Davis - In a Silent Way',
      year: 1969,
    }
    api.addItem.mockResolvedValue(serverItem)
    api.listItems.mockResolvedValue([serverItem])

    let res
    await act(async () => { res = await result.current.flushOutbox() })

    expect(res.pushed).toBe(1)
    expect(res.failed).toBe(0)
    // The push used the STABLE idempotency key (no duplicate on retry).
    expect(api.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Miles Davis - In a Silent Way' }),
      'records',
      { clientOpId: pendingItem.uuid },
    )
    await waitFor(() => expect(result.current.pendingCount).toBe(0))
    // The item is now server-backed in the refreshed list.
    await waitFor(() => expect(result.current.items[0].id).toBe('srv-1'))
    // A successful Sync-now bumps the flush seq so the SyncStatus strip
    // (useOfflineSyncStatus, deps [online, syncId]) re-reads the now-empty
    // outbox and reaches the "All changes synced" state instead of showing a
    // stale "waiting to sync" (#159). The add already bumped it to 1.
    await waitFor(() => expect(result.current.mutationSeq).toBe(2))
  })

  it('falls back to the outbox on a safe network failure while online', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    api.addItem.mockRejectedValue(new Error('Failed to fetch'))
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.add({ title: 'Safe Fallback', year: 1970 })
    })

    expect(result.current.pendingCount).toBe(1)
  })

  it('NEVER stages offline on a confirmed auth failure (fail closed)', async () => {
    seedSession()
    api.listItems.mockResolvedValue([])
    const err = new Error('Unauthorized')
    err.status = 401
    api.addItem.mockRejectedValue(err)
    const { result } = renderHook(() => useCollection('records'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.add({ title: 'Nope', year: 2000 })).rejects.toThrow('Unauthorized')
    })
    // Nothing was staged — a revoked session must not queue offline mutations.
    expect(result.current.pendingCount).toBe(0)
  })
})

// Read the mirror back for the seeded user using its own gated API.
async function readMirrorForUser() {
  const { readMirror } = await import('../utils/offlineMirror')
  return readMirror(USER.id, { token: TOKEN })
}
