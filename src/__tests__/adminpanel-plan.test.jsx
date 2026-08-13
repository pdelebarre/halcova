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
const MEMBER = {
  id: 'u1',
  name: 'Bob',
  email: 'bob@example.com',
  role: 'member',
  status: 'active',
  collections: { records: true, books: false },
  features: { lending: false },
  plan: 'free',
}

beforeEach(() => {
  // Mock call history can leak across tests in the same file (restoreAllMocks
  // doesn't clear vi.fn() call records) — clear it so mock.calls[0] is always
  // the current test's first call.
  vi.clearAllMocks()
  // Default: one pending request and no members yet.
  authApi.adminList.mockResolvedValue({ requests: [PENDING], users: [] })
  authApi.adminApprove.mockResolvedValue({ user: { ...MEMBER }, code: 'RU-1111-2222-3333' })
})

describe('Admin plan switch', () => {
  it('approving a request defaults the new member to the free plan', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    // The approve section shows a plan switch defaulted to Free.
    expect(screen.getByRole('switch', { name: 'Plan: Free' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generate access code' }))
    await waitFor(() => expect(authApi.adminApprove).toHaveBeenCalled())
    expect(authApi.adminApprove).toHaveBeenCalledWith(expect.objectContaining({ plan: 'free' }))
  })

  it('lets the admin grant unlimited at approval time', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('switch', { name: 'Plan: Free' }))
    expect(screen.getByRole('switch', { name: 'Plan: Unlimited' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generate access code' }))
    await waitFor(() => expect(authApi.adminApprove).toHaveBeenCalled())
    expect(authApi.adminApprove).toHaveBeenCalledWith(expect.objectContaining({ plan: 'unlimited' }))
  })

  it('toggling a member row plan switch sends plan via updateUser', async () => {
    // No pending requests so only the members-list plan switch is on screen.
    authApi.adminList.mockResolvedValue({ requests: [], users: [MEMBER] })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    const planSwitch = await screen.findByRole('switch', { name: 'Plan: Free' })
    await user.click(planSwitch)

    await waitFor(() => expect(authApi.adminUpdateUser).toHaveBeenCalled())
    expect(authApi.adminUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', plan: 'unlimited' }))
  })

  it('reflects an unlimited member plan as ON and toggles back to free', async () => {
    authApi.adminList.mockResolvedValue({ requests: [], users: [{ ...MEMBER, plan: 'unlimited' }] })
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    const planSwitch = await screen.findByRole('switch', { name: 'Plan: Unlimited' })
    await user.click(planSwitch)

    await waitFor(() => expect(authApi.adminUpdateUser).toHaveBeenCalled())
    expect(authApi.adminUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', plan: 'free' }))
  })
})
