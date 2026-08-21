import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPanel from '../AdminPanel'
import * as authApi from '../api/auth'

vi.mock('../api/auth', () => ({
  adminList: vi.fn(),
  adminDashboard: vi.fn(),
  adminAiList: vi.fn(),
  adminAiCreate: vi.fn(),
  adminAiUpdate: vi.fn(),
  adminAiDelete: vi.fn(),
  adminAiTest: vi.fn(),
  adminAiActivate: vi.fn(),
}))

const PROFILE = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'OpenAI Primary',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  capabilities: ['classify', 'deduplicate'],
  active: false,
  secretSet: true,
  secretMasked: '••••••1234',
  lastTestOk: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  authApi.adminList.mockResolvedValue({ requests: [], users: [] })
  authApi.adminDashboard.mockResolvedValue({ counts: {} })
  authApi.adminAiList.mockResolvedValue({ providers: [PROFILE] })
})

// The AI tab is reached by clicking the "AI settings" tab button.
async function openAiTab(user) {
  render(<AdminPanel onClose={() => {}} />)
  const tab = await screen.findByRole('tab', { name: 'AI settings' })
  await user.click(tab)
  return tab
}

describe('Admin AI settings (#304)', () => {
  it('loads and lists provider profiles with masked secrets', async () => {
    const user = userEvent.setup()
    await openAiTab(user)
    expect(await screen.findByText('OpenAI Primary')).toBeInTheDocument()
    expect(screen.getByText(/gpt-4o-mini/)).toBeInTheDocument()
    expect(authApi.adminAiList).toHaveBeenCalled()
  })

  it('creates a new provider profile', async () => {
    authApi.adminAiCreate.mockResolvedValue({ profile: { ...PROFILE, name: 'New Provider' } })
    const user = userEvent.setup()
    await openAiTab(user)

    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    await user.type(screen.getByLabelText('Name'), 'New Provider')
    await user.type(screen.getByLabelText('Base URL'), 'https://api.openai.com/v1')
    await user.type(screen.getByLabelText('Model'), 'gpt-4o-mini')
    await user.type(screen.getByLabelText('API key'), 'sk-new-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(authApi.adminAiCreate).toHaveBeenCalled())
    expect(authApi.adminAiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Provider', apiKey: 'sk-new-secret' })
    )
  })

  it('editing an existing profile leaves the apiKey blank (secret kept server-side)', async () => {
    const user = userEvent.setup()
    await openAiTab(user)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // The apiKey field is blank for an existing profile — the client never
    // holds the stored secret, so a blank on save means "keep it unchanged".
    expect(screen.getByLabelText('API key')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(authApi.adminAiUpdate).toHaveBeenCalled())
    expect(authApi.adminAiUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: PROFILE.id })
    )
    // No apiKey is sent on update when the field is blank.
    expect(authApi.adminAiUpdate.mock.calls[0][0].apiKey).toBeUndefined()
  })

  it('runs a connection test', async () => {
    authApi.adminAiTest.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    await openAiTab(user)

    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(authApi.adminAiTest).toHaveBeenCalledWith({ profileId: PROFILE.id }))
  })

  it('activates a provider', async () => {
    authApi.adminAiActivate.mockResolvedValue({ profile: { ...PROFILE, active: true } })
    const user = userEvent.setup()
    await openAiTab(user)

    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(authApi.adminAiActivate).toHaveBeenCalledWith({ profileId: PROFILE.id }))
  })

  it('deletes a provider', async () => {
    authApi.adminAiDelete.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    await openAiTab(user)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(authApi.adminAiDelete).toHaveBeenCalledWith({ profileId: PROFILE.id }))
  })
})