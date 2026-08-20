import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import SyncStatus from '../components/SyncStatus'
import { readOutboxSummary } from '../utils/offlineOutbox'

// M2 #159 — offline sync-status UX states.
//
// Covers the visible offline / pending(queued) / conflict-or-error states, the
// "Sync now" manual control, and the invariant that the status UI never
// fabricates an untracked pending mutation. Security: rendered messages are
// static localized strings — no raw exception/private content is ever shown.

vi.mock('../utils/offlineOutbox', () => ({
  readOutboxSummary: vi.fn(),
}))

// Mirrors getSession() for the hook (reads runout.session).
function seedSession(userId = 'u1') {
  localStorage.setItem('runout.session', JSON.stringify({ user: { id: userId }, session: 'tok' }))
}

function setOnLine(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

function renderStatus(props = {}) {
  return render(
    <LocaleProvider>
      <SyncStatus {...props} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  setOnLine(true)
  setLocale('en')
  localStorage.clear()
  vi.clearAllMocks()
})

describe('SyncStatus — offline sync states (#159)', () => {
  it('renders nothing when live, online and nothing pending (avoid always-on noise)', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 0, conflict: 0, error: 0, synced: 0 })
    const { container } = renderStatus({ source: 'live', onSyncNow: vi.fn() })
    expect(container.querySelector('.sync-status')).toBeNull()
  })

  it('shows the offline-copy note when browsing from the mirror', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 0, conflict: 0, error: 0, synced: 0 })
    renderStatus({
      source: 'offline',
      mirroredAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)).toISOString(),
      onSyncNow: vi.fn(),
    })
    expect(await screen.findByText(/offline copy/i)).toBeInTheDocument()
  })

  it('surfaces "All changes synced" after a successful queue drain (online, nothing pending)', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 0, conflict: 0, error: 0, synced: 0 })
    renderStatus({ source: 'offline', onSyncNow: vi.fn() })
    expect(await screen.findByText(/all changes synced/i)).toBeInTheDocument()
  })

  it('does NOT claim "all changes synced" while offline with nothing pending', async () => {
    seedSession()
    setOnLine(false)
    readOutboxSummary.mockResolvedValue({ pending: 0, conflict: 0, error: 0, synced: 0 })
    renderStatus({ source: 'offline', onSyncNow: vi.fn() })
    expect(await screen.findByText(/offline copy/i)).toBeInTheDocument()
    expect(screen.queryByText(/all changes synced/i)).toBeNull()
  })

  it('shows a queued "pending" state with a count when operations are waiting', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 3, conflict: 0, error: 0, synced: 0 })
    renderStatus({ source: 'offline', onSyncNow: vi.fn() })
    expect(await screen.findByText(/3 change\(s\) saved on this device, waiting to sync/i)).toBeInTheDocument()
  })

  it('explains queued actions sync on reconnect when offline with pending ops', async () => {
    seedSession()
    setOnLine(false)
    readOutboxSummary.mockResolvedValue({ pending: 1, conflict: 0, error: 0, synced: 0 })
    renderStatus({ source: 'offline', onSyncNow: vi.fn() })
    expect(await screen.findByText(/sync when you're back online/i)).toBeInTheDocument()
  })

  it('shows a conflict/error "needs attention" state with a safe generic message', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 0, conflict: 1, error: 0, synced: 0 })
    renderStatus({ source: 'offline', onSyncNow: vi.fn() })
    expect(await screen.findByText(/couldn't sync/i)).toBeInTheDocument()
    // The message is generic and safe — never a raw exception/token/secret.
    expect(screen.queryByText(/token|secret|access code|Bearer/i)).toBeNull()
  })

  it('offers a manual "Sync now" control when there is something to sync', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 2, conflict: 0, error: 0, synced: 0 })
    const onSyncNow = vi.fn()
    renderStatus({ source: 'offline', onSyncNow })
    const button = await screen.findByRole('button', { name: /sync now/i })
    fireEvent.click(button)
    expect(onSyncNow).toHaveBeenCalledTimes(1)
  })

  it('does NOT render a manual sync control when nothing is pending/needs attention', async () => {
    seedSession()
    readOutboxSummary.mockResolvedValue({ pending: 0, conflict: 0, error: 0, synced: 0 })
    const onSyncNow = vi.fn()
    renderStatus({ source: 'offline', onSyncNow })
    expect(await screen.findByText(/offline copy/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull()
  })
})
