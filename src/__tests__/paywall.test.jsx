import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import PaywallModal from '../components/PaywallModal'

// Mutable user so each App test can pick a plan/role. Held in vi.hoisted
// because the useAuth mock factory below is hoisted above module-level `let`s.
const { currentUser } = vi.hoisted(() => ({
  currentUser: {
    id: 'u1',
    name: 'Member',
    role: 'member',
    collections: { records: true, books: false },
    plan: 'free',
    features: {},
  },
}))

// Stateful useAuth so setSession from the checkout poll actually updates the
// session (mirrors demo-mode.test.jsx). refresh/login are STABLE across
// renders (like the real hook's useCallback) — App's poll effect depends on
// refresh, and a fresh identity every render would tear down the in-flight
// poll. refresh() is a no-op here — the S3 status poll is what flips the plan.
vi.mock('../hooks/useAuth', async () => {
  const { useState } = await import('react')
  const refresh = vi.fn(async () => {})
  const login = vi.fn(async () => currentUser)
  const logout = vi.fn()
  const requestAccess = vi.fn()
  return {
    useAuth: () => {
      const [session, setSession] = useState({ user: currentUser, code: 'RU-TEST' })
      return { session, ready: true, login, logout, requestAccess, setSession, refresh }
    },
  }
})

vi.mock('../api/auth', () => ({
  requestMagicLink: vi.fn(),
  verifyMagicLink: vi.fn(),
  login: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  requestAccess: vi.fn(),
  DEMO_CODE: 'RUNOUT-DEMO-0000',
}))

vi.mock('../api/payment', () => ({
  createCheckout: vi.fn(),
  getCheckoutStatus: vi.fn(),
  openPortal: vi.fn(),
}))

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

vi.mock('../api/discogs', () => ({
  searchByBarcode: vi.fn(),
  searchByText: vi.fn(),
  getReleaseDetail: vi.fn(),
}))

// The scanner decodes WASM camera frames — not runnable in jsdom. Stub it so
// the scan-to-add flow can drive onDetected directly.
vi.mock('../components/ScannerModal', () => ({
  default: ({ onDetected }) => (
    <div role="dialog" aria-label="Scan barcode">
      <button type="button" onClick={() => onDetected('0767325734129')}>simulate scan</button>
    </div>
  ),
}))

import App from '../App'
import * as authApi from '../api/auth'
import * as paymentApi from '../api/payment'
import * as collectionApi from '../api/collection'
import * as discogs from '../api/discogs'
import { saveSession } from '../utils/session'

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    title: `Artist ${i} - Album ${i}`,
    year: 2000 + i,
    formatType: 'LP',
    label: 'Label',
    genre: ['Jazz'],
    barcode: `0000000000${i}`,
    dateAdded: '2026-01-01T00:00:00Z',
  }))
}

const KIND_OF_BLUE = {
  discogsId: 101,
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  label: 'Columbia',
  genre: ['Jazz'],
  barcode: '0767325734129',
}

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
  window.history.replaceState({}, '', '/')
  currentUser.role = 'member'
  currentUser.plan = 'free'
  currentUser.features = {}
  vi.clearAllMocks()
  paymentApi.createCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test', sessionId: 'cs_test' })
  paymentApi.getCheckoutStatus.mockResolvedValue({ status: 'pending' })
  collectionApi.listItems.mockResolvedValue([])
  authApi.me.mockResolvedValue({ ...currentUser })
})

function renderModal(props = {}) {
  return render(
    <LocaleProvider>
      <PaywallModal kind="records" reason="cap" onClose={vi.fn()} {...props} />
    </LocaleProvider>
  )
}

// jsdom's window.location.assign is non-configurable (vi.spyOn throws), so
// replace window.location with a plain object that carries a callable assign.
// The real location is restored in afterEach.
const REAL_LOCATION = typeof window !== 'undefined' ? window.location : null
function stubLocationAssign() {
  const assignMock = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...REAL_LOCATION, assign: assignMock },
    configurable: true,
    writable: true,
  })
  return assignMock
}

afterEach(() => {
  if (REAL_LOCATION && window.location !== REAL_LOCATION) {
    Object.defineProperty(window, 'location', { value: REAL_LOCATION, configurable: true, writable: true })
  }
})

// ===========================================================================
// PaywallModal — render, copy resolution, and the checkout state machine
// ===========================================================================

describe('PaywallModal', () => {
  it('renders a dialog with catalog copy, CTA and secondary action', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Your crate is full')
    expect(within(dialog).getByText(/free plan holds 10 items/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Maybe later' })).toBeInTheDocument()
  })

  it('uses the shelf wording for books', () => {
    render(<LocaleProvider><PaywallModal kind="books" reason="cap" onClose={vi.fn()} /></LocaleProvider>)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Your shelf is full')
    expect(screen.getByText(/free plan holds 10 items/i)).toBeInTheDocument()
  })

  it('uses reason-specific copy', () => {
    const { rerender } = renderModal()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Your crate is full')
    rerender(<LocaleProvider><PaywallModal kind="records" reason="feature" onClose={vi.fn()} /></LocaleProvider>)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Unlock lending')
    rerender(<LocaleProvider><PaywallModal kind="records" reason="upgrade" onClose={vi.fn()} /></LocaleProvider>)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Go Premium')
    rerender(<LocaleProvider><PaywallModal kind="records" reason="expired" onClose={vi.fn()} /></LocaleProvider>)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Your plan has expired')
  })

  it('falls back to the generic upgrade copy for an unknown reason', () => {
    renderModal({ reason: 'bogus-reason' })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Go Premium')
  })

  it('renders nothing for an unknown kind (dark-screen safety)', () => {
    const { container } = render(
      <LocaleProvider><PaywallModal kind="cassettes" reason="cap" onClose={vi.fn()} /></LocaleProvider>
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('starts checkout and redirects to the returned URL', async () => {
    const assignMock = stubLocationAssign()
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() => expect(paymentApi.createCheckout).toHaveBeenCalledWith('lifetime'))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test'))
  })

  it('disables the CTA while creating (no double-charge)', async () => {
    let resolveCheckout
    paymentApi.createCheckout.mockReturnValue(new Promise((resolve) => { resolveCheckout = resolve }))
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    const busy = screen.getByRole('button', { name: 'Starting checkout…' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy) // tap while creating is a no-op
    await act(async () => { resolveCheckout({ url: 'https://stripe.example/cs', sessionId: 'cs' }) })
    expect(paymentApi.createCheckout).toHaveBeenCalledTimes(1)
  })

  it('refuses to navigate to a non-http URL and shows the checkout error', async () => {
    const assignMock = stubLocationAssign()
    paymentApi.createCheckout.mockResolvedValue({ url: 'javascript:alert(1)', sessionId: 'cs' })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(await screen.findByText(/couldn't start checkout/i)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('shows an inline error from the server and lets the user retry', async () => {
    paymentApi.createCheckout.mockRejectedValueOnce(
      Object.assign(new Error('Could not start checkout. Try again shortly.'), { code: 'CHECKOUT_FAILED' }),
    )
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(await screen.findByText('Could not start checkout. Try again shortly.')).toBeInTheDocument()
    // Retry path: the CTA is back and a second attempt fires.
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() => expect(paymentApi.createCheckout).toHaveBeenCalledTimes(2))
  })

  it('closes on "Maybe later"', () => {
    const onClose = vi.fn()
    render(<LocaleProvider><PaywallModal kind="records" reason="cap" onClose={onClose} /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }))
    expect(onClose).toHaveBeenCalled()
  })
})

// ===========================================================================
// Trigger branching (App-level): PLAN_LIMIT opens the paywall, DEMO never does
// ===========================================================================

describe('Paywall triggers', () => {
  it('opens the paywall when the server rejects an add with PLAN_LIMIT', async () => {
    collectionApi.listItems.mockResolvedValue(makeItems(5))
    collectionApi.addItem.mockRejectedValue(Object.assign(
      new Error("You've reached the free plan limit of 10 items."),
      { code: 'PLAN_LIMIT' },
    ))
    discogs.searchByBarcode.mockResolvedValue([KIND_OF_BLUE])
    render(<App />)

    // FAB → Scan barcode → stubbed scanner fires onDetected.
    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))
    fireEvent.click(await screen.findByText('simulate scan'))

    // Add → server rejects with PLAN_LIMIT → the paywall bottom sheet opens.
    fireEvent.click(await screen.findByRole('button', { name: 'Add to crate' }))
    await waitFor(() => expect(collectionApi.addItem).toHaveBeenCalled(), { timeout: 2000 })
    const dialog = await screen.findByRole('dialog', { name: 'Your crate is full' })
    expect(within(dialog).getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
  })

  it('never opens the paywall for a demo visitor (DEMO_READONLY)', async () => {
    currentUser.role = 'demo'
    currentUser.plan = undefined
    currentUser.features = {}
    collectionApi.listItems.mockResolvedValue(makeItems(3))
    render(<App />)

    // The read-only demo banner is the only plan-ish surface — no Upgrade
    // entry, no paywall, no "Maybe later" secondary anywhere.
    expect(await screen.findByText(/read-only demo collection/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /full|Upgrade|Premium/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Maybe later')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Upgrade' })).toHaveLength(0)
  })
})

// ===========================================================================
// Checkout return poll (?checkout=success / ?upgrade=success) + magic link
// ===========================================================================

describe('Checkout return & magic link', () => {
  it('polls the S3 status after a successful checkout, strips the URL and shows the success toast', async () => {
    saveSession({ user: currentUser, session: 'tok-session-abc123' })
    window.history.replaceState({}, '', '/?checkout=success&session_id=cs_test')
    paymentApi.getCheckoutStatus.mockResolvedValue({
      status: 'complete',
      user: { ...currentUser, plan: 'premium' },
    })

    render(<App />)
    // Flush the async poll chain (getCheckoutStatus → setSession → toast).
    await act(async () => { await Promise.resolve() })

    expect(paymentApi.getCheckoutStatus).toHaveBeenCalledWith('cs_test')
    expect(await screen.findByText('Premium unlocked — happy cataloging!', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('shows the "still confirming" notice while the payment is pending', async () => {
    saveSession({ user: currentUser, session: 'tok-session-abc123' })
    window.history.replaceState({}, '', '/?upgrade=success&session_id=cs_test')
    paymentApi.getCheckoutStatus.mockResolvedValue({ status: 'pending' })

    render(<App />)

    expect(await screen.findByText(/still confirming your payment/i)).toBeInTheDocument()
    expect(paymentApi.getCheckoutStatus).toHaveBeenCalledWith('cs_test')
    expect(window.location.search).toBe('')
  })

  it('exchanges a magic-link token on mount and strips the token from the URL', async () => {
    saveSession({ user: currentUser, session: 'tok-session-abc123' })
    window.history.replaceState({}, '', '/?magic-link=abc123')
    authApi.verifyMagicLink.mockResolvedValue({ ...currentUser, name: 'New Member' })

    render(<App />)

    await waitFor(() => expect(authApi.verifyMagicLink).toHaveBeenCalledWith({ token: 'abc123' }))
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
