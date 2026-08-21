import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Header from '../components/Header'

function renderHeader(overrides = {}) {
  const props = {
    onOpenSettings: vi.fn(),
    onOpenAdmin: vi.fn(),
    onOpenCredits: vi.fn(),
    showAdmin: false,
    user: { id: 'u1', name: 'Ada', role: 'member' },
    onLogout: vi.fn(),
    ...overrides,
  }
  return render(<Header {...props} />)
}

describe('Header (M2 redesign #320)', () => {
  it('shows the wordmark without a tagline', () => {
    renderHeader()

    expect(screen.getByText('Halcova')).toBeInTheDocument()
    expect(screen.queryByText(/your crate, cataloged/)).not.toBeInTheDocument()
  })

  it('does NOT render Records/Books tabs (moved to browse view)', () => {
    renderHeader()

    expect(screen.queryByRole('button', { name: 'Records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Books' })).not.toBeInTheDocument()
  })

  it('opens the avatar menu with Settings and Sign out for a member', () => {
    renderHeader()

    const avatar = screen.getByRole('button', { name: 'Account: Ada' })
    expect(avatar).toHaveAttribute('aria-haspopup', 'menu')
    expect(avatar).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(avatar)
    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin panel' })).not.toBeInTheDocument()
  })

  it('shows the Admin panel entry only for admins', () => {
    renderHeader({ showAdmin: true, user: { id: 'owner', name: 'Admin', role: 'admin' } })

    fireEvent.click(screen.getByRole('button', { name: 'Account: Admin' }))
    expect(screen.getByRole('menuitem', { name: 'Admin panel' })).toBeInTheDocument()
  })

  it('runs the Settings action and closes the menu', () => {
    const onOpenSettings = vi.fn()
    renderHeader({ onOpenSettings })

    fireEvent.click(screen.getByRole('button', { name: 'Account: Ada' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Account: Ada' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the avatar menu on Escape and restores focus to the avatar', () => {
    renderHeader()

    const avatar = screen.getByRole('button', { name: 'Account: Ada' })
    fireEvent.click(avatar)
    expect(avatar).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(avatar)
  })

  it('shows a back button when showBack is true', () => {
    const onBack = vi.fn()
    renderHeader({ showBack: true, onBack })

    const backBtn = screen.getByRole('button', { name: 'Back' })
    expect(backBtn).toBeInTheDocument()
    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('does NOT show a back button by default', () => {
    renderHeader()

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })
})