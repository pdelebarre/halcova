import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPanel from '../AdminPanel'
import Header from '../components/Header'
import * as authApi from '../api/auth'
import * as feedbackApi from '../api/feedback'

// Component tests mock the api modules (testing skill), never the network.
// The dashboard also mounts Header in the same file (pending badges, T3 #263),
// so both surfaces are covered together.
vi.mock('../api/auth', () => ({
  adminList: vi.fn(),
  adminDashboard: vi.fn(),
  adminApprove: vi.fn(),
  adminReject: vi.fn(),
  adminUpdateUser: vi.fn(),
  adminDeleteUser: vi.fn(),
  adminRotate: vi.fn(),
}))

vi.mock('../api/feedback', () => ({
  listFeedback: vi.fn(),
  updateFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
}))

// The counts shape from GET /admin?dashboard=1 (T1 backend, epic §4.1).
const COUNTS = {
  pendingRequests: 3,
  members: { total: 12, active: 11, disabled: 1 },
  signups: { today: 1, thisWeek: 4, thisMonth: 9, total: 12 },
  plans: { free: 9, premium: 2, lifetime: 1, unlimited: 0 },
  collections: { records: 214, books: 87 },
  feedback: { open: 5, in_progress: 2, done: 8, wontfix: 1, duplicate: 0, total: 16 },
  reviews: { total: 40, published: 36, pending: 2, hidden: 2 },
}

const REQUESTS = [
  { id: 'r1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-08-10T10:00:00Z' },
  { id: 'r2', name: 'Bob', email: 'bob@example.com', status: 'pending', createdAt: '2026-08-11T10:00:00Z' },
  { id: 'r3', name: 'Cat', email: 'cat@example.com', status: 'approved', createdAt: '2026-08-09T10:00:00Z' },
]

const USERS = [
  { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'member', status: 'active', plan: 'free', collections: { records: true } },
  { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member', status: 'disabled', plan: 'premium', collections: { records: true, books: true } },
]

function dashboardPayload(counts = COUNTS) {
  return { requests: REQUESTS, users: USERS, counts }
}

// The value inside a stat card's <dl>, scoped by its <dt> label so ambiguous
// numbers ("1", "2", "12") don't collide across cards.
function cardValue(label) {
  const card = screen.getByText(label).closest('dl')
  expect(card).not.toBeNull()
  return within(card)
}

async function openDashboardTab(user) {
  const tab = await screen.findByRole('tab', { name: 'Dashboard' })
  await user.click(tab)
  return tab
}

beforeEach(() => {
  vi.clearAllMocks()
  authApi.adminList.mockResolvedValue({ requests: REQUESTS, users: USERS })
  authApi.adminDashboard.mockResolvedValue(dashboardPayload())
  feedbackApi.listFeedback.mockResolvedValue([])
  // Two-step deletes mirror member delete; stubbed so jsdom never implements it.
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
})

describe('Admin dashboard (ADMIN-EPIC-1, #260)', () => {
  it('shows a Dashboard tab and renders aggregate stat cards from counts', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openDashboardTab(user)

    // Pending requests — the prominent full-width card.
    const pending = cardValue('Pending requests')
    expect(pending.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument()

    // Members section.
    expect(cardValue('Total members').getByText('12')).toBeInTheDocument()
    expect(cardValue('Active').getByText('11')).toBeInTheDocument()
    expect(cardValue('Disabled').getByText('1')).toBeInTheDocument()

    // Signups (today/week/month/total).
    expect(cardValue('Today').getByText('1')).toBeInTheDocument()
    expect(cardValue('This week').getByText('4')).toBeInTheDocument()
    expect(cardValue('This month').getByText('9')).toBeInTheDocument()

    // Plans (free/premium/lifetime/unlimited).
    expect(cardValue('Premium').getByText('2')).toBeInTheDocument()
    expect(cardValue('Lifetime').getByText('1')).toBeInTheDocument()
    expect(cardValue('Unlimited').getByText('0')).toBeInTheDocument()

    // Collection size.
    expect(cardValue('Records').getByText('214')).toBeInTheDocument()
    expect(cardValue('Books').getByText('87')).toBeInTheDocument()

    // Reviews.
    expect(cardValue('Published').getByText('36')).toBeInTheDocument()
    expect(cardValue('Pending').getByText('2')).toBeInTheDocument()

    // "Last updated" caption.
    expect(await screen.findByText(/Last updated/)).toBeInTheDocument()
  })

  it('shows skeleton cards while loading, then data once counts resolve', async () => {
    let resolveDashboard
    authApi.adminDashboard.mockReturnValue(new Promise((res) => { resolveDashboard = res }))
    const user = userEvent.setup()
    const { container } = render(<AdminPanel onClose={() => {}} />)
    await openDashboardTab(user)

    // Loading → skeleton grid (not the data yet).
    expect(container.querySelector('.admin-dash-skeleton')).not.toBeNull()
    expect(screen.queryByText('Total members')).not.toBeInTheDocument()

    resolveDashboard(dashboardPayload())
    expect(await screen.findByText('Total members')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.admin-dash-skeleton')).toBeNull())
  })

  it('shows an error with a retry when the dashboard fetch fails, then recovers', async () => {
    authApi.adminDashboard.mockRejectedValueOnce(new Error('dashboard exploded'))
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openDashboardTab(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('dashboard exploded')

    // Retry with a healthy response → data renders.
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Total members')).toBeInTheDocument()
  })

  it('shows the empty state when counts is missing from the payload', async () => {
    authApi.adminDashboard.mockResolvedValue({ requests: REQUESTS, users: USERS })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openDashboardTab(user)

    expect(await screen.findByText('No data yet.')).toBeInTheDocument()
  })

  it('renders 0 for malformed counts instead of throwing (no dark screen)', async () => {
    authApi.adminDashboard.mockResolvedValue({
      requests: REQUESTS,
      users: USERS,
      counts: { pendingRequests: 'not-a-number', members: null, signups: { today: 'x' }, plans: 'junk' },
    })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)
    await openDashboardTab(user)

    // Pending card coerces to 0.
    expect(cardValue('Pending requests').getByText('0')).toBeInTheDocument()
    // members: null → every member stat is 0.
    expect(cardValue('Total members').getByText('0')).toBeInTheDocument()
    expect(cardValue('Active').getByText('0')).toBeInTheDocument()
    // signups.today is a string → 0; missing keys → 0.
    expect(cardValue('Today').getByText('0')).toBeInTheDocument()
    // The panel stays mounted (no crash), even though the payload was junk.
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('shows a pending badge on the Members tab from data.requests (zero extra fetch)', async () => {
    render(<AdminPanel onClose={() => {}} />)

    // 2 pending requests (r1, r2) → badge appears on the tab, reusing the
    // already-loaded adminList data (adminDashboard is NOT called again).
    const tab = screen.getByRole('tab', { name: /Members/ })
    await waitFor(() => expect(tab).toHaveTextContent('2'))
    expect(authApi.adminDashboard).toHaveBeenCalledTimes(1) // dashboard mount fetch only
  })

  it('hides the Members-tab badge when there are no pending requests', async () => {
    authApi.adminList.mockResolvedValue({ requests: [], users: USERS })
    render(<AdminPanel onClose={() => {}} />)

    const tab = screen.getByRole('tab', { name: 'Members' })
    await waitFor(() => expect(tab.querySelector('.admin-badge')).toBeNull())
  })
})

describe('Admin pending badges in Header (ADMIN-EPIC-1, #263)', () => {
  function headerProps(overrides = {}) {
    return {
      tabs: [
        { id: 'records', label: 'Records' },
        { id: 'books', label: 'Books' },
      ],
      activeTab: 'records',
      onTabChange: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenAdmin: vi.fn(),
      onOpenCredits: vi.fn(),
      showAdmin: true,
      user: { id: 'owner', name: 'Admin', role: 'admin' },
      pendingCount: 0,
      onLogout: vi.fn(),
      ...overrides,
    }
  }

  it('hides both badges when the pending count is 0', () => {
    render(<Header {...headerProps()} />)

    const avatar = screen.getByRole('button', { name: 'Account: Admin' })
    expect(avatar.querySelector('.admin-badge')).toBeNull()

    fireEvent.click(avatar)
    const item = screen.getByRole('menuitem', { name: 'Admin panel' })
    expect(item.querySelector('.admin-badge')).toBeNull()
  })

  it('shows the badge on the avatar chip and the Admin panel menuitem at N', () => {
    render(<Header {...headerProps({ pendingCount: 3 })} />)

    const avatar = screen.getByRole('button', { name: /Account: Admin/ })
    const chipBadge = avatar.querySelector('.admin-badge.avatar-badge')
    expect(chipBadge).not.toBeNull()
    expect(chipBadge).toHaveTextContent('3')
    expect(chipBadge).toHaveAttribute('aria-label', '3 pending requests')

    fireEvent.click(avatar)
    const item = screen.getByRole('menuitem', { name: /Admin panel/ })
    const menuBadge = item.querySelector('.admin-badge.menu-badge')
    expect(menuBadge).not.toBeNull()
    expect(menuBadge).toHaveTextContent('3')
    expect(menuBadge).toHaveAttribute('aria-label', '3 pending requests')
  })

  it('announces the count in the avatar aria-label (screen-reader safe)', () => {
    render(<Header {...headerProps({ pendingCount: 5 })} />)
    expect(screen.getByRole('button', { name: 'Account: Admin — 5 pending requests' })).toBeInTheDocument()
  })

  it('never shows the badge for non-admins even with a count', () => {
    render(<Header {...headerProps({ showAdmin: false, pendingCount: 2, user: { id: 'u1', name: 'Ada', role: 'member' } })} />)
    const avatar = screen.getByRole('button', { name: 'Account: Ada' })
    expect(avatar.querySelector('.admin-badge')).toBeNull()
  })

  it('decrements the badge after an approve drops the count', () => {
    const { rerender } = render(<Header {...headerProps({ pendingCount: 2 })} />)
    expect(screen.getByRole('button', { name: 'Account: Admin — 2 pending requests' })).toBeInTheDocument()

    // After approving one request, App re-fetches and passes 1 down.
    rerender(<Header {...headerProps({ pendingCount: 1 })} />)
    expect(screen.getByRole('button', { name: 'Account: Admin — 1 pending requests' })).toBeInTheDocument()
  })
})
