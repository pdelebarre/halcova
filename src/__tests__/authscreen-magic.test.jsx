// @vitest-environment jsdom
//
// Tests for the self-serve email signup entry point (src/AuthScreen.jsx,
// ADR-0003 S1 / #59): the "Sign up with email" path requests a one-time magic
// link and lands on the "check your inbox" state — with the access-code and
// demo sign-in paths kept intact as regressions (S1 must not have broken the
// existing auth UX).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setLocale } from '../i18n'
import AuthScreen from '../AuthScreen'

vi.mock('../api/auth', () => ({
  requestMagicLink: vi.fn(),
  DEMO_CODE: 'RUNOUT-DEMO-0000',
}))

import * as authApi from '../api/auth'

const onLogin = vi.fn()
const onRequestAccess = vi.fn()

function renderScreen() {
  return render(<AuthScreen onLogin={onLogin} onRequestAccess={onRequestAccess} />)
}

beforeEach(() => {
  setLocale('en')
  vi.clearAllMocks()
  authApi.requestMagicLink.mockResolvedValue({ ok: true })
})

describe('AuthScreen — self-serve email signup (S1 magic link)', () => {
  it('opens the email form from "Sign up with email"', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with email' }))
    expect(screen.getByText(/Enter your email/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send me the link' })).toBeInTheDocument()
  })

  it('requests a magic link for the typed email and lands on the inbox state', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with email' }))

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }))

    await waitFor(() => expect(authApi.requestMagicLink).toHaveBeenCalledWith({ email: 'ada@example.com' }))
    expect(await screen.findByText('Check your inbox ✉️')).toBeInTheDocument()
    expect(screen.getByText(/one-time sign-in link/)).toBeInTheDocument()
  })

  it('disables the send button until an email is typed (no empty request)', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with email' }))
    expect(screen.getByRole('button', { name: 'Send me the link' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'ada@example.com' } })
    expect(screen.getByRole('button', { name: 'Send me the link' })).toBeEnabled()
  })

  it('shows a server error inline and stays on the form (no dark screen)', async () => {
    authApi.requestMagicLink.mockRejectedValue(Object.assign(
      new Error('Too many requests — try again shortly.'),
      { code: 'RATE_LIMIT' },
    ))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with email' }))
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests — try again shortly.')
    // Still on the form — the visitor can retry.
    expect(screen.getByRole('button', { name: 'Send me the link' })).toBeInTheDocument()
  })

  it('returns to the welcome screen from the email form (back)', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up with email' }))
    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(screen.getByRole('button', { name: 'I have an access code' })).toBeInTheDocument()
  })
})

describe('AuthScreen — access-code + demo paths stay intact (S1 regression)', () => {
  it('signs in with an access code (trimmed) via onLogin', async () => {
    onLogin.mockResolvedValue({})
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'I have an access code' }))

    fireEvent.change(screen.getByPlaceholderText('RU-XXXX-XXXX-XXXX'), { target: { value: '  RU-AAAA-BBBB-CCCC ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('RU-AAAA-BBBB-CCCC'))
  })

  it('shows a login error when the code is rejected', async () => {
    onLogin.mockRejectedValue(new Error("That access code isn't recognized. Check it and try again."))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'I have an access code' }))
    fireEvent.change(screen.getByPlaceholderText('RU-XXXX-XXXX-XXXX'), { target: { value: 'RU-NOPE-NOPE-NOPE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("That access code isn't recognized. Check it and try again.")
  })

  it('signs into the demo space with the public demo code', async () => {
    onLogin.mockResolvedValue({})
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Try the free demo' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('RUNOUT-DEMO-0000'))
  })
})
