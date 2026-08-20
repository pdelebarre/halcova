// M2 #289 — the "showing offline copy" state in CollectionView.
//
// When useCollection hydrates from the IndexedDB mirror (source === 'offline',
// e.g. offline or a safe network failure on an offline-trusted device), the
// view must surface a clear, accessible note so the user knows they are
// browsing their last-known saved collection, not live data.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'
import { clearAllMirror, saveMirror } from '../utils/offlineMirror'
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
import * as api from '../api/collection'

const USER = { id: 'u1', name: 'Ada', role: 'member' }
const TOKEN = 'tok-a'
const ITEM = {
  id: 'r1',
  serverId: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  dateAdded: '2026-01-01T00:00:00Z',
}

beforeEach(async () => {
  localStorage.removeItem('runout.view.records')
  vi.clearAllMocks()
  await clearAllMirror()
})

function seedOfflineTrustedSession() {
  localStorage.setItem(
    'runout.session',
    JSON.stringify({ user: USER, session: TOKEN }),
  )
  establishOfflineTrust(USER, { sessionFp: sessionFingerprint(TOKEN) })
}

describe('CollectionView — showing offline copy (#289)', () => {
  it('renders a clear offline-copy note when the collection is hydrated from the mirror', async () => {
    seedOfflineTrustedSession()
    await saveMirror(USER.id, [ITEM], { now: Date.UTC(2026, 0, 1, 12, 0, 0) })
    // The live request fails (offline) — the hook falls back to the mirror.
    api.listItems.mockRejectedValue(new Error('Failed to fetch'))

    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />,
    )

    await waitFor(() =>
      expect(container.querySelectorAll('.album-card')).toHaveLength(1),
    )
    // The offline-copy note is surfaced to the user.
    await waitFor(() => expect(screen.getByText(/offline copy/i)).toBeTruthy())
  })

  it('does NOT show the offline-copy note when the collection is live', async () => {
    seedOfflineTrustedSession()
    api.listItems.mockResolvedValue([ITEM])

    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />,
    )
    await waitFor(() =>
      expect(container.querySelectorAll('.album-card')).toHaveLength(1),
    )

    expect(screen.queryByText(/offline copy/i)).toBeNull()
  })
})
