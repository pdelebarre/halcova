import { act } from 'react'
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
  adminRotate: vi.fn(),
}))

// No `code` field on the member: publicUser strips it server-side (Scaling
// Phase 1), so the panel can only ever show a code freshly returned by rotate.
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

const NEW_CODE = 'RU-9999-8888-7777'

beforeEach(() => {
  vi.clearAllMocks()
  authApi.adminList.mockResolvedValue({ requests: [], users: [MEMBER] })
  authApi.adminRotate.mockResolvedValue({ user: { ...MEMBER }, code: NEW_CODE })
})

describe('Admin rotate code', () => {
  it('rotates a member code, shows the new code once, and clears it on Done', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Rotate code' }))

    await waitFor(() => expect(authApi.adminRotate).toHaveBeenCalled())
    expect(authApi.adminRotate).toHaveBeenCalledWith({ userId: 'u1' })
    expect(screen.getByText(NEW_CODE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText(NEW_CODE)).not.toBeInTheDocument()
  })

  it('does not re-show a rotated code after a re-render (it is not stored on the member)', async () => {
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Rotate code' }))
    await waitFor(() => expect(screen.getByText(NEW_CODE)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Done' }))

    // Trigger a reload + re-render via another admin action (plan toggle).
    await user.click(screen.getByRole('switch', { name: 'Plan: Free' }))
    await waitFor(() => expect(authApi.adminUpdateUser).toHaveBeenCalled())
    await waitFor(() => expect(authApi.adminList).toHaveBeenCalled())

    expect(screen.queryByText(NEW_CODE)).not.toBeInTheDocument()
  })

  it('guards against double-tap: the button is disabled while a rotation is in flight', async () => {
    let resolveRotate
    authApi.adminRotate.mockImplementation(() => new Promise((resolve) => { resolveRotate = resolve }))
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    const rotateBtn = await screen.findByRole('button', { name: 'Rotate code' })
    await user.click(rotateBtn)

    await waitFor(() => expect(authApi.adminRotate).toHaveBeenCalledTimes(1))
    expect(rotateBtn).toBeDisabled()

    // A second tap on the disabled button fires nothing — no double rotation.
    await user.click(rotateBtn)
    expect(authApi.adminRotate).toHaveBeenCalledTimes(1)

    await act(async () => { resolveRotate({ user: { ...MEMBER }, code: NEW_CODE }) })
    await waitFor(() => expect(screen.getByText(NEW_CODE)).toBeInTheDocument())
  })

  it('surfaces a rotate error without breaking the member row', async () => {
    authApi.adminRotate.mockRejectedValue(new Error('User not found.'))
    const user = userEvent.setup()
    render(<AdminPanel onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Rotate code' }))

    expect(await screen.findByText('User not found.')).toBeInTheDocument()
    // The row still renders and the action can be retried.
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate code' })).not.toBeDisabled()
  })
})
