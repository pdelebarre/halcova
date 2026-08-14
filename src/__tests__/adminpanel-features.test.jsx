import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPanel from '../AdminPanel'
import * as authApi from '../api/auth'

vi.mock('../api/auth', () => ({
  adminList: vi.fn(),
  adminApprove: vi.fn(),
  adminReject: vi.fn(),
  adminUpdateUser: vi.fn(),
  adminDeleteUser: vi.fn(),
}))

const PENDING = { id: 'req-1', name: 'Ada', email: 'ada@example.com', status: 'pending', createdAt: '2026-01-01T00:00:00Z' }

// The member row's feature toggles read `user.features` — the per-account
// capability map ({ lending, games }) that adminUpdateUser replaces wholesale.
function makeMember(features) {
  return {
    id: 'u1',
    name: 'Bob',
    email: 'bob@example.com',
    role: 'member',
    status: 'active',
    collections: { records: true, books: false },
    features,
    plan: 'free',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authApi.adminList.mockResolvedValue({ requests: [PENDING], users: [] })
  authApi.adminApprove.mockResolvedValue({ user: { ...makeMember({}), code: 'RU-1111-2222-3333' } })
})

describe('Admin per-account features (lending + games)', () => {
  it('approving a request always sends the FULL features map (both flags)', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: 'Generate access code' }))

    await waitFor(() => expect(authApi.adminApprove).toHaveBeenCalled())
    // Defaults: neither feature granted, but both keys present — so the
    // server's sanitizeFeatures never drops a flag from the map.
    expect(authApi.adminApprove).toHaveBeenCalledWith(
      expect.objectContaining({ features: { lending: false, games: false } })
    )
  })

  it('lets the admin grant the games entitlement at approval time', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('switch', { name: 'Games' }))
    expect(screen.getByRole('switch', { name: 'Games' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: 'Generate access code' }))
    await waitFor(() => expect(authApi.adminApprove).toHaveBeenCalled())
    expect(authApi.adminApprove).toHaveBeenCalledWith(
      expect.objectContaining({ features: { lending: false, games: true } })
    )
  })

  it('member-row games toggle sends the full map (lending preserved)', async () => {
    authApi.adminList.mockResolvedValue({ requests: [], users: [makeMember({ lending: false, games: false })] })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('switch', { name: 'Games' }))

    await waitFor(() => expect(authApi.adminUpdateUser).toHaveBeenCalled())
    expect(authApi.adminUpdateUser).toHaveBeenCalledWith({
      userId: 'u1',
      features: { lending: false, games: true },
    })
  })

  it('toggling LENDING does not wipe an existing GAMES grant (full-map regression)', async () => {
    // Member already has games from approve; flipping lending off→on must keep it.
    authApi.adminList.mockResolvedValue({ requests: [], users: [makeMember({ lending: false, games: true })] })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('switch', { name: 'Lending' }))

    await waitFor(() => expect(authApi.adminUpdateUser).toHaveBeenCalled())
    expect(authApi.adminUpdateUser).toHaveBeenCalledWith({
      userId: 'u1',
      features: { lending: true, games: true },
    })
  })

  it('toggling GAMES does not wipe an existing LENDING grant (full-map regression)', async () => {
    // Member already has lending; flipping games off→on must keep lending on.
    authApi.adminList.mockResolvedValue({ requests: [], users: [makeMember({ lending: true, games: false })] })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('switch', { name: 'Games' }))

    await waitFor(() => expect(authApi.adminUpdateUser).toHaveBeenCalled())
    expect(authApi.adminUpdateUser).toHaveBeenCalledWith({
      userId: 'u1',
      features: { lending: true, games: true },
    })
  })
})
