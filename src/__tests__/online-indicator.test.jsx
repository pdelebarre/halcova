import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { LocaleProvider } from '../i18n'
import OnlineIndicator from '../components/OnlineIndicator'

// jsdom defaults navigator.onLine to true. We patch the `onLine` getter to
// simulate an already-offline first paint, then drive `online`/`offline`
// window events to test transitions without a poll.
function setOnLine(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

beforeEach(() => {
  setOnLine(true)
})

function renderIndicator() {
  return render(
    <LocaleProvider>
      <OnlineIndicator />
    </LocaleProvider>,
  )
}

describe('OnlineIndicator — M1 offline status pill', () => {
  it('renders nothing when online', () => {
    renderIndicator()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the offline status when the device is offline on first paint', () => {
    setOnLine(false)
    renderIndicator()
    expect(screen.getByRole('status')).toHaveTextContent("You're offline")
  })

  it('appears when an `offline` event fires', () => {
    renderIndicator()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(screen.getByRole('status')).toHaveTextContent("You're offline")
  })

  it('disappears when an `online` event fires (no dark screen, state recovers)', () => {
    setOnLine(false)
    renderIndicator()
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('unsubscribes listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderIndicator()
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function))
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('uses a live region (role=status) for screen readers', () => {
    setOnLine(false)
    renderIndicator()
    // The `<output>` element carries an implicit role="status" live region —
    // removing it would silently drop the screen-reader announcement.
    const status = screen.getByRole('status')
    expect(status.tagName).toBe('OUTPUT')
  })
})
