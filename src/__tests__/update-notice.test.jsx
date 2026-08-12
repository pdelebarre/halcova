import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { LocaleProvider } from '../i18n'
import UpdateNotice from '../components/UpdateNotice'

// The `virtual:pwa-register` module only exists at build time (injected by
// vite-plugin-pwa), so tests mock it and drive the callbacks by hand.
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))

import { registerSW } from 'virtual:pwa-register'

// Captured by the mock when UpdateNotice calls registerSW({...}).
let onNeedRefresh
let updateSW

beforeEach(() => {
  vi.clearAllMocks()
  onNeedRefresh = undefined
  updateSW = vi.fn()
  registerSW.mockImplementation(({ onNeedRefresh: needRefresh }) => {
    onNeedRefresh = needRefresh
    return updateSW
  })
})

function renderNotice() {
  return render(
    <LocaleProvider>
      <UpdateNotice />
    </LocaleProvider>,
  )
}

describe('UpdateNotice — visible PWA update prompt', () => {
  it('renders nothing when no new version is available', () => {
    renderNotice()

    expect(registerSW).toHaveBeenCalledWith(
      expect.objectContaining({ immediate: true }),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
  })

  it('shows the "New version available" banner when a new version is ready', () => {
    renderNotice()

    act(() => onNeedRefresh())

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('New version available')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('activates the new service worker when Reload is clicked', () => {
    renderNotice()

    act(() => onNeedRefresh())
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(updateSW).toHaveBeenCalledWith(true)
  })
})
